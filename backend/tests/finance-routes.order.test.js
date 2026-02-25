const financeRouter = require('../api/v1/routes/finance');

describe('finance v1 route registration order', () => {
  test('registers /jobs/storage-mode before /jobs/:jobId', () => {
    const paths = financeRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    const storageModeIndex = paths.indexOf('/jobs/storage-mode');
    const jobIdIndex = paths.indexOf('/jobs/:jobId');

    expect(storageModeIndex).toBeGreaterThanOrEqual(0);
    expect(jobIdIndex).toBeGreaterThanOrEqual(0);
    expect(storageModeIndex).toBeLessThan(jobIdIndex);
  });
});

