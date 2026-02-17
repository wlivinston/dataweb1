const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { query } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { supabase } = require('../config/supabase');
const { sendSubscriptionEmail, sendUnsubscribeEmail } = require('../services/emailService');

const router = express.Router();

const SUPPORTED_PAYMENT_PROVIDERS = new Set(['stripe', 'paystack']);
const SUPPORTED_PDF_PLANS = new Set(['single', 'monthly']);
const PAID_PDF_STATUSES = new Set([
  'professional',
  'enterprise',
  'admin',
  'paid',
  'premium',
  'pro',
  'monthly',
  'annual',
]);

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeReturnPath(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('/')) return '/finance';
  if (raw.startsWith('//')) return '/finance';
  return raw;
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getPdfPlanConfig(plan) {
  const selectedPlan = plan === 'monthly' ? 'monthly' : 'single';

  if (selectedPlan === 'monthly') {
    return {
      plan: 'monthly',
      amount: Number(process.env.PDF_REPORT_MONTHLY_PRICE || 49),
      statusOnSuccess: 'professional',
      description: 'Monthly PDF report access',
    };
  }

  return {
    plan: 'single',
    amount: Number(process.env.PDF_REPORT_SINGLE_PRICE || 29),
    statusOnSuccess: 'paid',
    description: 'Single PDF report purchase',
  };
}

