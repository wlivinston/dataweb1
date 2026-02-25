const request = require('supertest');
const app = require('../server');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const root = await request(app).get('/api/v1');
  assert(root.status === 200, `Expected /api/v1 status 200, got ${root.status}`);
  assert(root.headers['x-api-version'] === 'v1', 'Expected X-API-Version header to be v1');
  assert(root.body?.success === true, 'Expected /api/v1 success=true');

  const health = await request(app).get('/api/v1/system/health');
  assert(health.status === 200, `Expected /api/v1/system/health status 200, got ${health.status}`);
  assert(health.body?.success === true, 'Expected /api/v1/system/health success=true');
  assert(health.body?.data?.status === 'OK', 'Expected health status=OK');

  const openapi = await request(app).get('/api/v1/system/openapi');
  assert(openapi.status === 200, `Expected /api/v1/system/openapi status 200, got ${openapi.status}`);
  assert(
    typeof openapi.text === 'string' && openapi.text.includes('/finance/jobs/storage-mode'),
    'Expected OpenAPI spec to include /finance/jobs/storage-mode'
  );

  const storageMode = await request(app).get('/api/v1/finance/jobs/storage-mode');
  assert(
    storageMode.status === 401,
    `Expected /api/v1/finance/jobs/storage-mode status 401 without auth, got ${storageMode.status}`
  );
  assert(
    storageMode.body?.error === 'Access token required',
    `Expected auth error for storage mode endpoint, got ${JSON.stringify(storageMode.body)}`
  );

  // Alias endpoint remains available during migration.
  const storageModeAlias = await request(app).get('/api/v1/finance/storage-mode');
  assert(
    storageModeAlias.status === 401,
    `Expected /api/v1/finance/storage-mode status 401 without auth, got ${storageModeAlias.status}`
  );

  console.log('v1 smoke checks passed');
}

run().catch((error) => {
  console.error('v1 smoke checks failed:', error.message);
  process.exitCode = 1;
});

