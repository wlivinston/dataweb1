const express = require('express');
const authRoutes = require('./routes/auth');
const blogRoutes = require('./routes/blog');
const commentsRoutes = require('./routes/comments');
const reportsRoutes = require('./routes/reports');
const subscriptionsRoutes = require('./routes/subscriptions');
const financeRoutes = require('./routes/finance');
const systemRoutes = require('./routes/system');

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('X-API-Version', 'v1');
  return next();
});

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      version: 'v1',
      status: 'active',
      domains: ['auth', 'blog', 'comments', 'reports', 'subscriptions', 'finance', 'system'],
      openapi: '/api/v1/system/openapi',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/blog', blogRoutes);
router.use('/comments', commentsRoutes);
router.use('/reports', reportsRoutes);
router.use('/subscriptions', subscriptionsRoutes);
router.use('/finance', financeRoutes);
router.use('/system', systemRoutes);

module.exports = router;
