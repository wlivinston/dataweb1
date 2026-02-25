const express = require('express');
const path = require('path');
const { hasServiceKey } = require('../../../config/supabase');

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

module.exports = router;