async function updateCustomerSubscriptionStatus(customerId, nextStatus) {
  if (supabase) {
    const { error } = await supabase
      .from('customers')
      .update({
        subscription_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

    if (error) throw error;
    return;
  }

  await query(
    'UPDATE customers SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [nextStatus, customerId]
  );
}

async function updateCustomerSubscriptionStatusByIdentity(identity, nextStatus) {
  const customerId = identity?.customerId ? Number(identity.customerId) : null;
  const email = identity?.email ? String(identity.email).trim().toLowerCase() : null;

  if (!customerId && !email) {
    throw new Error('Missing customer identity for subscription status update');
  }

  if (customerId) {
    await updateCustomerSubscriptionStatus(customerId, nextStatus);
    return;
  }

  if (supabase) {
    const { error } = await supabase
      .from('customers')
      .update({
        subscription_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('email', email);

    if (error) throw error;
    return;
  }

  await query(
    'UPDATE customers SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2',
    [nextStatus, email]
  );
}

function safeTimingCompare(aHex, bHex) {
  const a = Buffer.from(String(aHex || ''), 'hex');
  const b = Buffer.from(String(bHex || ''), 'hex');
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyStripeSignature(rawBodyBuffer, signatureHeader, webhookSecret) {
  if (!rawBodyBuffer || !signatureHeader || !webhookSecret) {
    return { valid: false, reason: 'Missing payload/signature/webhook secret' };
  }

  const parsedSignature = String(signatureHeader)
    .split(',')
    .map(segment => segment.trim())
    .reduce((acc, segment) => {
      const [key, value] = segment.split('=');
      if (key && value) {
        if (!acc[key]) acc[key] = [];
        acc[key].push(value);
      }
      return acc;
    }, {});

  const timestamp = parsedSignature.t?.[0];
  const candidateSignatures = parsedSignature.v1 || [];

  if (!timestamp || !candidateSignatures.length) {
    return { valid: false, reason: 'Missing Stripe timestamp/signature parts' };
  }

  const toleranceSeconds = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);
  const signedAt = Number(timestamp);
  if (Number.isFinite(signedAt) && toleranceSeconds > 0) {
    const current = Math.floor(Date.now() / 1000);
    if (Math.abs(current - signedAt) > toleranceSeconds) {
      return { valid: false, reason: 'Stripe signature timestamp outside tolerance window' };
    }
  }

  const signedPayload = `${timestamp}.${rawBodyBuffer.toString('utf8')}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const anyMatch = candidateSignatures.some(signature => safeTimingCompare(signature, expectedSignature));
  return anyMatch
    ? { valid: true }
    : { valid: false, reason: 'Stripe signature mismatch' };
}

function verifyPaystackSignature(rawBodyBuffer, signatureHeader, secretKey) {
  if (!rawBodyBuffer || !signatureHeader || !secretKey) {
    return { valid: false, reason: 'Missing payload/signature/secret key' };
  }

  const expectedSignature = crypto
    .createHmac('sha512', secretKey)
    .update(rawBodyBuffer)
    .digest('hex');

  const valid = safeTimingCompare(signatureHeader, expectedSignature);
  return valid
    ? { valid: true }
    : { valid: false, reason: 'Paystack signature mismatch' };
}

// Subscribe to newsletter (public, with optional auth context)
router.post('/newsletter', optionalAuth, [
  body('first_name').optional().trim(),
  body('last_name').optional().trim(),
  body('source').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedEmail =
      payload.email ||
      payload?.subscriber?.email ||
      payload?.newsletterEmail ||
      req.query?.email;
    const email = normalizeEmail(requestedEmail || req.user?.email);

    if (!email || !isLikelyEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const resolvedFirstName = String(payload.first_name || req.user?.first_name || 'Subscriber').trim();
    const resolvedLastName = String(payload.last_name || req.user?.last_name || '').trim();
    const resolvedSource = String(payload.source || 'website').trim();

    // Check if already subscribed
    const existingSubscriber = await query(
      'SELECT id, is_active FROM newsletter_subscribers WHERE lower(email) = lower($1)',
      [email]
    );

    if (existingSubscriber.rows.length > 0) {
      const subscriber = existingSubscriber.rows[0];
      
      if (subscriber.is_active) {
        return res.json({
          message: 'You are already subscribed to the newsletter.',
          email_sent: false,
          already_subscribed: true,
        });
      } else {
        // Reactivate subscription
        await query(
          `UPDATE newsletter_subscribers
           SET
             is_active = true,
             unsubscribed_at = NULL,
             source = COALESCE($1, source),
             first_name = COALESCE(NULLIF($2, ''), first_name),
             last_name = COALESCE(NULLIF($3, ''), last_name)
           WHERE id = $4`,
          [resolvedSource, resolvedFirstName, resolvedLastName, subscriber.id]
        );
        
        const emailSent = await sendSubscriptionEmail(email, resolvedFirstName || 'Subscriber');
        
        return res.json({
          message: 'Newsletter subscription reactivated successfully',
          email_sent: emailSent
        });
      }
    }

    // Create new subscription
    const result = await query(
      `INSERT INTO newsletter_subscribers (email, first_name, last_name, source)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name`,
      [email, resolvedFirstName, resolvedLastName || null, resolvedSource]
    );

    const subscriber = result.rows[0];

    // Send welcome email
    const emailSent = await sendSubscriptionEmail(email, resolvedFirstName || 'Subscriber');

    res.status(201).json({
      message: 'Newsletter subscription successful',
      email_sent: emailSent,
      subscriber: {
        id: subscriber.id,
        email: subscriber.email,
        first_name: subscriber.first_name,
        last_name: subscriber.last_name
      }
    });

  } catch (error) {
    if (error?.code === '23505') {
      return res.json({
        message: 'You are already subscribed to the newsletter.',
        email_sent: false,
        already_subscribed: true,
      });
    }

    console.error('Newsletter subscription error:', error);
    const details = process.env.NODE_ENV === 'development' ? error?.message : undefined;
    res.status(500).json({ error: 'Failed to subscribe to newsletter', details });
  }
});

// Unsubscribe from newsletter
router.post('/newsletter/unsubscribe', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    const result = await query(
      'UPDATE newsletter_subscribers SET is_active = false, unsubscribed_at = CURRENT_TIMESTAMP WHERE email = $1 AND is_active = true RETURNING id, first_name',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or already unsubscribed' });
    }

    const subscriber = result.rows[0];

    // Send unsubscribe confirmation email
    await sendUnsubscribeEmail(email, subscriber.first_name || 'Subscriber');

    res.json({ message: 'Successfully unsubscribed from newsletter' });

  } catch (error) {
    console.error('Newsletter unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe from newsletter' });
  }
});

// Get subscription plans (public endpoint)
router.get('/plans', async (req, res) => {
  try {
    let result;

    try {
      result = await query(
        `SELECT
          id,
          code,
          name,
          description,
          price,
          currency,
          billing_cycle,
          features,
          cta_label,
          cta_link,
          sort_order,
          is_highlighted,
          is_checkout_enabled,
          is_active,
          is_public
        FROM subscription_plans
        WHERE is_active = true
          AND is_public = true
        ORDER BY sort_order ASC, price ASC`,
        []
      );
    } catch (extendedQueryError) {
      // Backward-compatible fallback for older schemas missing new pricing columns.
      if (extendedQueryError?.code !== '42703') {
        throw extendedQueryError;
      }

      const fallbackResult = await query(
        `SELECT
          id,
          name,
          description,
          price,
          billing_cycle,
          features,
          is_active
        FROM subscription_plans
        WHERE is_active = true
        ORDER BY price ASC`,
        []
      );

      const plans = fallbackResult.rows.map((plan) => {
        const name = String(plan.name || '');
        const normalizedName = name.trim().toLowerCase();
        const isEnterprise = normalizedName.includes('enterprise');
        const isProfessional = normalizedName.includes('professional');

        return {
          ...plan,
          code: normalizedName.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
          cta_label: isEnterprise ? 'Request a Report' : 'Get Started',
          cta_link: isEnterprise ? '/request-report' : '/analyze',
          sort_order: isProfessional ? 20 : 100,
          is_highlighted: isProfessional,
          is_checkout_enabled: !isEnterprise,
          is_public: true,
        };
      });

      return res.json({ plans });
    }

    res.json({ plans: result.rows });

  } catch (error) {
    console.error('Get subscription plans error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

// Stripe webhook for PDF payment entitlement updates
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const signature = req.headers['stripe-signature'];
    const rawBody = req.body;

    if (!webhookSecret) {
      return res.status(500).json({ error: 'Stripe webhook secret is not configured' });
    }

    const verification = verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.reason || 'Invalid Stripe webhook signature' });
    }

    const event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    if (!event?.type || !event?.data?.object) {
      return res.status(400).json({ error: 'Invalid Stripe webhook payload structure' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const planKey = String(session?.metadata?.pdf_plan || 'single').toLowerCase();
      const plan = getPdfPlanConfig(planKey);

      const identity = {
        customerId: session?.metadata?.customer_id || null,
        email: session?.metadata?.email || session?.customer_details?.email || null,
      };

      if (!identity.customerId && !identity.email) {
        return res.status(200).json({ received: true, ignored: 'Missing identity metadata' });
      }

      await updateCustomerSubscriptionStatusByIdentity(identity, plan.statusOnSuccess);
      return res.status(200).json({ received: true, provider: 'stripe', processed: true });
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const planKey = String(invoice?.lines?.data?.[0]?.metadata?.pdf_plan || 'monthly').toLowerCase();
      const plan = getPdfPlanConfig(planKey === 'single' ? 'single' : 'monthly');

      const identity = {
        customerId: invoice?.metadata?.customer_id || invoice?.lines?.data?.[0]?.metadata?.customer_id || null,
        email: invoice?.customer_email || invoice?.lines?.data?.[0]?.metadata?.email || null,
      };

      if (identity.customerId || identity.email) {
        await updateCustomerSubscriptionStatusByIdentity(identity, plan.statusOnSuccess);
      }
    }

    res.status(200).json({ received: true, provider: 'stripe', processed: false });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Failed to process Stripe webhook' });
  }
});

// Paystack webhook for PDF payment entitlement updates
router.post('/webhooks/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    if (!paystackSecretKey) {
      return res.status(500).json({ error: 'Paystack secret key is not configured' });
    }

    const verification = verifyPaystackSignature(rawBody, signature, paystackSecretKey);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.reason || 'Invalid Paystack webhook signature' });
    }

    const event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    if (!event?.event || !event?.data) {
      return res.status(400).json({ error: 'Invalid Paystack webhook payload structure' });
    }

    if (event.event === 'charge.success') {
      const metadata = event.data?.metadata || {};
      const planKey = String(metadata?.pdf_plan || 'single').toLowerCase();
      const plan = getPdfPlanConfig(planKey);

      const identity = {
        customerId: metadata?.customer_id || null,
        email: metadata?.email || event.data?.customer?.email || null,
      };

      if (!identity.customerId && !identity.email) {
        return res.status(200).json({ received: true, ignored: 'Missing identity metadata' });
      }

      await updateCustomerSubscriptionStatusByIdentity(identity, plan.statusOnSuccess);
      return res.status(200).json({ received: true, provider: 'paystack', processed: true });
    }

    res.status(200).json({ received: true, provider: 'paystack', processed: false });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(500).json({ error: 'Failed to process Paystack webhook' });
  }
});

// Create checkout URL for paid PDF access (Stripe or Paystack)
router.post('/pdf-checkout', authenticateToken, [
  body('provider').isIn(['stripe', 'paystack']),
  body('plan').optional().isIn(['single', 'monthly']),
  body('return_path').optional().isString(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const provider = String(req.body.provider || '').toLowerCase();
    const requestedPlan = String(req.body.plan || 'single').toLowerCase();

    if (!SUPPORTED_PAYMENT_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'Unsupported payment provider' });
    }

    if (!SUPPORTED_PDF_PLANS.has(requestedPlan)) {
      return res.status(400).json({ error: 'Unsupported PDF plan' });
    }

    if (!req.user?.email) {
      return res.status(400).json({ error: 'User account is missing required billing fields' });
    }

    const customerIdentity =
      (req.user?.customer_id && String(req.user.customer_id).trim()) ||
      (req.user?.id && String(req.user.id).trim()) ||
      null;

    const plan = getPdfPlanConfig(requestedPlan);
    const frontendBase = normalizeBaseUrl(process.env.FRONTEND_URL || 'http://localhost:5173');
    const returnPath = normalizeReturnPath(req.body.return_path);

    if (provider === 'stripe') {
      const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
      if (!stripeSecretKey) {
        return res.status(500).json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
      }

      const stripeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
      const stripeSinglePriceId = (process.env.STRIPE_PDF_SINGLE_PRICE_ID || '').trim();
      const stripeMonthlyPriceId = (process.env.STRIPE_PDF_MONTHLY_PRICE_ID || '').trim();
      const mode = requestedPlan === 'monthly' ? 'subscription' : 'payment';
      const successUrl = `${frontendBase}${returnPath}?pdfPayment=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${frontendBase}${returnPath}?pdfPayment=cancel&provider=stripe`;

      const form = new URLSearchParams();
      form.append('mode', mode);
      form.append('success_url', successUrl);
      form.append('cancel_url', cancelUrl);
      form.append('line_items[0][quantity]', '1');
      form.append('customer_email', req.user.email);
      if (customerIdentity) {
        form.append('metadata[customer_id]', String(customerIdentity));
      }
      form.append('metadata[email]', req.user.email);
      form.append('metadata[pdf_plan]', requestedPlan);

      const selectedPriceId = requestedPlan === 'monthly' ? stripeMonthlyPriceId : stripeSinglePriceId;
      if (selectedPriceId) {
        form.append('line_items[0][price]', selectedPriceId);
      } else {
        form.append('line_items[0][price_data][currency]', stripeCurrency);
        form.append('line_items[0][price_data][unit_amount]', String(Math.round(plan.amount * 100)));
        form.append('line_items[0][price_data][product_data][name]', plan.description);

        if (requestedPlan === 'monthly') {
          form.append('line_items[0][price_data][recurring][interval]', 'month');
        }
      }

      const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });

      const stripePayload = await stripeResponse.json();
      if (!stripeResponse.ok || !stripePayload?.url) {
        return res.status(502).json({
          error: stripePayload?.error?.message || 'Failed to initialize Stripe checkout',
        });
      }

      return res.json({
        provider: 'stripe',
        plan: requestedPlan,
        checkout_url: stripePayload.url,
        session_id: stripePayload.id,
      });
    }

    const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
    if (!paystackSecretKey) {
      return res.status(500).json({ error: 'Paystack is not configured. Set PAYSTACK_SECRET_KEY.' });
    }

    const paystackCurrency = (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase();
    const paystackSingleAmount = Number(process.env.PAYSTACK_PDF_SINGLE_AMOUNT || plan.amount);
    const paystackMonthlyAmount = Number(process.env.PAYSTACK_PDF_MONTHLY_AMOUNT || plan.amount);
    const amount = requestedPlan === 'monthly' ? paystackMonthlyAmount : paystackSingleAmount;
    const callbackUrl = `${frontendBase}${returnPath}?pdfPayment=success&provider=paystack`;
    const referenceIdentity =
      customerIdentity ? String(customerIdentity).replace(/[^a-zA-Z0-9_-]/g, '') : 'guest';
    const reference = `pdf_${requestedPlan}_${referenceIdentity}_${Date.now()}`;

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100),
        currency: paystackCurrency,
        callback_url: callbackUrl,
        reference,
        metadata: {
          ...(customerIdentity ? { customer_id: customerIdentity } : {}),
          email: req.user.email,
          pdf_plan: requestedPlan,
        },
      }),
    });

    const paystackPayload = await paystackResponse.json();
    if (!paystackResponse.ok || !paystackPayload?.status || !paystackPayload?.data?.authorization_url) {
      return res.status(502).json({
        error: paystackPayload?.message || 'Failed to initialize Paystack checkout',
      });
    }

    return res.json({
      provider: 'paystack',
      plan: requestedPlan,
      checkout_url: paystackPayload.data.authorization_url,
      reference: paystackPayload.data.reference,
    });
  } catch (error) {
    console.error('Create PDF checkout error:', error);
    res.status(500).json({ error: 'Failed to initialize PDF checkout' });
  }
});

// Verify PDF payment and grant paid access
router.get('/pdf-verify', authenticateToken, async (req, res) => {
  try {
    const provider = String(req.query.provider || '').toLowerCase();
    if (!SUPPORTED_PAYMENT_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'Unsupported payment provider' });
    }

    if (!req.user?.email) {
      return res.status(400).json({ error: 'Invalid authenticated user context' });
    }

    if (provider === 'stripe') {
      const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
      const sessionId = String(req.query.session_id || '').trim();

      if (!stripeSecretKey) {
        return res.status(500).json({ error: 'Stripe is not configured.' });
      }
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing session_id for Stripe verification.' });
      }

      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${stripeSecretKey}` },
        }
      );

      const stripePayload = await stripeResponse.json();
      if (!stripeResponse.ok) {
        return res.status(502).json({
          error: stripePayload?.error?.message || 'Failed to verify Stripe payment',
        });
      }

      const isPaid =
        stripePayload?.payment_status === 'paid' ||
        stripePayload?.status === 'complete';

      if (!isPaid) {
        return res.status(400).json({ error: 'Stripe payment is not completed yet.' });
      }

      const requestedPlan = String(stripePayload?.metadata?.pdf_plan || 'single').toLowerCase();
      const plan = getPdfPlanConfig(requestedPlan);
      await updateCustomerSubscriptionStatusByIdentity(
        {
          customerId: req.user?.customer_id || req.user?.id || null,
          email: req.user?.email || null,
        },
        plan.statusOnSuccess
      );

      return res.json({
        verified: true,
        provider: 'stripe',
        plan: requestedPlan,
        subscription_status: plan.statusOnSuccess,
      });
    }

    const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
    const reference = String(req.query.reference || '').trim();

    if (!paystackSecretKey) {
      return res.status(500).json({ error: 'Paystack is not configured.' });
    }
    if (!reference) {
      return res.status(400).json({ error: 'Missing reference for Paystack verification.' });
    }

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      }
    );

    const paystackPayload = await paystackResponse.json();
    if (!paystackResponse.ok || !paystackPayload?.status) {
      return res.status(502).json({
        error: paystackPayload?.message || 'Failed to verify Paystack payment',
      });
    }

    const isPaid = paystackPayload?.data?.status === 'success';
    if (!isPaid) {
      return res.status(400).json({ error: 'Paystack payment is not successful yet.' });
    }

    const requestedPlan = String(paystackPayload?.data?.metadata?.pdf_plan || 'single').toLowerCase();
    const plan = getPdfPlanConfig(requestedPlan);
    await updateCustomerSubscriptionStatusByIdentity(
      {
        customerId: req.user?.customer_id || req.user?.id || null,
        email: req.user?.email || null,
      },
      plan.statusOnSuccess
    );

    return res.json({
      verified: true,
      provider: 'paystack',
      plan: requestedPlan,
      subscription_status: plan.statusOnSuccess,
    });
  } catch (error) {
    console.error('Verify PDF payment error:', error);
    res.status(500).json({ error: 'Failed to verify PDF payment' });
  }
});

