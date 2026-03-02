const express = require('express');
const { body } = require('express-validator');
const reportsService = require('../../../modules/reports/reports.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');

const router = express.Router();

router.post(
  '/request',
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('company').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
    body('reportType')
      .isString()
      .trim()
      .custom((value) => {
        if (!reportsService.isAllowedReportType(value)) {
          throw new Error('Unsupported reportType');
        }
        return true;
      }),
    body('description').isString().trim().isLength({ min: 10, max: 4000 }),
    body('timeline').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('budget').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await reportsService.submitReportRequest(req.body || {});
      return sendSuccess(res, { status: 201, data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

module.exports = router;
