const crypto = require('crypto');
const { supabase } = require('../../config/supabase');
const {
  sendSubscriptionEmail,
  sendUnsubscribeEmail,
} = require('../../services/emailService');
const subscriptionsRepository = require('./subscriptions.repository');

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

const EXCHANGE_RATE_CACHE = new Map();

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

function resolveFrontendBase(req) {
  const configuredBase = normalizeBaseUrl(process.env.FRONTEND_URL || '');
  const requestOrigin = normalizeBaseUrl(req?.headers?.origin || '');

  const allowedOrigins = new Set(
    String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => normalizeBaseUrl(origin))
      .filter(Boolean)
  );

  if (configuredBase) {
    allowedOrigins.add(configuredBase);
    try {
      const configuredUrl = new URL(configuredBase);
      const host = configuredUrl.hostname || '';
      if (host.startsWith('www.')) {
        allowedOrigins.add(`${configuredUrl.protocol}//${host.slice(4)}`);
      } else if (!['localhost', '127.0.0.1'].includes(host)) {
        allowedOrigins.add(`${configuredUrl.protocol}//www.${host}`);
      }
    } catch (_error) {
      // Ignore malformed configured base URL and fall back to defaults below.
    }
  }

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  if (configuredBase) {
    return configuredBase;
  }

  return requestOrigin || 'http://localhost:5173';
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isTruthyEnv(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function toExchangeRateCacheTtlMs() {
  const configuredTtl = Number(process.env.EXCHANGE_RATE_CACHE_TTL_MS || 600000);
  if (!Number.isFinite(configuredTtl) || configuredTtl <= 0) return 600000;
  return configuredTtl;
}

async function fetchExchangeRateFromFrankfurter(fromCurrency, toCurrency) {
  const response = await fetch(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`
  );

  const payload = await response.json().catch(() => null);
  const rate = Number(payload?.rates?.[toCurrency]);
  if (!response.ok || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Frankfurter rate lookup failed');
  }

  return rate;
}

async function fetchExchangeRateFromOpenErApi(fromCurrency, toCurrency) {
  const response = await fetch(
    `https://open.er-api.com/v6/latest/${encodeURIComponent(fromCurrency)}`
  );

  const payload = await response.json().catch(() => null);
  const rate = Number(payload?.rates?.[toCurrency]);
  if (!response.ok || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Open ER API rate lookup failed');
  }

  return rate;
}

async function getExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const cacheKey = `${fromCurrency}->${toCurrency}`;
  const now = Date.now();
  const ttlMs = toExchangeRateCacheTtlMs();
  const cached = EXCHANGE_RATE_CACHE.get(cacheKey);
  if (cached && now - cached.timestamp < ttlMs) {
    return cached.rate;
  }

  let resolvedRate = null;
  let lastError = null;

  const lookups = [fetchExchangeRateFromFrankfurter, fetchExchangeRateFromOpenErApi];
  for (const lookup of lookups) {
    try {
      resolvedRate = await lookup(fromCurrency, toCurrency);
      if (Number.isFinite(resolvedRate) && resolvedRate > 0) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!Number.isFinite(resolvedRate) || resolvedRate <= 0) {
    throw lastError || new Error('Unable to retrieve exchange rate');
  }

  EXCHANGE_RATE_CACHE.set(cacheKey, {
    rate: resolvedRate,
    timestamp: now,
  });

  return resolvedRate;
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

async function resolvePaystackPricingForPlan(planKey) {
  const requestedPlan = planKey === 'monthly' ? 'monthly' : 'single';
  const plan = getPdfPlanConfig(requestedPlan);

  const configuredPaystackCurrency = String(process.env.PAYSTACK_CURRENCY || '')
    .trim()
    .toUpperCase();
  const paystackAccountCurrency = String(process.env.PAYSTACK_ACCOUNT_CURRENCY || '')
    .trim()
    .toUpperCase();
  const targetCurrency = configuredPaystackCurrency || paystackAccountCurrency;
  const baseCurrency = String(
    process.env.PAYSTACK_BASE_CURRENCY || process.env.STRIPE_CURRENCY || 'USD'
  )
    .trim()
    .toUpperCase();
  const autoConvert = isTruthyEnv(process.env.PAYSTACK_AUTO_CONVERT, true);

  const paystackSingleAmountOverride = toPositiveNumber(process.env.PAYSTACK_PDF_SINGLE_AMOUNT);
  const paystackMonthlyAmountOverride = toPositiveNumber(process.env.PAYSTACK_PDF_MONTHLY_AMOUNT);
  const overrideAmount =
    requestedPlan === 'monthly' ? paystackMonthlyAmountOverride : paystackSingleAmountOverride;

  let amount = overrideAmount ?? plan.amount;
  let resolvedExchangeRate = null;
  let convertedFromCurrency = null;
  let conversionApplied = false;

  if (autoConvert && targetCurrency && baseCurrency && targetCurrency !== baseCurrency) {
    try {
      const rate = await getExchangeRate(baseCurrency, targetCurrency);
      const convertedAmount = Number((plan.amount * rate).toFixed(2));
      if (Number.isFinite(convertedAmount) && convertedAmount > 0) {
        amount = convertedAmount;
        resolvedExchangeRate = rate;
        convertedFromCurrency = baseCurrency;
        conversionApplied = true;
      }
    } catch (exchangeError) {
      console.warn(
        `Paystack FX conversion failed (${baseCurrency} -> ${targetCurrency}). Falling back to configured amount.`,
        exchangeError?.message || exchangeError
      );
    }
  }

  return {
    requestedPlan,
    amount,
    chargeCurrency: configuredPaystackCurrency,
    displayCurrency: targetCurrency || baseCurrency || 'USD',
    baseCurrency,
    autoConvert,
    conversionApplied,
    convertedFromCurrency,
    exchangeRate: resolvedExchangeRate,
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

  await subscriptionsRepository.updateCustomerSubscriptionStatus(customerId, nextStatus);
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

  await subscriptionsRepository.updateCustomerSubscriptionStatusByEmail(email, nextStatus);
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
    .map((segment) => segment.trim())
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

  const anyMatch = candidateSignatures.some((signature) =>
    safeTimingCompare(signature, expectedSignature)
  );
  return anyMatch ? { valid: true } : { valid: false, reason: 'Stripe signature mismatch' };
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
  return valid ? { valid: true } : { valid: false, reason: 'Paystack signature mismatch' };
}

function formatLegacyFallbackPlans(plans) {
  return plans.map((plan) => {
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
}

async function listPublicPlans() {
  try {
    return await subscriptionsRepository.fetchPublicPlansExtended();
  } catch (error) {
    if (error?.code !== '42703') throw error;
    const legacyRows = await subscriptionsRepository.fetchPublicPlansLegacy();
    return formatLegacyFallbackPlans(legacyRows);
  }
}

async function getPdfPricing() {
  const stripeCurrency = String(process.env.STRIPE_CURRENCY || 'USD').trim().toUpperCase();
  const singlePlan = getPdfPlanConfig('single');
  const monthlyPlan = getPdfPlanConfig('monthly');
  const singlePaystack = await resolvePaystackPricingForPlan('single');
  const monthlyPaystack = await resolvePaystackPricingForPlan('monthly');

  return {
    single: {
      stripe: {
        amount: singlePlan.amount,
        currency: stripeCurrency,
      },
      paystack: {
        amount: singlePaystack.amount,
        currency: singlePaystack.displayCurrency,
        base_currency: singlePaystack.baseCurrency,
        converted_from_currency: singlePaystack.convertedFromCurrency,
        exchange_rate: singlePaystack.exchangeRate,
        auto_converted: singlePaystack.conversionApplied,
      },
    },
    monthly: {
      stripe: {
        amount: monthlyPlan.amount,
        currency: stripeCurrency,
      },
      paystack: {
        amount: monthlyPaystack.amount,
        currency: monthlyPaystack.displayCurrency,
        base_currency: monthlyPaystack.baseCurrency,
        converted_from_currency: monthlyPaystack.convertedFromCurrency,
        exchange_rate: monthlyPaystack.exchangeRate,
        auto_converted: monthlyPaystack.conversionApplied,
      },
    },
  };
}

async function subscribeNewsletter({ payload, user, queryEmail }) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const requestedEmail =
    input.email || input?.subscriber?.email || input?.newsletterEmail || queryEmail;
  const email = normalizeEmail(requestedEmail || user?.email);

  if (!email || !isLikelyEmail(email)) {
    const error = new Error('Please enter a valid email address.');
    error.statusCode = 400;
    throw error;
  }

  const resolvedFirstName = String(input.first_name || user?.first_name || 'Subscriber').trim();
  const resolvedLastName = String(input.last_name || user?.last_name || '').trim();
  const resolvedSource = String(input.source || 'website').trim();

  const existingSubscriber = await subscriptionsRepository.findNewsletterSubscriberByEmail(email);

  if (existingSubscriber) {
    if (existingSubscriber.is_active) {
      return {
        statusCode: 200,
        body: {
          message: 'You are already subscribed to the newsletter.',
          email_sent: false,
          already_subscribed: true,
        },
      };
    }

    await subscriptionsRepository.reactivateNewsletterSubscriber({
      id: existingSubscriber.id,
      source: resolvedSource,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
    });

    const emailSent = await sendSubscriptionEmail(email, resolvedFirstName || 'Subscriber');

    return {
      statusCode: 200,
      body: {
        message: 'Newsletter subscription reactivated successfully',
        email_sent: emailSent,
      },
    };
  }

  const subscriber = await subscriptionsRepository.createNewsletterSubscriber({
    email,
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    source: resolvedSource,
  });

  const emailSent = await sendSubscriptionEmail(email, resolvedFirstName || 'Subscriber');

  return {
    statusCode: 201,
    body: {
      message: 'Newsletter subscription successful',
      email_sent: emailSent,
      subscriber: {
        id: subscriber?.id,
        email: subscriber?.email,
        first_name: subscriber?.first_name,
        last_name: subscriber?.last_name,
      },
    },
  };
}

async function unsubscribeNewsletter({ email }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isLikelyEmail(normalizedEmail)) {
    const error = new Error('Valid email is required');
    error.statusCode = 400;
    throw error;
  }

  const subscriber = await subscriptionsRepository.deactivateNewsletterSubscriber(normalizedEmail);
  if (!subscriber) {
    const error = new Error('Subscription not found or already unsubscribed');
    error.statusCode = 404;
    throw error;
  }

  await sendUnsubscribeEmail(normalizedEmail, subscriber.first_name || 'Subscriber');

  return {
    message: 'Successfully unsubscribed from newsletter',
  };
}

async function getPdfAccess(authUser) {
  const statusFromAuthContext = String(authUser?.subscription_status || '')
    .toLowerCase()
    .trim();

  if (statusFromAuthContext) {
    return {
      has_access: PAID_PDF_STATUSES.has(statusFromAuthContext),
      subscription_status: statusFromAuthContext,
    };
  }

  const identityId = String(authUser?.customer_id || authUser?.id || '').trim();
  const identityEmail = normalizeEmail(authUser?.email || '');

  let customerStatus = '';
  if (identityId || identityEmail) {
    customerStatus = await subscriptionsRepository.findCustomerStatusByIdentity(
      identityId,
      identityEmail
    );
  }

  return {
    has_access: PAID_PDF_STATUSES.has(customerStatus),
    subscription_status: customerStatus || null,
  };
}

async function createPdfCheckout({
  provider,
  plan,
  returnPath,
  user,
  req,
}) {
  const selectedProvider = String(provider || '').toLowerCase();
  const requestedPlan = String(plan || 'single').toLowerCase();

  if (!SUPPORTED_PAYMENT_PROVIDERS.has(selectedProvider)) {
    const error = new Error('Unsupported payment provider');
    error.statusCode = 400;
    throw error;
  }

  if (!SUPPORTED_PDF_PLANS.has(requestedPlan)) {
    const error = new Error('Unsupported PDF plan');
    error.statusCode = 400;
    throw error;
  }

  if (!user?.email) {
    const error = new Error('User account is missing required billing fields');
    error.statusCode = 400;
    throw error;
  }

  const customerIdentity =
    (user?.customer_id && String(user.customer_id).trim()) ||
    (user?.id && String(user.id).trim()) ||
    null;

  const selectedPlanConfig = getPdfPlanConfig(requestedPlan);
  const frontendBase = resolveFrontendBase(req);
  const safeReturnPath = normalizeReturnPath(returnPath);

  if (selectedProvider === 'stripe') {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (!stripeSecretKey) {
      const error = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');
      error.statusCode = 500;
      throw error;
    }

    const stripeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
    const stripeSinglePriceId = (process.env.STRIPE_PDF_SINGLE_PRICE_ID || '').trim();
    const stripeMonthlyPriceId = (process.env.STRIPE_PDF_MONTHLY_PRICE_ID || '').trim();
    const mode = requestedPlan === 'monthly' ? 'subscription' : 'payment';
    const successUrl = `${frontendBase}${safeReturnPath}?pdfPayment=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendBase}${safeReturnPath}?pdfPayment=cancel&provider=stripe`;

    const form = new URLSearchParams();
    form.append('mode', mode);
    form.append('success_url', successUrl);
    form.append('cancel_url', cancelUrl);
    form.append('line_items[0][quantity]', '1');
    form.append('customer_email', user.email);
    if (customerIdentity) {
      form.append('metadata[customer_id]', String(customerIdentity));
    }
    form.append('metadata[email]', user.email);
    form.append('metadata[pdf_plan]', requestedPlan);

    const selectedPriceId =
      requestedPlan === 'monthly' ? stripeMonthlyPriceId : stripeSinglePriceId;
    if (selectedPriceId) {
      form.append('line_items[0][price]', selectedPriceId);
    } else {
      form.append('line_items[0][price_data][currency]', stripeCurrency);
      form.append(
        'line_items[0][price_data][unit_amount]',
        String(Math.round(selectedPlanConfig.amount * 100))
      );
      form.append(
        'line_items[0][price_data][product_data][name]',
        selectedPlanConfig.description
      );

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
      const error = new Error(
        stripePayload?.error?.message || 'Failed to initialize Stripe checkout'
      );
      error.statusCode = 502;
      throw error;
    }

    return {
      provider: 'stripe',
      plan: requestedPlan,
      checkout_url: stripePayload.url,
      session_id: stripePayload.id,
    };
  }

  const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!paystackSecretKey) {
    const error = new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY.');
    error.statusCode = 500;
    throw error;
  }

  const paystackPricing = await resolvePaystackPricingForPlan(requestedPlan);
  const amount = paystackPricing.amount;
  const paystackCurrency = paystackPricing.chargeCurrency;
  const resolvedExchangeRate = paystackPricing.exchangeRate;
  const convertedFromCurrency = paystackPricing.convertedFromCurrency;

  const callbackUrl = `${frontendBase}${safeReturnPath}?pdfPayment=success&provider=paystack`;
  const referenceIdentity = customerIdentity
    ? String(customerIdentity).replace(/[^a-zA-Z0-9_-]/g, '')
    : 'guest';
  const reference = `pdf_${requestedPlan}_${referenceIdentity}_${Date.now()}`;

  const basePaystackPayload = {
    email: user.email,
    amount: Math.round(amount * 100),
    callback_url: callbackUrl,
    reference,
    metadata: {
      ...(customerIdentity ? { customer_id: customerIdentity } : {}),
      email: user.email,
      pdf_plan: requestedPlan,
      ...(convertedFromCurrency
        ? {
            fx_base_currency: convertedFromCurrency,
            fx_target_currency: paystackCurrency,
            fx_rate: resolvedExchangeRate,
            fx_converted_amount: amount,
          }
        : {}),
    },
  };

  const initializePaystackCheckout = async (currency) => {
    const payload = currency ? { ...basePaystackPayload, currency } : basePaystackPayload;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let parsed = null;
    try {
      parsed = await response.json();
    } catch (_error) {
      parsed = null;
    }

    return { response, parsed };
  };

  let { response: paystackResponse, parsed: paystackPayload } =
    await initializePaystackCheckout(paystackCurrency);

  const paystackErrorMessage = String(paystackPayload?.message || '');
  const shouldRetryWithoutCurrency =
    Boolean(paystackCurrency) &&
    (!paystackResponse.ok ||
      !paystackPayload?.status ||
      !paystackPayload?.data?.authorization_url) &&
    /currency/i.test(paystackErrorMessage) &&
    /(unsupported|not supported|invalid)/i.test(paystackErrorMessage);

  if (shouldRetryWithoutCurrency) {
    ({ response: paystackResponse, parsed: paystackPayload } =
      await initializePaystackCheckout(''));
  }

  if (!paystackResponse.ok || !paystackPayload?.status || !paystackPayload?.data?.authorization_url) {
    const error = new Error(
      paystackPayload?.message || 'Failed to initialize Paystack checkout'
    );
    error.statusCode = 502;
    throw error;
  }

  return {
    provider: 'paystack',
    plan: requestedPlan,
    checkout_url: paystackPayload.data.authorization_url,
    reference: paystackPayload.data.reference,
    amount,
    currency: paystackPricing.displayCurrency,
    auto_converted: paystackPricing.conversionApplied,
    exchange_rate: paystackPricing.exchangeRate,
    converted_from_currency: paystackPricing.convertedFromCurrency,
  };
}

async function verifyPdfPayment({ provider, sessionId, reference, user }) {
  const selectedProvider = String(provider || '').toLowerCase();
  if (!SUPPORTED_PAYMENT_PROVIDERS.has(selectedProvider)) {
    const error = new Error('Unsupported payment provider');
    error.statusCode = 400;
    throw error;
  }

  if (!user?.email) {
    const error = new Error('Invalid authenticated user context');
    error.statusCode = 400;
    throw error;
  }

  if (selectedProvider === 'stripe') {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    const stripeSessionId = String(sessionId || '').trim();

    if (!stripeSecretKey) {
      const error = new Error('Stripe is not configured.');
      error.statusCode = 500;
      throw error;
    }
    if (!stripeSessionId) {
      const error = new Error('Missing session_id for Stripe verification.');
      error.statusCode = 400;
      throw error;
    }

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeSessionId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      }
    );

    const stripePayload = await stripeResponse.json();
    if (!stripeResponse.ok) {
      const error = new Error(
        stripePayload?.error?.message || 'Failed to verify Stripe payment'
      );
      error.statusCode = 502;
      throw error;
    }

    const isPaid =
      stripePayload?.payment_status === 'paid' || stripePayload?.status === 'complete';

    if (!isPaid) {
      const error = new Error('Stripe payment is not completed yet.');
      error.statusCode = 400;
      throw error;
    }

    const requestedPlan = String(stripePayload?.metadata?.pdf_plan || 'single').toLowerCase();
    const planConfig = getPdfPlanConfig(requestedPlan);
    await updateCustomerSubscriptionStatusByIdentity(
      {
        customerId: user?.customer_id || user?.id || null,
        email: user?.email || null,
      },
      planConfig.statusOnSuccess
    );

    return {
      verified: true,
      provider: 'stripe',
      plan: requestedPlan,
      subscription_status: planConfig.statusOnSuccess,
    };
  }

  const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  const paystackReference = String(reference || '').trim();

  if (!paystackSecretKey) {
    const error = new Error('Paystack is not configured.');
    error.statusCode = 500;
    throw error;
  }
  if (!paystackReference) {
    const error = new Error('Missing reference for Paystack verification.');
    error.statusCode = 400;
    throw error;
  }

  const paystackResponse = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(paystackReference)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    }
  );

  const paystackPayload = await paystackResponse.json();
  if (!paystackResponse.ok || !paystackPayload?.status) {
    const error = new Error(
      paystackPayload?.message || 'Failed to verify Paystack payment'
    );
    error.statusCode = 502;
    throw error;
  }

  const isPaid = paystackPayload?.data?.status === 'success';
  if (!isPaid) {
    const error = new Error('Paystack payment is not successful yet.');
    error.statusCode = 400;
    throw error;
  }

  const requestedPlan = String(paystackPayload?.data?.metadata?.pdf_plan || 'single').toLowerCase();
  const planConfig = getPdfPlanConfig(requestedPlan);
  await updateCustomerSubscriptionStatusByIdentity(
    {
      customerId: user?.customer_id || user?.id || null,
      email: user?.email || null,
    },
    planConfig.statusOnSuccess
  );

  return {
    verified: true,
    provider: 'paystack',
    plan: requestedPlan,
    subscription_status: planConfig.statusOnSuccess,
  };
}

