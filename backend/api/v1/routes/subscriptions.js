const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../../../middleware/auth');
const subscriptionsService = require('../../../modules/subscriptions/subscriptions.service');
const legacySubscriptionsRoutes = require('../../../routes/subscriptions');

const router = express.Router();

router.get('/plans', async (_req, res) => {
  try {
    const plans = await subscriptionsService.listPublicPlans();
    return res.json({ plans });
  } catch (error) {
    console.error('v1 subscription plans error:', error);
    return res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

router.get('/pdf-pricing', async (_req, res) => {
  try {
    const pricing = await subscriptionsService.getPdfPricing();
    return res.json(pricing);
  } catch (error) {
    console.error('v1 pdf pricing error:', error);
    return res.status(500).json({ error: 'Failed to fetch PDF pricing' });
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
      return res.status(200).json(payload);
    } catch (error) {
      console.error('v1 stripe webhook error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to process Stripe webhook',
      });
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
      return res.status(200).json(payload);
    } catch (error) {
      console.error('v1 paystack webhook error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to process Paystack webhook',
      });
    }
  }
);

router.post(
  '/pdf-checkout',
  authenticateToken,
  [
    body('provider').isIn(Array.from(subscriptionsService.SUPPORTED_PAYMENT_PROVIDERS)),
    body('plan').optional().isIn(Array.from(subscriptionsService.SUPPORTED_PDF_PLANS)),
    body('return_path').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await subscriptionsService.createPdfCheckout({
        provider: req.body?.provider,
        plan: req.body?.plan,
        returnPath: req.body?.return_path,
        user: req.user,
        req,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 create PDF checkout error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to initialize PDF checkout',
      });
    }
  }
);

router.get('/pdf-verify', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.verifyPdfPayment({
      provider: req.query?.provider,
      sessionId: req.query?.session_id,
      reference: req.query?.reference,
      user: req.user,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 verify PDF payment error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to verify PDF payment',
    });
  }
});

router.post(
  '/newsletter',
  optionalAuth,
  [body('first_name').optional().trim(), body('last_name').optional().trim(), body('source').optional().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const result = await subscriptionsService.subscribeNewsletter({
        payload: req.body,
        user: req.user,
        queryEmail: req.query?.email,
      });

      return res.status(result.statusCode || 200).json(result.body);
    } catch (error) {
      if (error?.code === '23505') {
        return res.json({
          message: 'You are already subscribed to the newsletter.',
          email_sent: false,
          already_subscribed: true,
        });
      }

      console.error('v1 newsletter subscription error:', error);
      const details = process.env.NODE_ENV === 'development' ? error?.message : undefined;
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to subscribe to newsletter',
        details,
      });
    }
  }
);

router.post(
  '/newsletter/unsubscribe',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await subscriptionsService.unsubscribeNewsletter({ email: req.body.email });
      return res.json(payload);
    } catch (error) {
      console.error('v1 newsletter unsubscribe error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to unsubscribe from newsletter',
      });
    }
  }
);

router.get('/pdf-access', authenticateToken, async (req, res) => {
  try {
    const access = await subscriptionsService.getPdfAccess(req.user);
    return res.json(access);
  } catch (error) {
    console.error('v1 pdf access status error:', error);
    const details = process.env.NODE_ENV === 'development' ? error?.message : undefined;
    return res.status(500).json({
      error: 'Failed to check PDF access status',
      details,
    });
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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await subscriptionsService.createSubscription({
        customerId: req.user?.id,
        planId: req.body?.plan_id,
        paymentMethod: req.body?.payment_method,
        autoRenew:
          typeof req.body?.auto_renew === 'boolean' ? req.body.auto_renew : true,
      });

      return res.status(201).json(payload);
    } catch (error) {
      console.error('v1 create subscription error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to create subscription',
      });
    }
  }
);

router.get('/current', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.getCurrentSubscription(req.user?.id);
    return res.json(payload);
  } catch (error) {
    console.error('v1 get current subscription error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch subscription',
    });
  }
});

router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.cancelSubscription(req.user?.id);
    return res.json(payload);
  } catch (error) {
    console.error('v1 cancel subscription error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to cancel subscription',
    });
  }
});

router.post('/reactivate', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.reactivateSubscription(req.user?.id);
    return res.json(payload);
  } catch (error) {
    console.error('v1 reactivate subscription error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to reactivate subscription',
    });
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const payload = await subscriptionsService.getSubscriptionHistory(req.user?.id);
    return res.json(payload);
  } catch (error) {
    console.error('v1 subscription history error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch subscription history',
    });
  }
});

router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    if (req.user?.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const payload = await subscriptionsService.getAllSubscriptionsAdmin({
      page: req.query?.page,
      limit: req.query?.limit,
      status: req.query?.status,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 get all subscriptions error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch subscriptions',
    });
  }
});

router.put(
  '/admin/:subscriptionId/status',
  authenticateToken,
  [body('status').isIn(['active', 'cancelled', 'expired', 'pending'])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (req.user?.subscription_status !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const payload = await subscriptionsService.updateSubscriptionStatusAdmin({
        subscriptionId: req.params.subscriptionId,
        status: req.body?.status,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 update subscription status error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to update subscription status',
      });
    }
  }
);

// Compatibility fallback for endpoints not yet migrated in Phase B.
router.use('/', legacySubscriptionsRoutes);

module.exports = router;
