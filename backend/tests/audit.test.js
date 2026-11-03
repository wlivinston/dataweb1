process.env.DATASET_STORAGE_MODE = 'memory';

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
const datasetsRepository = require('../modules/datasets/datasets.repository');
const auditRepository = require('../modules/audit/audit.repository');
const analytics = require('../modules/analytics/analytics.service');
const logger = require('../config/logger');

/**
 * The audit trail: every action on stored data and every refusal, append-only,
 * and never the data itself.
 */

const app = express();
app.use(express.json());
app.use('/api/v1/datasets', require('../api/v1/routes/datasets'));
app.use('/api/v1/analytics', require('../api/v1/routes/analytics'));
app.use('/api/v1/audit', require('../api/v1/routes/audit'));

const as = (user) => ({
  post: (path, body) => request(app).post(path).set('x-test-user', user).send(body),
  get: (path) => request(app).get(path).set('x-test-user', user),
  delete: (path) => request(app).delete(path).set('x-test-user', user),
});

const SECRET_VALUE = 'Confidential-Client-Name';
const QUESTION = 'what is the total Amount for Confidential-Client-Name?';

async function uploadSales(user) {
  const created = await as(user).post('/api/v1/datasets', {
    name: 'Sales', sourceName: 'sales.csv',
    columns: [{ name: 'Client', type: 'string' }, { name: 'Amount', type: 'number' }],
  });
  const id = created.body.data.id;
  await as(user).post(`/api/v1/datasets/${id}/rows`, { startIndex: 0, rows: [{ Client: SECRET_VALUE, Amount: 10 }, { Client: 'B', Amount: 5 }] });
  await as(user).post(`/api/v1/datasets/${id}/complete`, { expectedRowCount: 2 });
  return id;
}

const trail = async (user) => (await as(user).get('/api/v1/audit/me')).body.data;

beforeEach(() => {
  datasetsRepository.__resetMemoryStore();
  auditRepository.__resetMemoryStore();
  analytics.__resetModelCache();
  jest.restoreAllMocks();
});

describe('the audit trail', () => {
  test('records each action on stored data, newest first', async () => {
    const id = await uploadSales('alice');
    await as('alice').get(`/api/v1/datasets/${id}/rows`);
    await as('alice').post('/api/v1/analytics/query', { datasetIds: [id], question: QUESTION });
    await as('alice').delete(`/api/v1/datasets/${id}`);

    const events = await trail('alice');
    expect(events.map((e) => e.action)).toEqual([
      'dataset.delete', 'analytics.query', 'dataset.rows.read', 'dataset.complete', 'dataset.append', 'dataset.create',
    ]);
    expect(events.every((e) => e.outcome === 'ok' && e.actorId === 'alice')).toBe(true);
    expect(events.find((e) => e.action === 'dataset.complete').details).toEqual({ rowCount: 2 });
    expect(events.find((e) => e.action === 'analytics.query')).toMatchObject({ targetId: id, details: { kind: 'question', rows: 2 } });
  });

  test("records an attempt on someone else's dataset as denied, in the attempter's trail", async () => {
    const id = await uploadSales('alice');
    expect((await as('mallory').get(`/api/v1/datasets/${id}/rows`)).status).toBe(404);
    expect((await as('mallory').post('/api/v1/analytics/query', { datasetIds: [id], expression: 'SUM(Sales[Amount])' })).status).toBe(404);

    const attempts = await trail('mallory');
    expect(attempts.map((e) => [e.action, e.targetId, e.outcome])).toEqual([
      ['analytics.query', id, 'denied'],
      ['dataset.rows.read', id, 'denied'],
    ]);
    // Alice's own trail shows only what Alice did.
    expect((await trail('alice')).every((e) => e.actorId === 'alice')).toBe(true);
  });

  test('never contains the data or the question text', async () => {
    const id = await uploadSales('alice');
    await as('alice').get(`/api/v1/datasets/${id}/rows`);
    await as('alice').post('/api/v1/analytics/query', { datasetIds: [id], question: QUESTION });
    const everything = JSON.stringify(await trail('alice'));
    expect(everything).not.toContain(SECRET_VALUE);
    expect(everything).not.toContain('total Amount');
  });

  test('a user reads only their own trail', async () => {
    await uploadSales('alice');
    expect(await trail('bob')).toEqual([]);
  });

  test('stored events cannot be changed', async () => {
    await uploadSales('alice');
    const [event] = await trail('alice');
    const stored = (await auditRepository.listForActor('alice', 1))[0];
    expect(() => { 'use strict'; stored.details.rowCount = 999; }).toThrow();
    expect((await trail('alice'))[0]).toEqual(event);
  });

  test('a request still succeeds if its audit line cannot be written - and the failure is logged', async () => {
    jest.spyOn(auditRepository, 'append').mockRejectedValue(new Error('disk full'));
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await as('alice').post('/api/v1/datasets', { name: 'X', columns: [{ name: 'A', type: 'number' }] });
    expect(res.status).toBe(201);
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ action: 'dataset.create' }), 'audit event could not be recorded');
  });
});
