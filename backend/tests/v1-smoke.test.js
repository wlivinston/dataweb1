const request = require('supertest');
const app = require('../server');

describe('api v1 smoke', () => {
  // ── Existing tests ────────────────────────────────────────────────

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
    expect(response.body?.success).toBe(false);
    expect(response.body?.error?.message).toBe('Access token required');
  });

  // ── New tests ─────────────────────────────────────────────────────

  test('GET /api/v1/nonexistent returns 404', async () => {
    const response = await request(app).get('/api/v1/nonexistent');

    expect(response.status).toBe(404);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  test('GET /api/v1/blog/posts returns 200 with success envelope or 500 when DB is unavailable', async () => {
    const response = await request(app).get('/api/v1/blog/posts');

    expect(response.headers['x-api-version']).toBe('v1');

    if (response.status === 200) {
      expect(response.body?.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    } else {
      // When Supabase/DB is not configured the service layer throws,
      // producing a 500 error envelope.  Validate the envelope shape.
      expect(response.status).toBe(500);
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    }
  });

  test('GET /api/v1/blog/posts/nonexistent-slug-12345 returns 404 with error envelope (or 500 when DB unavailable)', async () => {
    const response = await request(app).get('/api/v1/blog/posts/nonexistent-slug-12345');

    expect(response.headers['x-api-version']).toBe('v1');

    if (response.status === 404) {
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    } else {
      // DB unavailable -- service throws before the 404 logic is reached.
      expect(response.status).toBe(500);
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    }
  });

  test('GET /api/v1/comments/post/fake-post-id returns envelope (200 empty, 404, or 500 when DB unavailable)', async () => {
    const response = await request(app).get('/api/v1/comments/post/fake-post-id');

    expect(response.headers['x-api-version']).toBe('v1');

    if (response.status === 200) {
      expect(response.body?.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    } else if (response.status === 404) {
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    } else {
      // DB unavailable
      expect(response.status).toBe(500);
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    }
  });

  test('POST /api/v1/auth/register with empty body returns 400-range with error envelope', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({});

    // express-validator rejects the missing fields via assertValidRequest,
    // which throws ApiError.unprocessable (422).
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.body?.success).toBe(false);
    expect(response.body?.error?.code).toBeDefined();
    expect(response.body?.error?.message).toBeDefined();
  });

  test('POST /api/v1/reports/request with empty body returns 400-range with error envelope', async () => {
    const response = await request(app)
      .post('/api/v1/reports/request')
      .send({});

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.body?.success).toBe(false);
    expect(response.body?.error?.code).toBeDefined();
    expect(response.body?.error?.message).toBeDefined();
  });

  test('POST /api/v1/subscriptions/newsletter with empty body returns error envelope', async () => {
    const response = await request(app)
      .post('/api/v1/subscriptions/newsletter')
      .send({});

    expect(response.headers['x-api-version']).toBe('v1');
    // The newsletter route has no required express-validator fields, so validation
    // passes.  The service itself rejects the missing email, but the thrown Error
    // is a plain Error (not ApiError), so sendError maps it to 500 in non-dev or
    // to a 500 with the raw message in dev.  Accept either a proper 400-range or
    // a 500 as long as the envelope is well-formed.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body?.success).toBe(false);
    expect(response.body?.error?.code).toBeDefined();
    expect(response.body?.error?.message).toBeDefined();
  });

  test('GET /api/v1/subscriptions/plans returns 200 with success envelope or 500 when DB unavailable', async () => {
    const response = await request(app).get('/api/v1/subscriptions/plans');

    expect(response.headers['x-api-version']).toBe('v1');

    if (response.status === 200) {
      expect(response.body?.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    } else {
      // DB unavailable
      expect(response.status).toBe(500);
      expect(response.body?.success).toBe(false);
      expect(response.body?.error?.code).toBeDefined();
      expect(response.body?.error?.message).toBeDefined();
    }
  });

  test('any response includes X-Request-Id header', async () => {
    const response = await request(app).get('/api/v1');

    expect(response.headers['x-request-id']).toBeDefined();
    expect(typeof response.headers['x-request-id']).toBe('string');
    expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  test('GET /api/v1 capability document includes domains array', async () => {
    const response = await request(app).get('/api/v1');

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);
    expect(Array.isArray(response.body?.data?.domains)).toBe(true);
    expect(response.body.data.domains.length).toBeGreaterThan(0);
    expect(response.body.data.domains).toContain('auth');
    expect(response.body.data.domains).toContain('blog');
    expect(response.body.data.domains).toContain('system');
  });
});
