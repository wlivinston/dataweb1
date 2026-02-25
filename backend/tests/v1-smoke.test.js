const request = require('supertest');
const app = require('../server');

describe('api v1 smoke', () => {
  test('GET /api/v1 exposes capability document and version header', async () => {
    const response = await request(app).get('/api/v1');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.body?.success).toBe(true);
    expect(response.body?.data?.version).toBe('v1');
  });

  test('GET /api/v1/system/health responds healthy envelope', async () => {
    const response = await request(app).get('/api/v1/system/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.body?.success).toBe(true);
    expect(response.body?.data?.status).toBe('OK');
  });

  test('GET /api/v1/system/openapi serves YAML contract', async () => {
    const response = await request(app).get('/api/v1/system/openapi');

    expect(response.status).toBe(200);
    expect(response.text).toContain('openapi: 3.0.3');
    expect(response.text).toContain('/finance/jobs/storage-mode');
  });

  test('GET /api/v1/finance/jobs/storage-mode requires authentication', async () => {
    const response = await request(app).get('/api/v1/finance/jobs/storage-mode');

    expect(response.status).toBe(401);
    expect(response.body?.error).toBe('Access token required');
  });
});

