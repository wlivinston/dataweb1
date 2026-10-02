const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DATASET_STORAGE_MODE = 'database';

const service = require('../modules/datasets/datasets.service');
const { closePool } = require('../config/database');

/**
 * Do the VALUES survive a round trip through the database?
 *
 * The durable suite proves the mechanics - transactions, ON CONFLICT, paging,
 * ownership. This proves something else and more important: that a cell put
 * in comes back as the same cell. Reload is worthless, and worse than
 * worthless, if a number quietly changes type or a zero turns into a blank on
 * the way through JSONB.
 *
 * That is not hypothetical. The Excel importer turned every genuine zero into
 * an empty string for months because of one `||`, and nothing noticed. This
 * file exists so the storage layer cannot repeat it: every awkward value the
 * engine distinguishes is written, read back, and compared with
 * toStrictEqual, which separates 0 from '' from null in a way toEqual does
 * not.
 *
 * Skipped loudly without DATABASE_URL, so it never reports a pass it did not
 * earn.
 */

const hasDatabase = Boolean(String(process.env.DATABASE_URL || '').trim());
const describeRoundTrip = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  DATABASE_URL is not set - the dataset round-trip tests were SKIPPED.\n' +
      '  Value fidelity through the database is therefore unverified in this run.\n'
  );
}

