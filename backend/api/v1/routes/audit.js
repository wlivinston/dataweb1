const express = require('express');
const { query: queryParam } = require('express-validator');
const auditService = require('../../../modules/audit/audit.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { authenticateToken } = require('../../../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

/** The signed-in user's own audit trail, newest first. Never anyone else's. */
router.get('/me', [queryParam('limit').optional().isInt({ min: 1, max: 500 })], async (req, res) => {
  try {
    assertValidRequest(req);
    const events = await auditService.listMine((req.user && req.user.id) || '', req.query.limit);
    return sendSuccess(res, { data: events, meta: { count: events.length } });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