async function processStripeWebhook({ rawBody, signature }) {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    const error = new Error('Stripe webhook secret is not configured');
    error.statusCode = 500;
    throw error;
  }

  const verification = verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!verification.valid) {
    const error = new Error(verification.reason || 'Invalid Stripe webhook signature');
    error.statusCode = 400;
    throw error;
  }

  const event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  if (!event?.type || !event?.data?.object) {
    const error = new Error('Invalid Stripe webhook payload structure');
    error.statusCode = 400;
    throw error;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const planKey = String(session?.metadata?.pdf_plan || 'single').toLowerCase();
    const planConfig = getPdfPlanConfig(planKey);

    const identity = {
      customerId: session?.metadata?.customer_id || null,
      email: session?.metadata?.email || session?.customer_details?.email || null,
    };

    if (!identity.customerId && !identity.email) {
      return { received: true, ignored: 'Missing identity metadata' };
    }

    await updateCustomerSubscriptionStatusByIdentity(identity, planConfig.statusOnSuccess);
    return { received: true, provider: 'stripe', processed: true };
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const planKey = String(
      invoice?.lines?.data?.[0]?.metadata?.pdf_plan || 'monthly'
    ).toLowerCase();
    const planConfig = getPdfPlanConfig(planKey === 'single' ? 'single' : 'monthly');

    const identity = {
      customerId:
        invoice?.metadata?.customer_id || invoice?.lines?.data?.[0]?.metadata?.customer_id || null,
      email: invoice?.customer_email || invoice?.lines?.data?.[0]?.metadata?.email || null,
    };

    if (identity.customerId || identity.email) {
      await updateCustomerSubscriptionStatusByIdentity(identity, planConfig.statusOnSuccess);
    }
  }

  return { received: true, provider: 'stripe', processed: false };
}