// Get authenticated user's PDF access entitlement
router.get('/pdf-access', authenticateToken, async (req, res) => {
  try {
    const statusFromAuthContext = String(req.user?.subscription_status || '').toLowerCase().trim();
    if (statusFromAuthContext) {
      return res.json({
        has_access: PAID_PDF_STATUSES.has(statusFromAuthContext),
        subscription_status: statusFromAuthContext,
      });
    }

    const identityId = String(req.user?.customer_id || req.user?.id || '').trim();
    const identityEmail = normalizeEmail(req.user?.email || '');

    let customerStatus = '';

    if (identityId || identityEmail) {
      try {
        const result = await query(
          `SELECT subscription_status
           FROM customers
           WHERE ($1 <> '' AND id::text = $1)
              OR ($1 <> '' AND auth_user_id::text = $1)
              OR ($2 <> '' AND lower(email) = lower($2))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
           LIMIT 1`,
          [identityId, identityEmail]
        );
        customerStatus = String(result?.rows?.[0]?.subscription_status || '').toLowerCase().trim();
      } catch (identityLookupError) {
        if (identityLookupError?.code !== '42703') {
          throw identityLookupError;
        }

        const fallbackResult = await query(
          `SELECT subscription_status
           FROM customers
           WHERE ($1 <> '' AND id::text = $1)
              OR ($2 <> '' AND lower(email) = lower($2))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
           LIMIT 1`,
          [identityId, identityEmail]
        );
        customerStatus = String(fallbackResult?.rows?.[0]?.subscription_status || '').toLowerCase().trim();
      }
    }

    return res.json({
      has_access: PAID_PDF_STATUSES.has(customerStatus),
      subscription_status: customerStatus || null,
    });
  } catch (error) {
    console.error('Get PDF access status error:', error);
    const details = process.env.NODE_ENV === 'development' ? error?.message : undefined;
    return res.status(500).json({ error: 'Failed to check PDF access status', details });
  }
});

