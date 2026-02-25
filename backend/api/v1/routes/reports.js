const express = require('express');
const { body, validationResult } = require('express-validator');
const reportsService = require('../../../modules/reports/reports.service');
const legacyReportsRoutes = require('../../../routes/reports');

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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Invalid request payload',
          details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
        });
      }

      const payload = await reportsService.submitReportRequest(req.body || {});
      return res.status(201).json(payload);
    } catch (error) {
      console.error('v1 report request error:', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to submit report request',
        message: `Please try again or contact us directly at ${reportsService.supportEmail}`,
      });
    }
  }
);

// Compatibility fallback for endpoints not yet migrated in Phase B.
router.use('/', legacyReportsRoutes);

module.exports = router;
