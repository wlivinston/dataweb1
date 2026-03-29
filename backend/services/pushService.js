const webpush = require('web-push');
const { query } = require('../config/database');
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// VAPID configuration
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || '').trim();

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  logger.info('Web Push VAPID configured');
} else {
  logger.warn('Web Push VAPID not configured — push notifications disabled');
}

function isConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
}

function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------
async function saveSubscription(userId, email, subscription, userAgent) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Invalid push subscription: missing endpoint or keys');
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, email, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id    = EXCLUDED.user_id,
       email      = EXCLUDED.email,
       p256dh     = EXCLUDED.p256dh,
       auth       = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       updated_at = NOW()`,
    [userId, email || null, endpoint, keys.p256dh, keys.auth, userAgent || null]
  );
}

async function removeSubscription(endpoint) {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function removeAllSubscriptions(userId) {
  await query('DELETE FROM push_subscriptions WHERE user_id = $1', [String(userId)]);
}

async function getSubscriptionStatus(userId) {
  const result = await query(
    'SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id = $1',
    [String(userId)]
  );
  const count = result.rows?.[0]?.count || 0;
  return { subscribed: count > 0, count };
}

// ---------------------------------------------------------------------------
// Sending notifications
// ---------------------------------------------------------------------------
async function logNotification(userId, { type, title, body, url, status, errorMessage }) {
  try {
    await query(
      `INSERT INTO notification_log (user_id, type, title, body, url, sent_at, status, error_message)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
      [userId || null, type, title, body, url || null, status || 'sent', errorMessage || null]
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to log notification');
  }
}

async function sendToSubscription(sub, payload) {
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { success: true };
  } catch (err) {
    const statusCode = err.statusCode || 0;
    // 410 Gone or 404 — subscription expired, clean it up
    if (statusCode === 410 || statusCode === 404) {
      logger.info({ endpoint: sub.endpoint }, 'removing expired push subscription');
      await removeSubscription(sub.endpoint).catch(() => {});
    } else {
      logger.warn({ endpoint: sub.endpoint, statusCode, err: err.message }, 'push send failed');
    }
    return { success: false, error: err.message };
  }
}

async function sendNotification(userId, { type, title, body, url }) {
  if (!isConfigured()) return;

  const result = await query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [String(userId)]
  );
  const subscriptions = result.rows || [];
  if (subscriptions.length === 0) return;

  const payload = { type, title, body, url };
  let anySuccess = false;

  for (const sub of subscriptions) {
    const outcome = await sendToSubscription(sub, payload);
    if (outcome.success) anySuccess = true;
  }

  await logNotification(userId, {
    type,
    title,
    body,
    url,
    status: anySuccess ? 'sent' : 'failed',
  });
}

async function sendNotificationByEmail(email, { type, title, body, url }) {
  if (!isConfigured() || !email) return;

  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await query(
    'SELECT endpoint, p256dh, auth, user_id FROM push_subscriptions WHERE LOWER(email) = $1',
    [normalizedEmail]
  );
  const subscriptions = result.rows || [];
  if (subscriptions.length === 0) return;

  const payload = { type, title, body, url };
  let anySuccess = false;

  for (const sub of subscriptions) {
    const outcome = await sendToSubscription(sub, payload);
    if (outcome.success) anySuccess = true;
  }

  await logNotification(subscriptions[0]?.user_id || null, {
    type,
    title,
    body,
    url,
    status: anySuccess ? 'sent' : 'failed',
  });
}

async function broadcastNotification({ type, title, body, url }) {
  if (!isConfigured()) return;

  const result = await query('SELECT endpoint, p256dh, auth, user_id FROM push_subscriptions');
  const subscriptions = result.rows || [];
  if (subscriptions.length === 0) return;

  logger.info({ type, recipientCount: subscriptions.length }, 'broadcasting push notification');
  const payload = { type, title, body, url };

  let successCount = 0;
  for (const sub of subscriptions) {
    const outcome = await sendToSubscription(sub, payload);
    if (outcome.success) successCount++;
  }

  await logNotification(null, {
    type,
    title,
    body,
    url,
    status: successCount > 0 ? 'sent' : 'failed',
    errorMessage: `${successCount}/${subscriptions.length} delivered`,
  });
}

// ---------------------------------------------------------------------------
// Subscription reminders
// ---------------------------------------------------------------------------
async function sendExpiryReminders(daysBeforeExpiry = 3) {
  if (!isConfigured()) return { sent: 0 };

  const result = await query(
    `SELECT DISTINCT c.email, c.first_name
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     WHERE cs.status = 'active'
       AND cs.end_date BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL`,
    [String(daysBeforeExpiry)]
  );

  const customers = result.rows || [];
  let sent = 0;

  for (const customer of customers) {
    if (!customer.email) continue;
    try {
      await sendNotificationByEmail(customer.email, {
        type: 'subscription_reminder',
        title: 'Subscription Expiring Soon',
        body: `Hi ${customer.first_name || 'there'}, your subscription expires in ${daysBeforeExpiry} days. Renew to keep access.`,
        url: '/finance',
      });
      sent++;
    } catch (err) {
      logger.warn({ email: customer.email, err: err.message }, 'reminder push failed');
    }
  }

  return { sent, total: customers.length };
}

module.exports = {
  isConfigured,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  removeAllSubscriptions,
  getSubscriptionStatus,
  sendNotification,
  sendNotificationByEmail,
  broadcastNotification,
  sendExpiryReminders,
};