// Create customer subscription (requires authentication)
router.post('/subscribe', authenticateToken, [
  body('plan_id').isInt({ min: 1 }),
  body('payment_method').optional().trim(),
  body('auto_renew').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { plan_id, payment_method, auto_renew = true } = req.body;

    // Check if plan exists
    const planResult = await query(
      'SELECT id, name, price, billing_cycle FROM subscription_plans WHERE id = $1 AND is_active = true',
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    const plan = planResult.rows[0];

    // Check if user already has an active subscription
    const existingSubscription = await query(
      'SELECT id, status FROM customer_subscriptions WHERE customer_id = $1 AND status IN ($2, $3)',
      [req.user.id, 'active', 'pending']
    );

    if (existingSubscription.rows.length > 0) {
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    // Calculate subscription dates
    const startDate = new Date();
    let endDate = new Date();
    
    switch (plan.billing_cycle) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
      default:
        endDate.setMonth(endDate.getMonth() + 1);
    }

    // Create subscription
    const subscriptionResult = await query(
      `INSERT INTO customer_subscriptions (customer_id, plan_id, status, start_date, end_date, auto_renew, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, customer_id, plan_id, status, start_date, end_date`,
      [req.user.id, plan_id, 'pending', startDate, endDate, auto_renew, payment_method]
    );

    const subscription = subscriptionResult.rows[0];

    // Create initial payment record
    await query(
      `INSERT INTO subscription_payments (subscription_id, amount, currency, payment_method, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [subscription.id, plan.price, 'USD', payment_method, 'pending']
    );

    // Update customer subscription status
    await query(
      'UPDATE customers SET subscription_status = $1 WHERE id = $2',
      [plan.name.toLowerCase(), req.user.id]
    );

    res.status(201).json({
      message: 'Subscription created successfully',
      subscription: {
        id: subscription.id,
        plan: plan.name,
        status: subscription.status,
        start_date: subscription.start_date,
        end_date: subscription.end_date,
        price: plan.price,
        billing_cycle: plan.billing_cycle
      }
    });

  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Get user's current subscription
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        cs.id, cs.status, cs.start_date, cs.end_date, cs.auto_renew, cs.payment_method,
        sp.name as plan_name, sp.description as plan_description, sp.price, sp.billing_cycle, sp.features
       FROM customer_subscriptions cs
       JOIN subscription_plans sp ON cs.plan_id = sp.id
       WHERE cs.customer_id = $1 AND cs.status IN ('active', 'pending')
       ORDER BY cs.created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ subscription: null });
    }

    const subscription = result.rows[0];

    // Get payment history
    const paymentsResult = await query(
      'SELECT id, amount, currency, payment_method, status, payment_date FROM subscription_payments WHERE subscription_id = $1 ORDER BY payment_date DESC',
      [subscription.id]
    );

    res.json({
      subscription: {
        ...subscription,
        payments: paymentsResult.rows
      }
    });

  } catch (error) {
    console.error('Get current subscription error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// Cancel subscription
router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE customer_subscriptions 
       SET status = 'cancelled', auto_renew = false, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND status = 'active'
       RETURNING id, end_date`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscription = result.rows[0];

    // Update customer status
    await query(
      'UPDATE customers SET subscription_status = $1 WHERE id = $2',
      ['cancelled', req.user.id]
    );

    res.json({
      message: 'Subscription cancelled successfully',
      subscription: {
        id: subscription.id,
        status: 'cancelled',
        end_date: subscription.end_date
      }
    });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Reactivate subscription
router.post('/reactivate', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE customer_subscriptions 
       SET status = 'active', auto_renew = true, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND status = 'cancelled'
       RETURNING id, plan_id`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No cancelled subscription found' });
    }

    const subscription = result.rows[0];

    // Get plan details
    const planResult = await query(
      'SELECT name FROM subscription_plans WHERE id = $1',
      [subscription.plan_id]
    );

    if (planResult.rows.length > 0) {
      await query(
        'UPDATE customers SET subscription_status = $1 WHERE id = $2',
        [planResult.rows[0].name.toLowerCase(), req.user.id]
      );
    }

    res.json({
      message: 'Subscription reactivated successfully',
      subscription: {
        id: subscription.id,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('Reactivate subscription error:', error);
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

// Get subscription history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        cs.id, cs.status, cs.start_date, cs.end_date, cs.auto_renew, cs.created_at,
        sp.name as plan_name, sp.price, sp.billing_cycle
       FROM customer_subscriptions cs
       JOIN subscription_plans sp ON cs.plan_id = sp.id
       WHERE cs.customer_id = $1
       ORDER BY cs.created_at DESC`,
      [req.user.id]
    );

    res.json({ subscriptions: result.rows });

  } catch (error) {
    console.error('Get subscription history error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription history' });
  }
});

