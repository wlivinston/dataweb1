const express = require('express');
const path = require('path');
const { hasServiceKey } = require('../../../config/supabase');
const { authenticateToken, requireAdmin } = require('../../../middleware/auth');
const { sendSuccess } = require('../../../modules/common/apiResponse');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'OK',
      apiVersion: 'v1',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      supabaseConfigured: hasServiceKey,
    },
  });
});

router.get('/openapi', (_req, res) => {
  const specPath = path.join(__dirname, '../../../openapi/v1.yaml');
  return res.sendFile(specPath);
});

router.get('/legacy-usage', authenticateToken, requireAdmin, (req, res) => {
  const telemetry = req.app?.locals?.legacyApiTelemetry;
  if (!telemetry?.snapshot) {
    return res.status(503).json({
      success: false,
      error: { code: 'LEGACY_TELEMETRY_UNAVAILABLE', message: 'Legacy telemetry is unavailable.' },
    });
  }

  const topRaw = Number.parseInt(String(req.query?.top || ''), 10);
  const snapshot = Number.isFinite(topRaw) ? telemetry.snapshot(topRaw) : telemetry.snapshot();
  return sendSuccess(res, { data: snapshot });
});

router.post('/legacy-usage/reset', authenticateToken, requireAdmin, (req, res) => {
  const telemetry = req.app?.locals?.legacyApiTelemetry;
  if (!telemetry?.reset) {
    return res.status(503).json({
      success: false,
      error: { code: 'LEGACY_TELEMETRY_UNAVAILABLE', message: 'Legacy telemetry is unavailable.' },
    });
  }

  const snapshot = telemetry.reset();
  return sendSuccess(res, {
    data: {
      message: 'Legacy API telemetry reset.',
      snapshot,
    },
  });
});

module.exports = router;