async function processPaystackWebhook({ rawBody, signature }) {
  const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!paystackSecretKey) {
    const error = new Error('Paystack secret key is not configured');
    error.statusCode = 500;
    throw error;
  }

  const verification = verifyPaystackSignature(rawBody, signature, paystackSecretKey);
  if (!verification.valid) {
    const error = new Error(verification.reason || 'Invalid Paystack webhook signature');
    error.statusCode = 400;
    throw error;
  }

  const event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  if (!event?.event || !event?.data) {
    const error = new Error('Invalid Paystack webhook payload structure');
    error.statusCode = 400;
    throw error;
  }

  if (event.event === 'charge.success') {
    const metadata = event.data?.metadata || {};
    const planKey = String(metadata?.pdf_plan || 'single').toLowerCase();
    const planConfig = getPdfPlanConfig(planKey);

    const identity = {
      customerId: metadata?.customer_id || null,
      email: metadata?.email || event.data?.customer?.email || null,
    };

    if (!identity.customerId && !identity.email) {
      return { received: true, ignored: 'Missing identity metadata' };
    }

    await updateCustomerSubscriptionStatusByIdentity(identity, planConfig.statusOnSuccess);
    return { received: true, provider: 'paystack', processed: true };
  }

  return { received: true, provider: 'paystack', processed: false };
}

