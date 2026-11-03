const express = require('express');
const { body } = require('express-validator');
const analyticsService = require('../../../modules/analytics/analytics.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { authenticateToken } = require('../../../middleware/auth');
const audit = require('../../../modules/audit/audit.service');

const router = express.Router();

/**
 * Server-side analytics: the browser's DAX engine, run over stored datasets.
 * Authenticated and owner-scoped like every dataset route.
 */
router.use(authenticateToken);

router.post(
  '/query',
  [
    body('datasetIds').isArray({ min: 1, max: 10 }),
    body('datasetIds.*').isString().trim().notEmpty(),
    body('expression').optional().isString(),
    body('question').optional().isString(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const { data, meta } = await analyticsService.query({
        ownerId: (req.user && req.user.id) || '',
        datasetIds: req.body.datasetIds,
        expression: req.body.expression,
        question: req.body.question,
      });
      // The question or DAX text is not recorded: it can quote the data.
      await audit.record({
        req, action: 'analytics.query', targetType: 'dataset', targetId: (req.body.datasetIds || []).join(','),
        details: { kind: data.kind, rows: meta.rows },
      });
      return sendSuccess(res, { data, meta });
    } catch (error) {
      await audit.record({
        req, action: 'analytics.query', targetType: 'dataset',
        targetId: Array.isArray(req.body && req.body.datasetIds) ? req.body.datasetIds.join(',') : null,
        outcome: audit.outcomeForError(error),
      });
      return sendError(res, error);
    }
  }
);

module.exports = router;
