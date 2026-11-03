// Read when the modules are first required, so set before any require below.
process.env.DATASET_STORAGE_MODE = 'memory';
process.env.ANALYTICS_MAX_ROWS = '50';

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ success: false });
    req.user = { id };
    return next();
  },
}));

const express = require('express');
const request = require('supertest');
const service = require('../modules/datasets/datasets.service');
const repository = require('../modules/datasets/datasets.repository');
const analytics = require('../modules/analytics/analytics.service');
const analyticsRouter = require('../api/v1/routes/analytics');
const engine = require('../engine/engine.cjs');

/**
 * Server-side analytics: the browser's engine over stored datasets.
 * Expected values are worked by hand from the rows below.
 */

const app = express();
app.use(express.json());
app.use('/api/v1/analytics', analyticsRouter);

const OWNER = 'owner-1';

async function storeReady(ownerId, name, columns, rows, { complete = true } = {}) {
  const dataset = await service.createDataset({ ownerId, name, sourceName: `${name}.csv`, columns });
  await service.appendRows({ ownerId, datasetId: dataset.id, startIndex: 0, rows });
  if (complete) await service.completeDataset({ ownerId, datasetId: dataset.id, expectedRowCount: rows.length });
  return dataset.id;
}

const ask = (body, user = OWNER) =>
  request(app).post('/api/v1/analytics/query').set('x-test-user', user).send(body);

const SALES_COLUMNS = [
  { name: 'Region', type: 'string' },
  { name: 'Amount', type: 'number' },
];
// " n " is the same region as "N", as the engine (and Ask Data) groups it.
const SALES_ROWS = [
  { Region: 'N', Amount: 10 },
  { Region: 'S', Amount: 20 },
  { Region: ' n ', Amount: 5 },
];

beforeEach(() => {
  repository.__resetMemoryStore();
  analytics.__resetModelCache();
  jest.restoreAllMocks();
});

describe('POST /api/v1/analytics/query', () => {
  test('evaluates DAX over every stored row: 10 + 20 + 5 = 35', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const res = await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ kind: 'dax', value: 35, formatted: '35' });
    expect(res.body.meta.rows).toBe(3);
  });

  test('answers a plain-English question, grouping as the browser does', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const res = await ask({ datasetIds: [id], question: 'total Amount by Region' });
    expect(res.status).toBe(200);
    expect(res.body.data.answer.rows).toEqual([['S', 20], ['N', 15]]);
  });

  test('gives exactly what the engine gives on the same rows', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const stored = await service.getDataset(id, OWNER);
    const direct = engine.runDax(
      'AVERAGE(Sales[Amount])',
      engine.buildSemanticModel([engine.datasetFromStore(stored, SALES_ROWS)])
    );
    const res = await ask({ datasetIds: [id], expression: 'AVERAGE(Sales[Amount])' });
    expect(res.body.data.value).toBe(direct.value);
  });

  test('works across related datasets: Retail orders 100 + 50 = 150', async () => {
    const customers = await storeReady(OWNER, 'Customers',
      [{ name: 'CustomerID', type: 'string' }, { name: 'Segment', type: 'string' }],
      [{ CustomerID: 'C1', Segment: 'Retail' }, { CustomerID: 'C2', Segment: 'Wholesale' }, { CustomerID: 'C3', Segment: 'Retail' }]);
    const orders = await storeReady(OWNER, 'Orders',
      [{ name: 'OrderID', type: 'string' }, { name: 'CustomerID', type: 'string' }, { name: 'Amount', type: 'number' }],
      [{ OrderID: 'O1', CustomerID: 'C1', Amount: 100 }, { OrderID: 'O2', CustomerID: 'C2', Amount: 70 },
       { OrderID: 'O3', CustomerID: 'C3', Amount: 50 }, { OrderID: 'O4', CustomerID: 'C2', Amount: 30 }]);
    const res = await ask({
      datasetIds: [orders, customers],
      expression: 'CALCULATE(SUM(Orders[Amount]), Customers[Segment] = "Retail")',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe(150);
  });

  test("refuses another owner's dataset as not found", async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const res = await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])' }, 'someone-else');
    expect(res.status).toBe(404);
  });

  test('refuses a dataset that is still uploading', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS, { complete: false });
    const res = await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])' });
    expect(res.status).toBe(409);
  });

  test('never answers over part of a dataset', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    jest.spyOn(repository, 'getDatasetRows').mockResolvedValueOnce(SALES_ROWS.slice(0, 2)).mockResolvedValueOnce([]);
    const res = await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])' });
    expect(res.status).toBe(409);
    expect(res.body.error?.message ?? JSON.stringify(res.body)).toMatch(/2 of its 3 rows/);
  });

  test('passes on the engine refusing an expression, with its reason', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const res = await ask({ datasetIds: [id], expression: 'SUM(Sales[Nope])' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/Nope/);
  });

  test('wants exactly one of expression and question', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    expect((await ask({ datasetIds: [id] })).status).toBe(400);
    expect((await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])', question: 'total Amount' })).status).toBe(400);
  });

  test('refuses more rows than one question may use', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ Region: 'N', Amount: i }));
    const id = await storeReady(OWNER, 'Big', SALES_COLUMNS, rows);
    const res = await ask({ datasetIds: [id], expression: 'SUM(Big[Amount])' });
    expect(res.status).toBe(413);
  });

  test('reuses the built model until the data changes', async () => {
    const id = await storeReady(OWNER, 'Sales', SALES_COLUMNS, SALES_ROWS);
    const first = await ask({ datasetIds: [id], expression: 'SUM(Sales[Amount])' });
    const second = await ask({ datasetIds: [id], expression: 'MAX(Sales[Amount])' });
    expect([first.body.meta.modelCached, second.body.meta.modelCached]).toEqual([false, true]);
    expect(second.body.data.value).toBe(20);
  });

  test('requires a signed-in user', async () => {
    const res = await request(app).post('/api/v1/analytics/query').send({ datasetIds: ['x'], expression: '1' });
    expect(res.status).toBe(401);
  });
});