function calculateSubscriptionEndDate(startDate, billingCycle) {
  const endDate = new Date(startDate);
  switch (billingCycle) {
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
      break;
  }
  return endDate;
}

async function createSubscription({
  customerId,
  planId,
  paymentMethod,
  autoRenew = true,
}) {
  const plan = await subscriptionsRepository.findActivePlanById(planId);
  if (!plan) {
    const error = new Error('Subscription plan not found');
    error.statusCode = 404;
    throw error;
  }

  const existing = await subscriptionsRepository.findExistingSubscriptionForCustomer(customerId);
  if (existing.length > 0) {
    const error = new Error('You already have an active subscription');
    error.statusCode = 400;
    throw error;
  }

  const startDate = new Date();
  const endDate = calculateSubscriptionEndDate(startDate, plan.billing_cycle);

  const subscription = await subscriptionsRepository.createCustomerSubscription({
    customerId,
    planId,
    status: 'pending',
    startDate,
    endDate,
    autoRenew,
    paymentMethod,
  });

  await subscriptionsRepository.createSubscriptionPayment({
    subscriptionId: subscription.id,
    amount: plan.price,
    currency: 'USD',
    paymentMethod,
    status: 'pending',
  });

  await updateCustomerSubscriptionStatus(customerId, String(plan.name || '').toLowerCase());

  return {
    message: 'Subscription created successfully',
    subscription: {
      id: subscription.id,
      plan: plan.name,
      status: subscription.status,
      start_date: subscription.start_date,
      end_date: subscription.end_date,
      price: plan.price,
      billing_cycle: plan.billing_cycle,
    },
  };
}

