const { randomUUID } = require('crypto');
const { query } = require('../../config/database');

const STORAGE_MODE = String(process.env.JOB_STORAGE_MODE || 'auto')
  .trim()
  .toLowerCase();

const DEFAULT_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(String(process.env.JOB_MAX_ATTEMPTS || ''), 10) || 3
);

const memoryJobsById = new Map();
const memoryIdempotencyToJobId = new Map();

let initialized = false;
let durableEnabled = false;
let initializationPromise = null;
let initWarningEmitted = false;

const trimString = (value) => String(value || '').trim();

function normalizeTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function mapDbRowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.job_type,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key || null,
    status: row.status,
    progress: {
      percent: Number(row.progress_percent || 0),
      message: String(row.progress_message || 'Queued'),
    },
    input: row.input_json || {},
    result: row.result_json || null,
    error: row.error_json || null,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS),
    workerId: row.worker_id || null,
    leaseExpiresAt: normalizeTimestamp(row.lease_expires_at),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at),
    failedAt: normalizeTimestamp(row.failed_at),
  };
}

function shouldTryDurableStore() {
  if (STORAGE_MODE === 'memory') return false;
  const hasDatabaseUrl = Boolean(trimString(process.env.DATABASE_URL));
  if (STORAGE_MODE === 'database') return true;
  return hasDatabaseUrl;
}

