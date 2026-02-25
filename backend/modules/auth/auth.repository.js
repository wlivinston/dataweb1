const { query } = require('../../config/database');

async function findCustomerByEmail(email) {
  const result = await query(
    `SELECT id, email, first_name, last_name, company, password_hash, is_active, email_verified
     FROM customers
     WHERE email = $1`,
    [email]
  );
  return result.rows?.[0] || null;
}

async function createCustomer({
  email,
  firstName,
  lastName,
  company,
  passwordHash,
  verificationToken,
  verificationExpires,
}) {
  const result = await query(
    `INSERT INTO customers (
      email, first_name, last_name, company, password_hash, verification_token, verification_expires
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, first_name, last_name, company`,
    [email, firstName, lastName, company, passwordHash, verificationToken, verificationExpires]
  );

  return result.rows?.[0] || null;
}

async function updateLastLogin(userId) {
  await query('UPDATE customers SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
}

async function findUserByVerificationToken(token) {
  const result = await query(
    `SELECT id, email, first_name
     FROM customers
     WHERE verification_token = $1
       AND verification_expires > CURRENT_TIMESTAMP`,
    [token]
  );
  return result.rows?.[0] || null;
}

async function markEmailVerified(userId) {
  await query(
    `UPDATE customers
     SET email_verified = true, verification_token = NULL, verification_expires = NULL
     WHERE id = $1`,
    [userId]
  );
}

async function findUserForVerificationResend(email) {
  const result = await query(
    `SELECT id, email, first_name, email_verified
     FROM customers
     WHERE email = $1`,
    [email]
  );
  return result.rows?.[0] || null;
}

async function setVerificationToken(userId, verificationToken, verificationExpires) {
  await query(
    `UPDATE customers
     SET verification_token = $1, verification_expires = $2
     WHERE id = $3`,
    [verificationToken, verificationExpires, userId]
  );
}

async function findActiveUserByEmail(email) {
  const result = await query(
    `SELECT id, email, first_name
     FROM customers
     WHERE email = $1 AND is_active = true`,
    [email]
  );
  return result.rows?.[0] || null;
}

async function setResetToken(userId, resetToken, resetExpires) {
  await query(
    `UPDATE customers
     SET reset_token = $1, reset_expires = $2
     WHERE id = $3`,
    [resetToken, resetExpires, userId]
  );
}

async function findUserByResetToken(token) {
  const result = await query(
    `SELECT id
     FROM customers
     WHERE reset_token = $1
       AND reset_expires > CURRENT_TIMESTAMP`,
    [token]
  );
  return result.rows?.[0] || null;
}

async function updatePassword(userId, passwordHash) {
  await query(
    `UPDATE customers
     SET password_hash = $1, reset_token = NULL, reset_expires = NULL
     WHERE id = $2`,
    [passwordHash, userId]
  );
}

async function getProfile(userId) {
  const result = await query(
    `SELECT id, email, first_name, last_name, company, email_verified, created_at, last_login
     FROM customers
     WHERE id = $1`,
    [userId]
  );
  return result.rows?.[0] || null;
}

async function updateProfile(userId, { firstName, lastName, company }) {
  const result = await query(
    `UPDATE customers
     SET
       first_name = COALESCE($1, first_name),
       last_name = COALESCE($2, last_name),
       company = $3,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, email, first_name, last_name, company`,
    [firstName, lastName, company, userId]
  );
  return result.rows?.[0] || null;
}

module.exports = {
  findCustomerByEmail,
  createCustomer,
  updateLastLogin,
  findUserByVerificationToken,
  markEmailVerified,
  findUserForVerificationResend,
  setVerificationToken,
  findActiveUserByEmail,
  setResetToken,
  findUserByResetToken,
  updatePassword,
  getProfile,
  updateProfile,
};