// Admin: Get all subscriptions
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [limit, offset];
    let paramIndex = 3;

    if (status) {
      whereClause = `WHERE cs.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const result = await query(
      `SELECT 
        cs.id, cs.status, cs.start_date, cs.end_date, cs.auto_renew, cs.created_at,
        sp.name as plan_name, sp.price, sp.billing_cycle,
        c.email, c.first_name, c.last_name, c.company
       FROM customer_subscriptions cs
       JOIN subscription_plans sp ON cs.plan_id = sp.id
       JOIN customers c ON cs.customer_id = c.id
       ${whereClause}
       ORDER BY cs.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM customer_subscriptions cs ${whereClause}`,
      status ? [status] : []
    );

    res.json({
      subscriptions: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      }
    });

  } catch (error) {
    console.error('Get all subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Admin: Update subscription status
router.put('/admin/:subscriptionId/status', authenticateToken, [
  body('status').isIn(['active', 'cancelled', 'expired', 'pending'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if user is admin
    if (req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { subscriptionId } = req.params;
    const { status } = req.body;

    const result = await query(
      'UPDATE customer_subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, customer_id, status',
      [status, subscriptionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscription = result.rows[0];

    // Update customer subscription status
    await query(
      'UPDATE customers SET subscription_status = $1 WHERE id = $2',
      [status, subscription.customer_id]
    );

    res.json({
      message: 'Subscription status updated successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status
      }
    });

  } catch (error) {
    console.error('Update subscription status error:', error);
    res.status(500).json({ error: 'Failed to update subscription status' });
  }
});

module.exports = router;
