const express = require('express');
const { body } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../../../middleware/auth');
const pushService = require('../../../services/pushService');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');

const router = express.Router();

// Public — frontend needs this to subscribe
router.get('/vapid-public-key', (_req, res) => {
  const key = pushService.getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ success: false, error: { message: 'Push notifications not configured' } });
  }
  return sendSuccess(res, { data: { key } });
});

// Save a push subscription
router.post(
  '/subscribe',
  authenticateToken,
  [
    body('endpoint').isURL({ require_protocol: true }),
    body('keys.p256dh').isString().notEmpty(),
    body('keys.auth').isString().notEmpty(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      await pushService.saveSubscription(
        req.user.id,
        req.user.email,
        { endpoint: req.body.endpoint, keys: req.body.keys },
        req.get('User-Agent')
      );
      return sendSuccess(res, { data: { subscribed: true } }, 201);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

// Remove a push subscription
router.delete(
  '/unsubscribe',
  authenticateToken,
  [body('endpoint').isURL({ require_protocol: true })],
  async (req, res) => {
    try {
      assertValidRequest(req);
      await pushService.removeSubscription(req.body.endpoint);
      return sendSuccess(res, { data: { subscribed: false } });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

// Check if user has active push subscriptions
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = await pushService.getSubscriptionStatus(req.user.id);
    return sendSuccess(res, { data: status });
  } catch (error) {
    return sendError(res, error);
  }
});

// Admin: send subscription expiry reminders
router.get('/admin/send-reminders', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const result = await pushService.sendExpiryReminders(3);
    return sendSuccess(res, { data: result });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