async function initializeDurableStore() {
  await query(
    `CREATE TABLE IF NOT EXISTS api_jobs (
      id UUID PRIMARY KEY,
      job_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      idempotency_key TEXT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
      progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
      progress_message TEXT NOT NULL DEFAULT 'Queued',
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB NULL,
      error_json JSONB NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      worker_id TEXT NULL,
      lease_expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      failed_at TIMESTAMPTZ NULL
    )`,
    []
  );

  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_api_jobs_idempotency
     ON api_jobs (owner_id, job_type, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
    []
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_api_jobs_owner_created
     ON api_jobs (owner_id, created_at DESC)`,
    []
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_api_jobs_status_created
     ON api_jobs (status, created_at ASC)`,
    []
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_api_jobs_lease
     ON api_jobs (status, lease_expires_at)`,
    []
  );
}

async function ensureReady() {
  if (initialized) return;
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    if (!shouldTryDurableStore()) {
      durableEnabled = false;
      initialized = true;
      return;
    }

    try {
      await initializeDurableStore();
      durableEnabled = true;
      initialized = true;
      console.log('[jobs] Using durable database-backed job storage.');
    } catch (error) {
      durableEnabled = false;
      initialized = true;
      if (!initWarningEmitted) {
        initWarningEmitted = true;
        console.warn(
          `[jobs] Durable job storage unavailable (${error?.message || error}). Falling back to in-memory storage.`
        );
      }
      if (STORAGE_MODE === 'database') {
        const strictError = new Error(
          `JOB_STORAGE_MODE=database but durable storage initialization failed: ${
            error?.message || 'unknown error'
          }`
        );
        strictError.code = 'JOB_STORAGE_INIT_FAILED';
        throw strictError;
      }
    }
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

function memoryCreateJob({ id, type, ownerId, idempotencyKey = null, input = {}, maxAttempts }) {
  const nowIso = new Date().toISOString();
  const jobId = id || randomUUID();
  const job = {
    id: jobId,
    type,
    ownerId,
    idempotencyKey,
    status: 'queued',
    progress: {
      percent: 0,
      message: 'Queued',
    },
    input,
    result: null,
    error: null,
    attemptCount: 0,
    maxAttempts: Math.max(1, Number(maxAttempts || DEFAULT_MAX_ATTEMPTS)),
    workerId: null,
    leaseExpiresAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    startedAt: null,
    completedAt: null,
    failedAt: null,
  };

  memoryJobsById.set(job.id, job);
  return job;
}

function memoryUpdateJob(jobId, patch) {
  const existing = memoryJobsById.get(jobId);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  memoryJobsById.set(jobId, updated);
  return updated;
}

function memoryGetJob(jobId) {
  return memoryJobsById.get(jobId) || null;
}

function memoryListJobs(filter = {}) {
  const ownerId = filter.ownerId || null;
  const type = filter.type || null;
  const status = filter.status || null;
  return [...memoryJobsById.values()]
    .filter((job) => (ownerId ? job.ownerId === ownerId : true))
    .filter((job) => (type ? job.type === type : true))
    .filter((job) => (status ? job.status === status : true))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function memoryFindByIdempotency({ ownerId, type, idempotencyKey }) {
  if (!idempotencyKey) return null;
  const key = `${ownerId}|${type}|${idempotencyKey}`;
  const jobId = memoryIdempotencyToJobId.get(key);
  if (!jobId) return null;
  return memoryGetJob(jobId);
}

function memorySetIdempotency({ ownerId, type, idempotencyKey, jobId }) {
  if (!idempotencyKey) return;
  const key = `${ownerId}|${type}|${idempotencyKey}`;
  memoryIdempotencyToJobId.set(key, jobId);
}

async function createJob({ id, type, ownerId, idempotencyKey = null, input = {}, maxAttempts }) {
  await ensureReady();

  const safeId = id || randomUUID();
  const safeAttempts = Math.max(1, Number(maxAttempts || DEFAULT_MAX_ATTEMPTS));

  if (!durableEnabled) {
    const job = memoryCreateJob({
      id: safeId,
      type,
      ownerId,
      idempotencyKey,
      input,
      maxAttempts: safeAttempts,
    });
    memorySetIdempotency({
      ownerId,
      type,
      idempotencyKey: idempotencyKey || null,
      jobId: job.id,
    });
    return job;
  }

  try {
    const result = await query(
      `INSERT INTO api_jobs (
        id, job_type, owner_id, idempotency_key, status, progress_percent, progress_message,
        input_json, result_json, error_json, attempt_count, max_attempts, worker_id, lease_expires_at
      )
      VALUES ($1, $2, $3, $4, 'queued', 0, 'Queued', $5::jsonb, NULL, NULL, 0, $6, NULL, NULL)
      RETURNING *`,
      [
        safeId,
        type,
        ownerId,
        idempotencyKey || null,
        JSON.stringify(input || {}),
        safeAttempts,
      ]
    );
    return mapDbRowToJob(result.rows?.[0]);
  } catch (error) {
    if (error?.code === '23505') {
      const conflict = new Error('Duplicate idempotency key');
      conflict.code = 'JOB_IDEMPOTENCY_CONFLICT';
      throw conflict;
    }
    throw error;
  }
}

async function findJobByIdempotency({ ownerId, type, idempotencyKey }) {
  await ensureReady();
  const key = trimString(idempotencyKey);
  if (!key) return null;

  if (!durableEnabled) {
    return memoryFindByIdempotency({ ownerId, type, idempotencyKey: key });
  }

  const result = await query(
    `SELECT *
     FROM api_jobs
     WHERE owner_id = $1 AND job_type = $2 AND idempotency_key = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerId, type, key]
  );
  return mapDbRowToJob(result.rows?.[0]);
}

async function getJob(jobId) {
  await ensureReady();
  if (!durableEnabled) return memoryGetJob(jobId);

  const result = await query('SELECT * FROM api_jobs WHERE id = $1', [jobId]);
  return mapDbRowToJob(result.rows?.[0]);
}

async function listJobs(filter = {}) {
  await ensureReady();
  if (!durableEnabled) return memoryListJobs(filter);

  const values = [];
  const clauses = [];
  let index = 1;
  if (filter.ownerId) {
    clauses.push(`owner_id = $${index++}`);
    values.push(filter.ownerId);
  }
  if (filter.type) {
    clauses.push(`job_type = $${index++}`);
    values.push(filter.type);
  }
  if (filter.status) {
    clauses.push(`status = $${index++}`);
    values.push(filter.status);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `SELECT *
     FROM api_jobs
     ${where}
     ORDER BY created_at DESC`,
    values
  );
  return (result.rows || []).map(mapDbRowToJob);
}

