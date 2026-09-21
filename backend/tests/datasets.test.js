// STORAGE_MODE is read when the repository module is first required, so this
// has to be set before the require below, not in a beforeEach.
process.env.DATASET_STORAGE_MODE = 'memory';

const datasetsRouter = require('../api/v1/routes/datasets');
const service = require('../modules/datasets/datasets.service');
const repository = require('../modules/datasets/datasets.repository');

const OWNER = 'owner-1';
const OTHER_OWNER = 'owner-2';

const COLUMNS = [
  { name: 'OrderID', type: 'string' },
  { name: 'Region', type: 'string' },
  { name: 'Amount', type: 'number' },
];

const rowsFrom = (start, count) =>
  Array.from({ length: count }, (_, offset) => ({
    OrderID: `O${start + offset}`,
    Region: 'North',
    Amount: start + offset,
  }));

const newDataset = () =>
  service.createDataset({
    ownerId: OWNER,
    name: 'Sales',
    sourceName: 'sales.csv',
    columns: COLUMNS,
  });

beforeEach(() => {
  repository.__resetMemoryStore();
});

describe('dataset route registration order', () => {
  test('registers /limits before /:id, so it is not read as an id', () => {
    const paths = datasetsRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    const limitsIndex = paths.indexOf('/limits');
    const idIndex = paths.indexOf('/:id');

    expect(limitsIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(limitsIndex).toBeLessThan(idIndex);
  });
});

describe('creating a dataset', () => {
  test('starts as building, with no rows', async () => {
    const dataset = await newDataset();
    expect(dataset.status).toBe('building');
    expect(dataset.rowCount).toBe(0);
  });

  test('refuses two columns with the same name', async () => {
    await expect(
      service.createDataset({
        ownerId: OWNER,
        name: 'Sales',
        columns: [
          { name: 'Amount', type: 'number' },
          { name: 'amount', type: 'number' },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('refuses a column type the semantic layer does not know', async () => {
    await expect(
      service.createDataset({
        ownerId: OWNER,
        name: 'Sales',
        columns: [{ name: 'Amount', type: 'currency' }],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('refuses an upload with no owner', async () => {
    await expect(
      service.createDataset({ ownerId: '', name: 'Sales', columns: COLUMNS })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('appending rows', () => {
  test('refuses a row carrying a column that was never declared', async () => {
    const dataset = await newDataset();
    await expect(
      service.appendRows({
        ownerId: OWNER,
        datasetId: dataset.id,
        startIndex: 0,
        rows: [{ OrderID: 'O1', Region: 'North', Amount: 1, Currency: 'GHS' }],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a retried batch rewrites its rows instead of duplicating them', async () => {
    // The reason startIndex is supplied by the caller rather than inferred
    // from a running count. If this ever fails, a client that times out and
    // retries silently doubles part of its data.
    const dataset = await newDataset();

    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 10) });
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 10) });

    expect(await repository.countRows(dataset.id)).toBe(10);
  });

  test('batches at different offsets accumulate', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 10) });
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 10, rows: rowsFrom(10, 5) });

    expect(await repository.countRows(dataset.id)).toBe(15);
  });

  test('refuses a batch larger than the transport can carry', async () => {
    const dataset = await newDataset();
    await expect(
      service.appendRows({
        ownerId: OWNER,
        datasetId: dataset.id,
        startIndex: 0,
        rows: rowsFrom(0, service.limits.MAX_BATCH_ROWS + 1),
      })
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  test('refuses rows once the dataset is complete', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 3) });
    await service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 3 });

    await expect(
      service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 3, rows: rowsFrom(3, 1) })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('completing a dataset', () => {
  test('refuses when fewer rows arrived than were promised, and stays unreadable', async () => {
    // The whole reason the completion step exists. A dropped batch must not
    // produce a dataset that looks finished.
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 8) });

    await expect(
      service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 10 })
    ).rejects.toMatchObject({ statusCode: 422 });

    const after = await service.getDataset(dataset.id, OWNER);
    expect(after.status).toBe('building');
  });

  test('marks ready when the count matches', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 10) });

    const completed = await service.completeDataset({
      ownerId: OWNER,
      datasetId: dataset.id,
      expectedRowCount: 10,
    });

    expect(completed.status).toBe('ready');
    expect(completed.rowCount).toBe(10);
  });

  test('requires an explicit expected count', async () => {
    const dataset = await newDataset();
    await expect(
      service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: undefined })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('reading rows', () => {
  test('refuses to serve rows while the dataset is still building', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 5) });

    await expect(service.getDatasetRows(dataset.id, OWNER)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test('pages in stored order and reports whether more remain', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 10) });
    await service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 10 });

    const first = await service.getDatasetRows(dataset.id, OWNER, { offset: 0, limit: 4 });
    expect(first.rows.map((row) => row.OrderID)).toEqual(['O0', 'O1', 'O2', 'O3']);
    expect(first.meta.hasMore).toBe(true);

    const last = await service.getDatasetRows(dataset.id, OWNER, { offset: 8, limit: 4 });
    expect(last.rows.map((row) => row.OrderID)).toEqual(['O8', 'O9']);
    expect(last.meta.hasMore).toBe(false);
  });

  test('caps an oversized page and says what it actually applied', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 3) });
    await service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 3 });

    const page = await service.getDatasetRows(dataset.id, OWNER, { offset: 0, limit: 10 ** 9 });
    expect(page.meta.limit).toBe(service.limits.MAX_PAGE_ROWS);
  });
});

describe('ownership', () => {
  test('another user cannot read, complete or delete a dataset', async () => {
    const dataset = await newDataset();

    await expect(service.getDataset(dataset.id, OTHER_OWNER)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      service.completeDataset({ ownerId: OTHER_OWNER, datasetId: dataset.id, expectedRowCount: 0 })
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.deleteDataset(dataset.id, OTHER_OWNER)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('listing only returns the caller own datasets', async () => {
    await newDataset();
    await service.createDataset({ ownerId: OTHER_OWNER, name: 'Theirs', columns: COLUMNS });

    const mine = await service.listDatasets(OWNER);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Sales');
  });
});

describe('storage mode', () => {
  test('falls back to memory when no database is configured', async () => {
    expect(await repository.storageMode()).toBe('memory');
  });
});
