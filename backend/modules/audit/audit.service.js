const crypto = require('node:crypto');
const repository = require('./audit.repository');
const logger = require('../../config/logger');

/**
 * Who did what, to whose data, and whether it was allowed.
 *
 * Recorded for every action on stored data and for every refusal - an
 * attempt to read someone else's dataset is exactly the event an audit trail
 * exists to catch. What is NEVER recorded: the data itself (no row values, no
 * question or DAX text, which can quote values) and the raw IP address (a
 * keyed hash, so repeat sources can be correlated without storing the
 * address).
 */

const ACTIONS = new Set([
  'dataset.create', 'dataset.append', 'dataset.complete', 'dataset.read', 'dataset.rows.read',
  'dataset.delete', 'dataset.list', 'analytics.query',
  'auth.mfa_required', 'auth.mfa_verify',
]);

const OUTCOMES = new Set(['ok', 'denied', 'error']);

const hashIp = (ip) => {
  if (!ip) return null;
  const key = process.env.AUDIT_IP_HASH_KEY || process.env.JWT_SECRET || 'audit-ip';
  return crypto.createHmac('sha256', key).update(String(ip)).digest('hex').slice(0, 24);
};

/** The outcome an API error represents: refusals of access are 'denied'. */
const outcomeForError = (error) => {
  const status = Number(error && (error.statusCode || error.status));
  return status === 401 || status === 403 || status === 404 ? 'denied' : 'error';
};

/**
 * Record one event. Never throws: a request must not fail because its audit
 * line could not be written - but the failure is logged at error level, so a
 * broken trail is noticed rather than silent.
 */
async function record({ req, actorId, action, targetType = null, targetId = null, outcome = 'ok', details = {} }) {
  if (!ACTIONS.has(action)) throw new Error(`Unknown audit action: ${action}`);
  if (!OUTCOMES.has(outcome)) throw new Error(`Unknown audit outcome: ${outcome}`);
  try {
    return await repository.append({
      actorId: actorId || (req && req.user && req.user.id) || null,
      action,
      targetType,
      targetId: targetId === null || targetId === undefined ? null : String(targetId),
      outcome,
      ipHash: hashIp(req && (req.ip || (req.socket && req.socket.remoteAddress))),
      userAgent: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 200) || null : null,
      details,
    });
  } catch (error) {
    logger.error({ err: error.message, action, targetId }, 'audit event could not be recorded');
    return null;
  }
}

async function listMine(actorId, limit) {
  const safe = Math.min(500, Math.max(1, Number.parseInt(String(limit || 100), 10) || 100));
  return repository.listForActor(actorId, safe);
}

module.exports = { record, listMine, outcomeForError, ACTIONS };
