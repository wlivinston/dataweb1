const { query } = require('../../config/database');
const logger = require('../../config/logger');

/**
 * Durable storage for the audit trail.
 *
 * APPEND-ONLY, enforced by the database, not by convention: triggers reject
 * every UPDATE, DELETE and TRUNCATE on audit_events, so neither a bug nor a compromised
 * application credential can quietly rewrite who did what. Rows are only ever
 * inserted and read.
 *
 * Falls back to memory, like the dataset store, when no database is
 * configured (DATASET_STORAGE_MODE=memory or no DATABASE_URL) - for tests and
 * local runs. The memory store is append-only too: there is no API to change
 * or remove an event.
 */

const STORAGE_MODE = String(process.env.AUDIT_STORAGE_MODE || process.env.DATASET_STORAGE_MODE || 'auto').toLowerCase();

let initialized = false;
let initializationPromise = null;
let durableEnabled = false;
const memoryEvents = [];
let memorySequence = 0;

function shouldTryDurableStore() {
  if (STORAGE_MODE === 'memory') return false;
  if (STORAGE_MODE === 'database') return true;
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

async function initializeDurableStore() {
  await query(
    `CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_id TEXT NULL,
      action TEXT NOT NULL,
      target_type TEXT NULL,
      target_id TEXT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('ok','denied','error')),
      ip_hash TEXT NULL,
      user_agent TEXT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    )`,
    []
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_audit_events_actor_time
     ON audit_events (actor_id, occurred_at DESC)`,
    []
  );
  await query(
    `CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'audit_events is append-only';
     END;
     $$ LANGUAGE plpgsql`,
    []
  );
  await query(`DROP TRIGGER IF EXISTS audit_events_no_change ON audit_events`, []);
  await query(`DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events`, []);
  // A row trigger does not see TRUNCATE, which empties the table in one
  // statement; this one does.
  await query(
    `CREATE TRIGGER audit_events_no_truncate
     BEFORE TRUNCATE ON audit_events
     FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only()`,
    []
  );
  await query(
    `CREATE TRIGGER audit_events_no_change
     BEFORE UPDATE OR DELETE ON audit_events
     FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()`,
    []
  );
}

async function ensureReady() {
  if (initialized) return;
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (!shouldTryDurableStore()) {
        durableEnabled = false;
        initialized = true;
        return;
      }
      try {
        await initializeDurableStore();
        durableEnabled = true;
        logger.info('using durable database-backed audit storage');
      } catch (error) {
        // Without the table there is no durable trail; say so loudly.
        logger.error({ err: error.message }, 'audit store unavailable, falling back to memory');
        durableEnabled = false;
      }
      initialized = true;
    })();
  }
  await initializationPromise;
}

const toEvent = (row) => ({
  id: String(row.id),
  occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
  actorId: row.actor_id,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  outcome: row.outcome,
  details: row.details || {},
});

async function append(event) {
  await ensureReady();
  if (!durableEnabled) {
    memorySequence += 1;
    const stored = Object.freeze({
      id: String(memorySequence),
      occurredAt: new Date().toISOString(),
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      outcome: event.outcome,
      ipHash: event.ipHash,
      userAgent: event.userAgent,
      details: Object.freeze({ ...event.details }),
    });
    memoryEvents.push(stored);
    return stored;
  }
  const result = await query(
    `INSERT INTO audit_events (actor_id, action, target_type, target_id, outcome, ip_hash, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, occurred_at, actor_id, action, target_type, target_id, outcome, details`,
    [
      event.actorId, event.action, event.targetType, event.targetId, event.outcome,
      event.ipHash, event.userAgent, JSON.stringify(event.details || {}),
    ]
  );
  return toEvent(result.rows[0]);
}

/** The newest events for one actor - a user only ever reads their own trail. */
async function listForActor(actorId, limit = 100) {
  await ensureReady();
  if (!durableEnabled) {
    return memoryEvents
      .filter((event) => event.actorId === actorId)
      .slice(-limit)
      .reverse()
      .map(({ ipHash: _ip, userAgent: _ua, ...event }) => event);
  }
  const result = await query(
    `SELECT id, occurred_at, actor_id, action, target_type, target_id, outcome, details
     FROM audit_events WHERE actor_id = $1
     ORDER BY occurred_at DESC, id DESC LIMIT $2`,
    [actorId, limit]
  );
  return (result.rows || []).map(toEvent);
}

async function storageMode() {
  await ensureReady();
  return durableEnabled ? 'database' : 'memory';
}

/** Test seam: the memory store only. Never touches Postgres. */
function __resetMemoryStore() {
  memoryEvents.length = 0;
  memorySequence = 0;
}

module.exports = { append, listForActor, storageMode, __resetMemoryStore };
