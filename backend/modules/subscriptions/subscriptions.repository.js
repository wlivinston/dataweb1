const { query } = require('../../config/database');

async function findNewsletterSubscriberByEmail(email) {
  const result = await query(
    'SELECT id, is_active FROM newsletter_subscribers WHERE lower(email) = lower($1)',
    [email]
  );
  return result.rows?.[0] || null;
}

async function reactivateNewsletterSubscriber({
  id,
  source,
  firstName,
  lastName,
}) {
  await query(
    `UPDATE newsletter_subscribers
     SET
       is_active = true,
       unsubscribed_at = NULL,
       source = COALESCE($1, source),
       first_name = COALESCE(NULLIF($2, ''), first_name),
       last_name = COALESCE(NULLIF($3, ''), last_name)
     WHERE id = $4`,
    [source, firstName, lastName, id]
  );
}

async function createNewsletterSubscriber({
  email,
  firstName,
  lastName,
  source,
}) {
  const result = await query(
    `INSERT INTO newsletter_subscribers (email, first_name, last_name, source)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, first_name, last_name`,
    [email, firstName, lastName || null, source]
  );

  return result.rows?.[0] || null;
}

async function deactivateNewsletterSubscriber(email) {
  const result = await query(
    `UPDATE newsletter_subscribers
     SET is_active = false, unsubscribed_at = CURRENT_TIMESTAMP
     WHERE email = $1 AND is_active = true
     RETURNING id, first_name`,
    [email]
  );

  return result.rows?.[0] || null;
}

