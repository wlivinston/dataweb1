const crypto = require('node:crypto');
const logger = require('../../config/logger');

/**
 * Field-level encryption for sensitive values (AES-256-GCM).
 *
 * Applied by the application before a value reaches the database, so a
 * leaked database, backup or service-role key does not expose it - the disk
 * encryption Supabase already provides does not cover any of those.
 *
 * Only for SENSITIVE fields (tax identifiers, bank details, columns the owner
 * marks), not for whole datasets: an encrypted value cannot be filtered or
 * aggregated by the database, and keeping ordinary analytics data readable to
 * Postgres keeps row-selection pushdown possible
 * (docs/server-side-compute-decision.md).
 *
 * Configuration:
 *   FIELD_ENCRYPTION_KEYS          "kid:base64key,kid2:base64key" - 32-byte keys
 *   FIELD_ENCRYPTION_ACTIVE_KEY_ID the kid new values are encrypted with
 *
 * Every stored value names the key that encrypted it, so a key can be rotated
 * by adding a new one and making it active: old values still decrypt with the
 * old key, which can be removed once nothing references it.
 *
 * Stored form: "enc:v1:<kid>:<iv>:<tag>:<ciphertext>" (base64url parts). The
 * plaintext is JSON, so a number decrypts as a number and a string as a string.
 */

const PREFIX = 'enc:v1:';

function loadKeys() {
  const raw = String(process.env.FIELD_ENCRYPTION_KEYS || '').trim();
  const keys = new Map();
  if (!raw) return keys;
  for (const entry of raw.split(',')) {
    const [kid, b64] = entry.split(':').map((part) => (part || '').trim());
    if (!kid || !b64) continue;
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      logger.error({ kid }, 'field encryption key is not 32 bytes; ignored');
      continue;
    }
    keys.set(kid, key);
  }
  return keys;
}

const keys = loadKeys();
const activeKeyId = String(process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID || '').trim() || [...keys.keys()][0] || '';

/** Whether sensitive values can be stored. When false, they must be refused - never stored in plain text. */
function isConfigured() {
  return Boolean(activeKeyId) && keys.has(activeKeyId);
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Blank stays blank: there is nothing to hide, and "missing" must stay visible. */
const isBlank = (value) => value === null || value === undefined || value === '';

function encryptValue(value) {
  if (isBlank(value) || isEncrypted(value)) return value;
  if (!isConfigured()) throw new Error('Field encryption is not configured.');
  const key = keys.get(activeKeyId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${activeKeyId}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptValue(value) {
  if (!isEncrypted(value)) return value;
  const [kid, iv, tag, ciphertext] = value.slice(PREFIX.length).split(':');
  const key = keys.get(kid);
  if (!key) throw new Error(`No field encryption key "${kid}" is configured; the value cannot be read.`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  // GCM authenticates: a value altered in the database fails here rather
  // than decrypting to something plausible.
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** Encrypt the named columns of each row; other columns are untouched. */
function encryptColumns(rows, columnNames) {
  if (columnNames.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const name of columnNames) {
      if (name in out) out[name] = encryptValue(out[name]);
    }
    return out;
  });
}

function decryptColumns(rows, columnNames) {
  if (columnNames.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const name of columnNames) {
      if (name in out) out[name] = decryptValue(out[name]);
    }
    return out;
  });
}

/**
 * Column names that hold identifiers or financial details, encrypted whether
 * or not the uploader marked them. Matched on whole words of the name.
 */
const SENSITIVE_NAME = new RegExp(
  '\\b(' + [
    'ssn', 'social security', 'social security number', 'sin', 'tin', 'itin', 'ein', 'taxpayer',
    'tax id', 'tax identification', 'national id', 'national insurance', 'passport',
    'bank account', 'account number', 'routing', 'routing number', 'iban', 'swift', 'bic',
    'card number', 'credit card', 'cvv', 'date of birth', 'dob', 'ghana card', 'nin', 'bvn',
  ].join('|') + ')\\b',
  'i'
);

function looksSensitive(columnName) {
  const words = String(columnName || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ');
  return SENSITIVE_NAME.test(words);
}

module.exports = {
  isConfigured, isEncrypted, encryptValue, decryptValue, encryptColumns, decryptColumns, looksSensitive,
};