async function claimNextQueuedJob(workerId, leaseMs) {
  await ensureReady();
  const safeLeaseMs = Math.max(5000, Number(leaseMs || 60000));

  if (!durableEnabled) {
    const queued = [...memoryJobsById.values()]
      .filter((job) => job.status === 'queued')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!queued) return null;

    const leaseExpiresAt = new Date(Date.now() + safeLeaseMs).toISOString();
    return memoryUpdateJob(queued.id, {
      status: 'running',
      startedAt: queued.startedAt || new Date().toISOString(),
      progress: {
        percent: Math.max(5, Number(queued.progress?.percent || 0)),
        message: 'Running',
      },
      workerId: workerId || null,
      leaseExpiresAt,
      attemptCount: Number(queued.attemptCount || 0) + 1,
    });
  }

  const result = await query(
    `WITH next_job AS (
      SELECT id
      FROM api_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE api_jobs j
    SET status = 'running',
        started_at = COALESCE(j.started_at, NOW()),
        updated_at = NOW(),
        progress_percent = GREATEST(j.progress_percent, 5),
        progress_message = 'Running',
        worker_id = $1,
        lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond'),
        attempt_count = j.attempt_count + 1
    FROM next_job
    WHERE j.id = next_job.id
    RETURNING j.*`,
    [workerId || null, safeLeaseMs]
  );

  return mapDbRowToJob(result.rows?.[0]);
}

async function updateJobProgress({ jobId, percent, message, workerId, leaseMs }) {
  await ensureReady();
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const safeMessage = trimString(message) || 'Running';
  const safeLeaseMs = Math.max(5000, Number(leaseMs || 60000));

  if (!durableEnabled) {
    const existing = memoryGetJob(jobId);
    if (!existing || existing.status !== 'running') return null;
    if (workerId && existing.workerId && existing.workerId !== workerId) return null;
    const leaseExpiresAt = new Date(Date.now() + safeLeaseMs).toISOString();
    return memoryUpdateJob(jobId, {
      progress: {
        percent: safePercent,
        message: safeMessage,
      },
      leaseExpiresAt,
    });
  }

  const clauses = ['id = $1', `status = 'running'`];
  const values = [jobId, safePercent, safeMessage, safeLeaseMs];
  if (workerId) {
    clauses.push(`worker_id = $5`);
    values.push(workerId);
  }
  const result = await query(
    `UPDATE api_jobs
     SET progress_percent = $2,
         progress_message = $3,
         lease_expires_at = NOW() + ($4 * INTERVAL '1 millisecond'),
         updated_at = NOW()
     WHERE ${clauses.join(' AND ')}
     RETURNING *`,
    values
  );
  return mapDbRowToJob(result.rows?.[0]);
}

async function completeJob({ jobId, result, workerId }) {
  await ensureReady();

  if (!durableEnabled) {
    const existing = memoryGetJob(jobId);
    if (!existing) return null;
    if (workerId && existing.workerId && existing.workerId !== workerId) return null;
    return memoryUpdateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: result ?? null,
      error: null,
      workerId: null,
      leaseExpiresAt: null,
      progress: {
        percent: 100,
        message: 'Completed',
      },
    });
  }

  const clauses = ['id = $1'];
  const values = [jobId, JSON.stringify(result ?? null)];
  if (workerId) {
    clauses.push('worker_id = $3');
    values.push(workerId);
  }

  const resultSet = await query(
    `UPDATE api_jobs
     SET status = 'completed',
         completed_at = NOW(),
         updated_at = NOW(),
         progress_percent = 100,
         progress_message = 'Completed',
         result_json = $2::jsonb,
         error_json = NULL,
         worker_id = NULL,
         lease_expires_at = NULL
     WHERE ${clauses.join(' AND ')}
     RETURNING *`,
    values
  );
  return mapDbRowToJob(resultSet.rows?.[0]);
}