const OWNER = `roundtrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const COLUMNS = [
  { name: 'Label', type: 'string' },
  { name: 'Amount', type: 'number' },
  { name: 'When', type: 'date' },
  { name: 'Flag', type: 'boolean' },
];

/**
 * One row per value that has ever been got wrong, or could be.
 *
 * Each row's Label says what it is for, so a failure names its own cause.
 */
const AWKWARD_ROWS = [
  { Label: 'a plain row', Amount: 1234.56, When: '2024-01-15', Flag: true },
  { Label: 'a genuine zero', Amount: 0, When: '2024-02-20', Flag: false },
  { Label: 'a negative', Amount: -250.5, When: '2024-03-10', Flag: false },
  { Label: 'a blank number', Amount: null, When: '2024-04-05', Flag: true },
  { Label: '', Amount: 7, When: '2024-05-18', Flag: false },
  { Label: 'a very large number', Amount: 9007199254740991, When: '2024-06-22', Flag: true },
  { Label: 'a small fraction', Amount: 0.000001, When: '2024-07-01', Flag: false },
  { Label: 'quotes " and \\ backslash', Amount: 42, When: '2024-08-09', Flag: true },
  { Label: 'unicode: Akwaaba ção 你好', Amount: 3, When: '2024-09-30', Flag: false },
  { Label: 'a comma, a newline\nand a tab\there', Amount: 99, When: '2024-10-11', Flag: true },
];

const created = [];

const storeRows = async (name, columns, rows) => {
  const dataset = await service.createDataset({
    ownerId: OWNER,
    name,
    sourceName: `${name}.csv`,
    columns,
  });
  created.push(dataset.id);
  if (rows.length > 0) {
    await service.appendRows({
      ownerId: OWNER,
      datasetId: dataset.id,
      startIndex: 0,
      rows,
    });
  }
  await service.completeDataset({
    ownerId: OWNER,
    datasetId: dataset.id,
    expectedRowCount: rows.length,
  });
  return dataset.id;
};

const readAll = async (datasetId, total) => {
  const { rows } = await service.getDatasetRows(datasetId, OWNER, { offset: 0, limit: total + 10 });
  return rows;
};

afterAll(async () => {
  if (!hasDatabase) return;
  for (const id of created) {
    try {
      await service.deleteDataset(id, OWNER);
    } catch {
      // Nothing to add; the suite's own assertions cover what was stored.
    }
  }
  await closePool();
});

describeRoundTrip('values survive the database unchanged', () => {
  let datasetId;

  beforeAll(async () => {
    datasetId = await storeRows('awkward', COLUMNS, AWKWARD_ROWS);
  });

  test('every row comes back, in the order it went in', async () => {
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    expect(rows).toHaveLength(AWKWARD_ROWS.length);
    expect(rows.map((row) => row.Label)).toEqual(AWKWARD_ROWS.map((row) => row.Label));
  });

  test('every cell is strictly equal to what was stored', async () => {
    // toStrictEqual, not toEqual: toEqual treats undefined and a missing key
    // as the same, and this is precisely a test about values that look alike.
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    expect(rows).toStrictEqual(AWKWARD_ROWS);
  });

  test('a zero comes back as the number 0, not as a blank or a string', async () => {
    // The single most important assertion in this file. `0`, `''` and `null`
    // are three different facts about a cell, and an engine that confuses them
    // reports a wrong average and a wrong minimum while looking fine.
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    const zero = rows.find((row) => row.Label === 'a genuine zero');

    expect(zero.Amount).toBe(0);
    expect(typeof zero.Amount).toBe('number');
    expect(zero.Amount).not.toBe('');
    expect(zero.Amount).not.toBeNull();
  });

  test('a blank number stays blank, and is not read as a zero', async () => {
    // The other direction, and the one that turns "no data" into "they sold
    // nothing" - a different and equally wrong claim.
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    const blank = rows.find((row) => row.Label === 'a blank number');

    expect(blank.Amount).toBeNull();
    expect(blank.Amount).not.toBe(0);
  });

  test('false stays false, and is not read as missing', async () => {
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    const flags = rows.map((row) => row.Flag);
    expect(flags.filter((flag) => flag === false)).toHaveLength(5);
    expect(flags.every((flag) => typeof flag === 'boolean')).toBe(true);
  });

  test('an empty label stays an empty string, not null', async () => {
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    const empty = rows.find((row) => row.Amount === 7);
    expect(empty.Label).toBe('');
    expect(empty.Label).not.toBeNull();
  });

  test('numeric precision is not lost', async () => {
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    expect(rows.find((row) => row.Label === 'a very large number').Amount).toBe(9007199254740991);
    expect(rows.find((row) => row.Label === 'a small fraction').Amount).toBe(0.000001);
    expect(rows.find((row) => row.Label === 'a negative').Amount).toBe(-250.5);
    expect(rows.find((row) => row.Label === 'a plain row').Amount).toBe(1234.56);
  });

  test('dates come back as the same text, not reinterpreted', async () => {
    // Stored as text on purpose. A date that the database parses and renders
    // back in its own timezone can shift by a day, and a breakdown by month
    // then puts the first of the month in the wrong one.
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    expect(rows.map((row) => row.When)).toEqual(AWKWARD_ROWS.map((row) => row.When));
    expect(rows[0].When).toBe('2024-01-15');
    expect(typeof rows[0].When).toBe('string');
  });

  test('awkward text survives verbatim', async () => {
    const rows = await readAll(datasetId, AWKWARD_ROWS.length);
    expect(rows.find((row) => row.Amount === 42).Label).toBe('quotes " and \\ backslash');
    expect(rows.find((row) => row.Amount === 3).Label).toBe(
      'unicode: Akwaaba ção 你好'
    );
    expect(rows.find((row) => row.Amount === 99).Label).toBe(
      'a comma, a newline\nand a tab\there'
    );
  });
});

describeRoundTrip('a round trip across several batches', () => {
  test('reassembles in order from batches sent separately', async () => {
    // The shape a real upload takes. Rows that came back in the wrong order
    // would still total correctly, so nothing downstream would notice - but
    // every "first row" and every unsorted table would be wrong.
    const columns = [
      { name: 'Position', type: 'number' },
      { name: 'Label', type: 'string' },
    ];
    const rows = Array.from({ length: 250 }, (_, i) => ({
      Position: i,
      Label: `row-${i}`,
    }));

    const dataset = await service.createDataset({
      ownerId: OWNER,
      name: 'batched',
      sourceName: 'batched.csv',
      columns,
    });
    created.push(dataset.id);

    for (let start = 0; start < rows.length; start += 100) {
      await service.appendRows({
        ownerId: OWNER,
        datasetId: dataset.id,
        startIndex: start,
        rows: rows.slice(start, start + 100),
      });
    }
    await service.completeDataset({
      ownerId: OWNER,
      datasetId: dataset.id,
      expectedRowCount: rows.length,
    });

    const stored = await readAll(dataset.id, rows.length);
    expect(stored).toHaveLength(250);
    expect(stored.map((row) => row.Position)).toEqual(rows.map((row) => row.Position));
    expect(stored[0].Position).toBe(0);
    expect(stored[249].Label).toBe('row-249');
  });
});
