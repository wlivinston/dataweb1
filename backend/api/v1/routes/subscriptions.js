const express = require('express');
const { body, query, param } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../../../middleware/auth');
const subscriptionsService = require('../../../modules/subscriptions/subscriptions.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { ApiError } = require('../../../modules/common/apiError');

const router = express.Router();

router.get('/plans', async (_req, res) => {
  try {
    const plans = await subscriptionsService.listPublicPlans();
    return sendSuccess(res, { data: { plans } });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/pdf-pricing', async (req, res) => {
  try {
    const pricing = await subscriptionsService.getPdfPricing(req.query?.currency);
    return sendSuccess(res, { data: pricing });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const payload = await subscriptionsService.processStripeWebhook({
        rawBody: req.body,
        signature: req.headers['stripe-signature'],
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/webhooks/paystack',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const payload = await subscriptionsService.processPaystackWebhook({
        rawBody: req.body,
        signature: req.headers['x-paystack-signature'],
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/pdf-checkout',
  authenticateToken,
  [
    body('provider').optional().isIn(Array.from(subscriptionsService.SUPPORTED_PAYMENT_PROVIDERS)),
    body('plan').optional().isIn(Array.from(subscriptionsService.SUPPORTED_PDF_PLANS)),
    body('currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('return_path').optional().isString(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await subscriptionsService.createPdfCheckout({
        provider: req.body?.provider,
        plan: req.body?.plan,
        currency: req.body?.currency,
        returnPath: req.body?.return_path,
        user: req.user,
        req,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get(
  '/pdf-verify',
  authenticateToken,
  [
    query('provider').isIn(Array.from(subscriptionsService.SUPPORTED_PAYMENT_PROVIDERS)),
    query('session_id').optional().isString().trim(),
    query('reference').optional().isString().trim(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await subscriptionsService.verifyPdfPayment({
        provider: req.query?.provider,
        sessionId: req.query?.session_id,
        reference: req.query?.reference,
        user: req.user,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/newsletter',
  optionalAuth,
  [body('first_name').optional().trim(), body('last_name').optional().trim(), body('source').optional().trim()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const result = await subscriptionsService.subscribeNewsletter({
        payload: req.body,
        user: req.user,
        queryEmail: req.query?.email,
      });
      return sendSuccess(res, { status: result.statusCode || 200, data: result.body });
    } catch (error) {
      if (error?.code === '23505') {
        return sendSuccess(res, {
          data: {
            message: 'You are already subscribed to the newsletter.',
            email_sent: false,
            already_subscribed: true,
          },
        });
      }
      return sendError(res, error);
    }
  }
);

router.post(
  '/newsletter/unsubscribe',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await subscriptionsService.unsubscribeNewsletter({ email: req.body.email });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/pdf-access', authenticateToken, async (req, res) => {
  try {
    const access = await subscriptionsService.getPdfAccess(req.user);
    return sendSuccess(res, { data: access });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/subscribe',
  authenticateToken,
  [
    body('plan_id').isInt({ min: 1 }),
    body('payment_method').optional().trim(),
    body('auto_renew').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await subscriptionsService.createSubscription({
        customerId: req.user?.id,
        planId: req.body?.plan_id,
        paymentMethod: req.body?.payment_method,
        autoRenew:
          typeof req.body?.auto_renew === 'boolean' ? req.body.auto_renew : true,
      });
      return sendSuccess(res, { status: 201, data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/current', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.getCurrentSubscription(req.user?.id);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.cancelSubscription(req.user?.id);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/reactivate', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.reactivateSubscription(req.user?.id);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.getSubscriptionHistory(req.user?.id);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    if (req.user?.subscription_status !== 'admin') {
      throw ApiError.forbidden('Admin access required');
    }
    const payload = await subscriptionsService.getAllSubscriptionsAdmin({
      page: req.query?.page,
      limit: req.query?.limit,
      status: req.query?.status,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put(
  '/admin/:subscriptionId/status',
  authenticateToken,
  [
    param('subscriptionId').isInt({ min: 1 }),
    body('status').isIn(['active', 'cancelled', 'expired', 'pending']),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      if (req.user?.subscription_status !== 'admin') {
        throw ApiError.forbidden('Admin access required');
      }
      const payload = await subscriptionsService.updateSubscriptionStatusAdmin({
        subscriptionId: req.params.subscriptionId,
        status: req.body?.status,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

module.exports = router;
