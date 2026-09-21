const express = require('express');
const { body, param, query: queryParam } = require('express-validator');
const datasetsService = require('../../../modules/datasets/datasets.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { authenticateToken } = require('../../../middleware/auth');

const router = express.Router();

/**
 * Stored datasets.
 *
 * Every route is authenticated and every query is scoped to req.user.id. A
 * dataset is the user's own data - often the most sensitive thing they will
 * ever put into this product - so ownership is enforced in the service on
 * each lookup rather than assumed from a path that happens to hold a UUID.
 */
router.use(authenticateToken);

const ownerOf = (req) => (req.user && req.user.id) || '';

router.get('/', async (req, res) => {
  try {
    const datasets = await datasetsService.listDatasets(ownerOf(req));
    return sendSuccess(res, { data: datasets, meta: { count: datasets.length } });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/',
  [
    body('name').isString().trim().isLength({ min: 1, max: 200 }),
    body('sourceName').optional({ nullable: true }).isString().trim().isLength({ max: 400 }),
    body('columns').isArray({ min: 1 }),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const { name, sourceName, columns } = req.body || {};
      const dataset = await datasetsService.createDataset({
        ownerId: ownerOf(req),
        name,
        sourceName,
        columns,
      });
      return sendSuccess(res, { status: 201, data: dataset });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

/**
 * Append a batch of rows to a dataset that is still building.
 *
 * Upload is three steps - create the header, send batches, complete - because
 * a dataset large enough to be worth moving off the browser cannot fit in one
 * request body.
 */
router.post(
  '/:id/rows',
  [
    param('id').isString().trim().notEmpty(),
    body('startIndex').isInt({ min: 0 }),
    body('rows').isArray({ min: 1 }),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const result = await datasetsService.appendRows({
        ownerId: ownerOf(req),
        datasetId: req.params.id,
        startIndex: req.body.startIndex,
        rows: req.body.rows,
      });
      return sendSuccess(res, { status: 202, data: result });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

/**
 * Finish a dataset. The declared row count is checked against what is stored,
 * and a mismatch leaves the dataset unreadable rather than quietly short.
 */
router.post(
  '/:id/complete',
  [param('id').isString().trim().notEmpty(), body('expectedRowCount').isInt({ min: 0 })],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const dataset = await datasetsService.completeDataset({
        ownerId: ownerOf(req),
        datasetId: req.params.id,
        expectedRowCount: req.body.expectedRowCount,
      });
      return sendSuccess(res, { data: dataset });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/limits', (_req, res) => {
  // Published so a client can refuse an oversized upload before sending it,
  // rather than discovering the limit after a long transfer.
  return sendSuccess(res, { data: datasetsService.limits });
});

router.get('/:id', [param('id').isString().trim().notEmpty()], async (req, res) => {
  try {
    assertValidRequest(req);
    const dataset = await datasetsService.getDataset(req.params.id, ownerOf(req));
    return sendSuccess(res, { data: dataset });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(
  '/:id/rows',
  [
    param('id').isString().trim().notEmpty(),
    queryParam('offset').optional().isInt({ min: 0 }),
    queryParam('limit').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const { rows, meta } = await datasetsService.getDatasetRows(req.params.id, ownerOf(req), {
        offset: req.query.offset,
        limit: req.query.limit,
      });
      return sendSuccess(res, { data: rows, meta });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.delete('/:id', [param('id').isString().trim().notEmpty()], async (req, res) => {
  try {
    assertValidRequest(req);
    await datasetsService.deleteDataset(req.params.id, ownerOf(req));
    return sendSuccess(res, { status: 200, data: { deleted: true } });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