async function fetchPublicPlansExtended() {
  const result = await query(
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

  return result.rows || [];
}

async function fetchPublicPlansLegacy() {
  const result = await query(
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

  return result.rows || [];
}

async function findCustomerStatusByIdentity(identityId, identityEmail) {
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

    return String(result?.rows?.[0]?.subscription_status || '')
      .toLowerCase()
      .trim();
  } catch (error) {
    if (error?.code !== '42703') throw error;

    const fallbackResult = await query(
      `SELECT subscription_status
       FROM customers
       WHERE ($1 <> '' AND id::text = $1)
          OR ($2 <> '' AND lower(email) = lower($2))
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [identityId, identityEmail]
    );

    return String(fallbackResult?.rows?.[0]?.subscription_status || '')
      .toLowerCase()
      .trim();
  }
}

async function updateCustomerSubscriptionStatus(customerId, nextStatus) {
  await query(
    'UPDATE customers SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [nextStatus, customerId]
  );
}

async function updateCustomerSubscriptionStatusByEmail(email, nextStatus) {
  await query(
    'UPDATE customers SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP WHERE lower(email) = lower($2)',
    [nextStatus, email]
  );
}

async function findActivePlanById(planId) {
  const result = await query(
    `SELECT id, name, price, billing_cycle
     FROM subscription_plans
     WHERE id = $1 AND is_active = true`,
    [planId]
  );
  return result.rows?.[0] || null;
}

async function findExistingSubscriptionForCustomer(customerId) {
  const result = await query(
    `SELECT id, status
     FROM customer_subscriptions
     WHERE customer_id = $1 AND status IN ($2, $3)`,
    [customerId, 'active', 'pending']
  );
  return result.rows || [];
}

async function createCustomerSubscription({
  customerId,
  planId,
  status,
  startDate,
  endDate,
  autoRenew,
  paymentMethod,
}) {
  const result = await query(
    `INSERT INTO customer_subscriptions (
      customer_id, plan_id, status, start_date, end_date, auto_renew, payment_method
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, customer_id, plan_id, status, start_date, end_date`,
    [customerId, planId, status, startDate, endDate, autoRenew, paymentMethod]
  );
  return result.rows?.[0] || null;
}

async function createSubscriptionPayment({
  subscriptionId,
  amount,
  currency,
  paymentMethod,
  status,
}) {
  await query(
    `INSERT INTO subscription_payments (subscription_id, amount, currency, payment_method, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [subscriptionId, amount, currency, paymentMethod, status]
  );
}

async function getCurrentSubscription(customerId) {
  const result = await query(
    `SELECT
      cs.id, cs.status, cs.start_date, cs.end_date, cs.auto_renew, cs.payment_method,
      sp.name as plan_name, sp.description as plan_description, sp.price, sp.billing_cycle, sp.features
     FROM customer_subscriptions cs
     JOIN subscription_plans sp ON cs.plan_id = sp.id
     WHERE cs.customer_id = $1 AND cs.status IN ('active', 'pending')
     ORDER BY cs.created_at DESC
     LIMIT 1`,
    [customerId]
  );
  return result.rows?.[0] || null;
}

async function getPaymentsForSubscription(subscriptionId) {
  const result = await query(
    `SELECT id, amount, currency, payment_method, status, payment_date
     FROM subscription_payments
     WHERE subscription_id = $1
     ORDER BY payment_date DESC`,
    [subscriptionId]
  );
  return result.rows || [];
}

async function cancelActiveSubscription(customerId) {
  const result = await query(
    `UPDATE customer_subscriptions
     SET status = 'cancelled', auto_renew = false, updated_at = CURRENT_TIMESTAMP
     WHERE customer_id = $1 AND status = 'active'
     RETURNING id, end_date`,
    [customerId]
  );
  return result.rows?.[0] || null;
}

async function reactivateCancelledSubscription(customerId) {
  const result = await query(
    `UPDATE customer_subscriptions
     SET status = 'active', auto_renew = true, updated_at = CURRENT_TIMESTAMP
     WHERE customer_id = $1 AND status = 'cancelled'
     RETURNING id, plan_id`,
    [customerId]
  );
  return result.rows?.[0] || null;
}

async function findPlanNameById(planId) {
  const result = await query(
    'SELECT name FROM subscription_plans WHERE id = $1',
    [planId]
  );
  return result.rows?.[0]?.name || null;
}

async function getSubscriptionHistory(customerId) {
  const result = await query(
    `SELECT
      cs.id, cs.status, cs.start_date, cs.end_date, cs.auto_renew, cs.created_at,
      sp.name as plan_name, sp.price, sp.billing_cycle
     FROM customer_subscriptions cs
     JOIN subscription_plans sp ON cs.plan_id = sp.id
     WHERE cs.customer_id = $1
     ORDER BY cs.created_at DESC`,
    [customerId]
  );
  return result.rows || [];
}

async function getAllSubscriptionsAdmin({ limit, offset, status }) {
  let whereClause = '';
  const params = [limit, offset];
  if (status) {
    whereClause = 'WHERE cs.status = $3';
    params.push(status);
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

  return result.rows || [];
}

async function countAllSubscriptionsAdmin(status) {
  const result = await query(
    `SELECT COUNT(*) FROM customer_subscriptions cs ${status ? 'WHERE cs.status = $1' : ''}`,
    status ? [status] : []
  );
  return Number.parseInt(String(result.rows?.[0]?.count || '0'), 10) || 0;
}

async function updateSubscriptionStatus(subscriptionId, status) {
  const result = await query(
    `UPDATE customer_subscriptions
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, customer_id, status`,
    [status, subscriptionId]
  );
  return result.rows?.[0] || null;
}

module.exports = {
  findNewsletterSubscriberByEmail,
  reactivateNewsletterSubscriber,
  createNewsletterSubscriber,
  deactivateNewsletterSubscriber,
  fetchPublicPlansExtended,
  fetchPublicPlansLegacy,
  findCustomerStatusByIdentity,
  updateCustomerSubscriptionStatus,
  updateCustomerSubscriptionStatusByEmail,
  findActivePlanById,
  findExistingSubscriptionForCustomer,
  createCustomerSubscription,
  createSubscriptionPayment,
  getCurrentSubscription,
  getPaymentsForSubscription,
  cancelActiveSubscription,
  reactivateCancelledSubscription,
  findPlanNameById,
  getSubscriptionHistory,
  getAllSubscriptionsAdmin,
  countAllSubscriptionsAdmin,
  updateSubscriptionStatus,
};