async function failJob({ jobId, error, workerId }) {
  await ensureReady();
  const normalizedError = error || { code: 'JOB_FAILED', message: 'Job failed' };

  if (!durableEnabled) {
    const existing = memoryGetJob(jobId);
    if (!existing) return null;
    if (workerId && existing.workerId && existing.workerId !== workerId) return null;
    return memoryUpdateJob(jobId, {
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: normalizedError,
      workerId: null,
      leaseExpiresAt: null,
      progress: {
        percent: 100,
        message: 'Failed',
      },
    });
  }

  const clauses = ['id = $1'];
  const values = [jobId, JSON.stringify(normalizedError)];
  if (workerId) {
    clauses.push('worker_id = $3');
    values.push(workerId);
  }

  const resultSet = await query(
    `UPDATE api_jobs
     SET status = 'failed',
         failed_at = NOW(),
         updated_at = NOW(),
         progress_percent = 100,
         progress_message = 'Failed',
         error_json = $2::jsonb,
         worker_id = NULL,
         lease_expires_at = NULL
     WHERE ${clauses.join(' AND ')}
     RETURNING *`,
    values
  );
  return mapDbRowToJob(resultSet.rows?.[0]);
}

async function requeueExpiredJobs({ nowMs, timeoutMessage }) {
  await ensureReady();
  const safeNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  const safeTimeoutMessage = trimString(timeoutMessage) || 'Job exceeded lease timeout';

  if (!durableEnabled) {
    const now = safeNowMs;
    for (const job of memoryJobsById.values()) {
      if (job.status !== 'running') continue;
      if (!job.leaseExpiresAt) continue;
      const leaseMs = Date.parse(job.leaseExpiresAt);
      if (!Number.isFinite(leaseMs) || leaseMs >= now) continue;

      if (Number(job.attemptCount || 0) >= Number(job.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
        memoryUpdateJob(job.id, {
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: {
            code: 'JOB_TIMEOUT',
            message: safeTimeoutMessage,
          },
          workerId: null,
          leaseExpiresAt: null,
          progress: {
            percent: 100,
            message: 'Failed',
          },
        });
      } else {
        memoryUpdateJob(job.id, {
          status: 'queued',
          workerId: null,
          leaseExpiresAt: null,
          progress: {
            percent: Number(job.progress?.percent || 0),
            message: 'Re-queued after worker timeout',
          },
        });
      }
    }
    return;
  }

  await query(
    `UPDATE api_jobs
     SET status = 'queued',
         worker_id = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         progress_message = 'Re-queued after worker timeout'
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < NOW()
       AND attempt_count < max_attempts`,
    []
  );

  await query(
    `UPDATE api_jobs
     SET status = 'failed',
         failed_at = COALESCE(failed_at, NOW()),
         updated_at = NOW(),
         progress_percent = 100,
         progress_message = 'Failed',
         error_json = COALESCE(error_json, $1::jsonb),
         worker_id = NULL,
         lease_expires_at = NULL
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < NOW()
       AND attempt_count >= max_attempts`,
    [JSON.stringify({ code: 'JOB_TIMEOUT', message: safeTimeoutMessage })]
  );
}

async function deleteStaleJobs(retentionMs) {
  await ensureReady();
  const safeRetentionMs = Math.max(60_000, Number(retentionMs || 0));
  const now = Date.now();

  if (!durableEnabled) {
    for (const [id, job] of memoryJobsById.entries()) {
      const updatedAtMs = Date.parse(job.updatedAt || job.createdAt || '');
      if (!Number.isFinite(updatedAtMs)) continue;
      if (now - updatedAtMs <= safeRetentionMs) continue;
      if (!['completed', 'failed'].includes(job.status)) continue;

      memoryJobsById.delete(id);
      if (job.idempotencyKey) {
        const key = `${job.ownerId}|${job.type}|${job.idempotencyKey}`;
        const currentJobId = memoryIdempotencyToJobId.get(key);
        if (currentJobId === id) {
          memoryIdempotencyToJobId.delete(key);
        }
      }
    }
    return;
  }

  await query(
    `DELETE FROM api_jobs
     WHERE status IN ('completed', 'failed')
       AND updated_at < NOW() - ($1 * INTERVAL '1 millisecond')`,
    [safeRetentionMs]
  );
}

async function getStorageInfo() {
  await ensureReady();
  return {
    mode: durableEnabled ? 'database' : 'memory',
    durable: durableEnabled,
  };
}

module.exports = {
  ensureReady,
  createJob,
  findJobByIdempotency,
  getJob,
  listJobs,
  claimNextQueuedJob,
  updateJobProgress,
  completeJob,
  failJob,
  requeueExpiredJobs,
  deleteStaleJobs,
  getStorageInfo,
};
