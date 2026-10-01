const path = require('node:path');

// Real Postgres, not the in-memory fallback. Both of these must happen before
// the repository is required: it reads DATASET_STORAGE_MODE once, at load.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DATASET_STORAGE_MODE = 'database';

const service = require('../modules/datasets/datasets.service');
const repository = require('../modules/datasets/datasets.repository');
const { closePool } = require('../config/database');

/**
 * The durable half of the dataset store, against a real database.
 *
 * The in-memory tests cannot reach any of this: the CREATE TABLEs, the
 * transaction, ON CONFLICT DO UPDATE, COUNT, OFFSET/LIMIT. Writing these found
 * two defects that had passed 19 green tests - query() does not recognise
 * BEGIN, and pool.query() would have spread one transaction across several
 * connections - so the value of this file was already paid for before it ran.
 *
 * Skipped, loudly, when DATABASE_URL is absent, so it never reports a pass it
 * did not earn.
 */

const hasDatabase = Boolean(String(process.env.DATABASE_URL || '').trim());
const describeDurable = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  DATABASE_URL is not set - the durable dataset tests were SKIPPED.\n' +
      '  The SQL path is therefore unverified in this run.\n'
  );
}

// Unique per run, so a repeat run cannot see the previous one's rows and
// nothing here can collide with real data.
const OWNER = `test-owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const COLUMNS = [
  { name: 'OrderID', type: 'string' },
  { name: 'Region', type: 'string' },
  { name: 'Amount', type: 'number' },
];

const rowsFrom = (start, count) =>
  Array.from({ length: count }, (_, offset) => ({
    OrderID: `O${start + offset}`,
    Region: offset % 2 === 0 ? 'North' : 'South',
    Amount: start + offset,
  }));

const created = [];

const newDataset = async (name = 'Durable Sales') => {
  const dataset = await service.createDataset({
    ownerId: OWNER,
    name,
    sourceName: 'sales.csv',
    columns: COLUMNS,
  });
  created.push(dataset.id);
  return dataset;
};

afterAll(async () => {
  if (!hasDatabase) return;
  for (const id of created) {
    try {
      await repository.deleteDataset(id, OWNER);
    } catch {
      // Reported by the leaves-nothing-behind test rather than swallowed here.
    }
  }
  // Without this the pool keeps the process alive and jest force-kills the
  // worker, printing a leak warning on every run of a suite that passed.
  await closePool();
});

describeDurable('dataset storage against a real database', () => {
  test('is actually using the database, not the memory fallback', async () => {
    // If this says memory, every other test in this file proves nothing.
    expect(await repository.storageMode()).toBe('database');
  });

  test('creates the schema and stores a dataset header', async () => {
    const dataset = await newDataset();
    expect(dataset.status).toBe('building');

    const readBack = await service.getDataset(dataset.id, OWNER);
    expect(readBack.name).toBe('Durable Sales');
    expect(readBack.columns).toHaveLength(3);
  });

  test('writes a batch inside one transaction', async () => {
    const dataset = await newDataset();
    await service.appendRows({
      ownerId: OWNER,
      datasetId: dataset.id,
      startIndex: 0,
      rows: rowsFrom(0, 250),
    });
    expect(await repository.countRows(dataset.id)).toBe(250);
  });

  test('chunks a batch that exceeds one INSERT statement', async () => {
    // INSERT_CHUNK_ROWS is 500, so this is more than one statement and proves
    // the loop and the parameter numbering are right at the boundary.
    const dataset = await newDataset();
    await service.appendRows({
      ownerId: OWNER,
      datasetId: dataset.id,
      startIndex: 0,
      rows: rowsFrom(0, 1200),
    });
    expect(await repository.countRows(dataset.id)).toBe(1200);
  });

  test('ON CONFLICT makes a retried batch rewrite rather than duplicate', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 40) });
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 40) });
    expect(await repository.countRows(dataset.id)).toBe(40);
  });

  test('refuses completion when the count does not match, and stays unreadable', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 30) });

    await expect(
      service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 35 })
    ).rejects.toMatchObject({ statusCode: 422 });

    expect((await service.getDataset(dataset.id, OWNER)).status).toBe('building');
  });

  test('completes and then pages rows back in stored order', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 60) });
    const completed = await service.completeDataset({
      ownerId: OWNER,
      datasetId: dataset.id,
      expectedRowCount: 60,
    });
    expect(completed.status).toBe('ready');
    expect(completed.rowCount).toBe(60);

    const page = await service.getDatasetRows(dataset.id, OWNER, { offset: 10, limit: 5 });
    expect(page.rows.map((row) => row.OrderID)).toEqual(['O10', 'O11', 'O12', 'O13', 'O14']);
    expect(page.meta.hasMore).toBe(true);
    // JSONB round-trip: a number must come back a number, not a string.
    expect(page.rows[0].Amount).toBe(10);
  });

  test('scopes every read to the owner', async () => {
    const dataset = await newDataset();
    await expect(service.getDataset(dataset.id, 'someone-else')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('deletes a dataset and cascades its rows', async () => {
    const dataset = await newDataset();
    await service.appendRows({ ownerId: OWNER, datasetId: dataset.id, startIndex: 0, rows: rowsFrom(0, 20) });

    await service.deleteDataset(dataset.id, OWNER);

    expect(await repository.countRows(dataset.id)).toBe(0);
    await expect(service.getDataset(dataset.id, OWNER)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('leaves nothing behind in the database', async () => {
    // Runs last. Everything above is cleaned up in afterAll, but this asserts
    // the run did not quietly leave rows in someone's real database.
    for (const id of created) {
      await repository.deleteDataset(id, OWNER).catch(() => {});
    }
    created.length = 0;
    expect(await service.listDatasets(OWNER)).toEqual([]);
  });
});
