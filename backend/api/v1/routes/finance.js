const express = require('express');
const { body, query, param } = require('express-validator');
const { authenticateToken } = require('../../../middleware/auth');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { ApiError } = require('../../../modules/common/apiError');
const jobsService = require('../../../modules/jobs/jobs.service');
const financeService = require('../../../modules/finance/finance.service');

const router = express.Router();

const FINANCE_JOB_TYPES = new Set([
  'finance.ingestion',
  'finance.reconciliation',
  'finance.report',
]);

function getOwnerId(req) {
  return req?.user?.id || req?.user?.email || null;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

jobsService.registerProcessor('finance.ingestion', async (input, progress) => {
  await progress(10, 'Validating ingestion input');
  const parsed = financeService.ingestBookData(input);
  await progress(100, 'Ingestion completed');
  return parsed;
});

jobsService.registerProcessor('finance.reconciliation', async (input, progress) => {
  await progress(10, 'Parsing bank and GL inputs');
  const result = financeService.reconcileData(input);
  await progress(100, 'Reconciliation completed');
  return result;
});

jobsService.registerProcessor('finance.report', async (input, progress) => {
  await progress(10, 'Validating report input');
  const result = financeService.generateReportFromInput(input);
  await progress(100, 'Report generation completed');
  return result;
});

async function enqueueFinanceJob(req, res, type, input) {
  const idempotencyKey = String(req.header('Idempotency-Key') || '').trim();
  const ownerId = getOwnerId(req);
  const enqueued = await jobsService.enqueueJob({
    type,
    ownerId,
    idempotencyKey,
    input,
  });

  return sendSuccess(res, {
    status: enqueued.reused ? 200 : 202,
    data: {
      job: enqueued.job,
      reused: enqueued.reused,
    },
  });
}

async function handleStorageMode(_req, res) {
  try {
    const info = await jobsService.getStorageInfo();
    return sendSuccess(res, { data: info });
  } catch (error) {
    return sendError(res, error);
  }
}

router.post(
  '/ingestion/jobs',
  authenticateToken,
  [
    body('rows').isArray({ min: 1 }),
    body('mapping').optional({ nullable: true }).isObject(),
    body('options').optional({ nullable: true }).isObject(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = {
        rows: req.body.rows,
        mapping: req.body.mapping || {},
        options: req.body.options || {},
      };

      return enqueueFinanceJob(req, res, 'finance.ingestion', payload);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/reconciliation/jobs',
  authenticateToken,
  [
    body('bankRows').isArray({ min: 1 }),
    body('bookRows')
      .optional({ nullable: true })
      .isArray(),
    body('bookTransactions')
      .optional({ nullable: true })
      .isArray(),
    body('bankMapping').optional({ nullable: true }).isObject(),
    body('bookMapping').optional({ nullable: true }).isObject(),
    body('options').optional({ nullable: true }).isObject(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const hasBookRows = Array.isArray(req.body.bookRows) && req.body.bookRows.length > 0;
      const hasBookTransactions =
        Array.isArray(req.body.bookTransactions) && req.body.bookTransactions.length > 0;
      if (!hasBookRows && !hasBookTransactions) {
        throw ApiError.badRequest(
          'Provide either bookRows or bookTransactions for reconciliation',
          null,
          'BOOK_INPUT_REQUIRED'
        );
      }

      const payload = {
        bankRows: req.body.bankRows,
        bankMapping: req.body.bankMapping || {},
        bookRows: hasBookRows ? req.body.bookRows : undefined,
        bookTransactions: hasBookTransactions ? req.body.bookTransactions : undefined,
        bookMapping: req.body.bookMapping || {},
        options: req.body.options || {},
      };

      return enqueueFinanceJob(req, res, 'finance.reconciliation', payload);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/reports/jobs',
  authenticateToken,
  [
    body('transactions').optional({ nullable: true }).isArray(),
    body('rows').optional({ nullable: true }).isArray(),
    body('mapping').optional({ nullable: true }).isObject(),
    body('options').optional({ nullable: true }).isObject(),
    body('companyName').optional({ nullable: true }).isString().isLength({ max: 160 }),
    body('reportPeriod').optional({ nullable: true }).isString().isLength({ max: 80 }),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const hasTransactions =
        Array.isArray(req.body.transactions) && req.body.transactions.length > 0;
      const hasRows = Array.isArray(req.body.rows) && req.body.rows.length > 0;
      if (!hasTransactions && !hasRows) {
        throw ApiError.badRequest(
          'Provide transactions or rows to generate a report',
          null,
          'REPORT_INPUT_REQUIRED'
        );
      }

      const payload = {
        transactions: hasTransactions ? req.body.transactions : undefined,
        rows: hasRows ? req.body.rows : undefined,
        mapping: req.body.mapping || {},
        options: req.body.options || {},
        companyName: req.body.companyName,
        reportPeriod: req.body.reportPeriod,
      };

      return enqueueFinanceJob(req, res, 'finance.report', payload);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/jobs/storage-mode', authenticateToken, handleStorageMode);

router.get(
  '/jobs/:jobId',
  authenticateToken,
  [param('jobId').isUUID(), query('includeInput').optional().isString()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const job = await jobsService.getJobForOwner(req.params.jobId, getOwnerId(req), {
        includeInput: parseBoolean(req.query.includeInput, false),
      });

      return sendSuccess(res, { data: { job } });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get(
  '/jobs',
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString(),
    query('type')
      .optional()
      .isString()
      .custom((value) => {
        if (!value) return true;
        if (!FINANCE_JOB_TYPES.has(value)) {
          throw new Error('Unsupported finance job type');
        }
        return true;
      }),
    query('includeInput').optional().isString(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const listed = await jobsService.listJobsForOwner(
        getOwnerId(req),
        {
          page: req.query.page,
          limit: req.query.limit,
          status: req.query.status,
          type: req.query.type,
        },
        {
          includeInput: parseBoolean(req.query.includeInput, false),
        }
      );

      return sendSuccess(res, { data: { jobs: listed.jobs }, meta: listed.meta });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

// Compatibility alias during migration; prefer /jobs/storage-mode in new clients.
router.get('/storage-mode', authenticateToken, handleStorageMode);

module.exports = router;
