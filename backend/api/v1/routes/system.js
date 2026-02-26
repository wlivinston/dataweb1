const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { hasServiceKey } = require('../../../config/supabase');
const { authenticateToken, requireAdmin } = require('../../../middleware/auth');
const { sendSuccess } = require('../../../modules/common/apiResponse');

const router = express.Router();
const LEGACY_USAGE_MONITOR_TOKEN = String(process.env.LEGACY_USAGE_MONITOR_TOKEN || '').trim();

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuffer.length || !rightBuffer.length) return false;
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hasValidLegacyUsageMonitorToken = (req) => {
  if (!LEGACY_USAGE_MONITOR_TOKEN) return false;
  const candidate = String(req.get('x-legacy-monitor-token') || '').trim();
  return timingSafeEqual(candidate, LEGACY_USAGE_MONITOR_TOKEN);
};

const authorizeLegacyUsageRead = async (req, res, next) => {
  if (hasValidLegacyUsageMonitorToken(req)) {
    return next();
  }

  return authenticateToken(req, res, () => requireAdmin(req, res, next));
};

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

router.get('/legacy-usage', authorizeLegacyUsageRead, (req, res) => {
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