async function getCurrentSubscription(customerId) {
  const subscription = await subscriptionsRepository.getCurrentSubscription(customerId);
  if (!subscription) {
    return { subscription: null };
  }

  const payments = await subscriptionsRepository.getPaymentsForSubscription(subscription.id);
  return {
    subscription: {
      ...subscription,
      payments,
    },
  };
}

async function cancelSubscription(customerId) {
  const subscription = await subscriptionsRepository.cancelActiveSubscription(customerId);
  if (!subscription) {
    const error = new Error('No active subscription found');
    error.statusCode = 404;
    throw error;
  }

  await updateCustomerSubscriptionStatus(customerId, 'cancelled');
  return {
    message: 'Subscription cancelled successfully',
    subscription: {
      id: subscription.id,
      status: 'cancelled',
      end_date: subscription.end_date,
    },
  };
}

async function reactivateSubscription(customerId) {
  const subscription = await subscriptionsRepository.reactivateCancelledSubscription(customerId);
  if (!subscription) {
    const error = new Error('No cancelled subscription found');
    error.statusCode = 404;
    throw error;
  }

  const planName = await subscriptionsRepository.findPlanNameById(subscription.plan_id);
  if (planName) {
    await updateCustomerSubscriptionStatus(customerId, String(planName).toLowerCase());
  }

  return {
    message: 'Subscription reactivated successfully',
    subscription: {
      id: subscription.id,
      status: 'active',
    },
  };
}

async function getSubscriptionHistory(customerId) {
  const subscriptions = await subscriptionsRepository.getSubscriptionHistory(customerId);
  return { subscriptions };
}

async function getAllSubscriptionsAdmin({ page, limit, status }) {
  const safePage = parsePositiveInt(page, 1, 1, 100000);
  const safeLimit = parsePositiveInt(limit, 20, 1, 200);
  const offset = (safePage - 1) * safeLimit;
  const normalizedStatus = String(status || '').trim() || null;

  const subscriptions = await subscriptionsRepository.getAllSubscriptionsAdmin({
    limit: safeLimit,
    offset,
    status: normalizedStatus,
  });

  const total = await subscriptionsRepository.countAllSubscriptionsAdmin(normalizedStatus);

  return {
    subscriptions,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
}

async function updateSubscriptionStatusAdmin({ subscriptionId, status }) {
  const subscription = await subscriptionsRepository.updateSubscriptionStatus(subscriptionId, status);
  if (!subscription) {
    const error = new Error('Subscription not found');
    error.statusCode = 404;
    throw error;
  }

  await updateCustomerSubscriptionStatus(subscription.customer_id, status);
  return {
    message: 'Subscription status updated successfully',
    subscription: {
      id: subscription.id,
      status: subscription.status,
    },
  };
}

module.exports = {
  SUPPORTED_PAYMENT_PROVIDERS,
  SUPPORTED_PDF_PLANS,
  listPublicPlans,
  getPdfPricing,
  subscribeNewsletter,
  unsubscribeNewsletter,
  getPdfAccess,
  createPdfCheckout,
  verifyPdfPayment,
  processStripeWebhook,
  processPaystackWebhook,
  createSubscription,
  getCurrentSubscription,
  cancelSubscription,
  reactivateSubscription,
  getSubscriptionHistory,
  getAllSubscriptionsAdmin,
  updateSubscriptionStatusAdmin,
};
