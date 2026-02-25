const { randomUUID } = require('crypto');
const repository = require('./jobs.repository');
const { ApiError } = require('../common/apiError');

const JOB_STATUSES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const DEFAULT_JOB_CONCURRENCY = 2;
const DEFAULT_JOB_RETENTION_HOURS = 24;
const DEFAULT_JOB_LEASE_MS = 120000;

const concurrency =
  Number.parseInt(String(process.env.JOB_WORKER_CONCURRENCY || ''), 10) || DEFAULT_JOB_CONCURRENCY;
const retentionHours =
  Number.parseInt(String(process.env.JOB_RETENTION_HOURS || ''), 10) || DEFAULT_JOB_RETENTION_HOURS;
const retentionMs = Math.max(1, retentionHours) * 60 * 60 * 1000;
const leaseMs =
  Math.max(5000, Number.parseInt(String(process.env.JOB_LEASE_MS || ''), 10) || DEFAULT_JOB_LEASE_MS);
const workerId = String(process.env.JOB_WORKER_ID || `worker-${process.pid}-${randomUUID().slice(0, 8)}`);

const processorRegistry = new Map();

let activeWorkers = 0;
let pumpScheduled = false;
let isPumping = false;
let isReady = false;

const trimString = (value) => String(value || '').trim();

function buildIdempotencyCompositeKey(ownerId, type, idempotencyKey) {
  const key = trimString(idempotencyKey);
  if (!key) return null;
  return `${ownerId}|${type}|${key}`;
}

function sanitizeJobForClient(job, options = {}) {
  if (!job) return null;
  const includeInput = Boolean(options.includeInput);

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    result: job.result,
    error: job.error,
    input: includeInput ? job.input : undefined,
    idempotencyKey: job.idempotencyKey || undefined,
  };
}

function normalizeError(error) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || undefined,
    };
  }

  return {
    code: 'JOB_EXECUTION_FAILED',
    message: String(error?.message || 'Job execution failed'),
  };
}

async function ensureInitialized() {
  if (isReady) return;
  await repository.ensureReady();
  isReady = true;
  schedulePump();
}

function registerProcessor(type, processor) {
  if (!type || typeof type !== 'string') {
    throw ApiError.badRequest('Processor type is required', null, 'INVALID_PROCESSOR_TYPE');
  }
  if (typeof processor !== 'function') {
    throw ApiError.badRequest('Processor must be a function', null, 'INVALID_PROCESSOR');
  }
  processorRegistry.set(type, processor);
}

function getProcessor(type) {
  return processorRegistry.get(type) || null;
}

async function executeClaimedJob(job, processor) {
  const progress = async (percent, message) => {
    try {
      await repository.updateJobProgress({
        jobId: job.id,
        percent: Math.max(0, Math.min(100, Number(percent) || 0)),
        message: String(message || '').trim() || 'Running',
        workerId,
        leaseMs,
      });
    } catch (error) {
      console.error(`[jobs] Failed to update progress for ${job.id}:`, error);
    }
  };

  try {
    const result = await processor(job.input || {}, progress, job);
    await repository.completeJob({
      jobId: job.id,
      result: result ?? null,
      workerId,
    });
  } catch (error) {
    await repository.failJob({
      jobId: job.id,
      error: normalizeError(error),
      workerId,
    });
  } finally {
    activeWorkers = Math.max(0, activeWorkers - 1);
    schedulePump();
  }
}

async function runPump() {
  await repository.deleteStaleJobs(retentionMs);
  await repository.requeueExpiredJobs({
    nowMs: Date.now(),
    timeoutMessage: 'Job exceeded worker lease timeout',
  });

  while (activeWorkers < concurrency) {
    const claimed = await repository.claimNextQueuedJob(workerId, leaseMs);
    if (!claimed) break;

    const processor = getProcessor(claimed.type);
    if (!processor) {
      await repository.failJob({
        jobId: claimed.id,
        error: {
          code: 'JOB_PROCESSOR_NOT_REGISTERED',
          message: `No processor registered for job type "${claimed.type}"`,
        },
        workerId,
      });
      continue;
    }

    activeWorkers += 1;
    void executeClaimedJob(claimed, processor);
  }
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setImmediate(async () => {
    pumpScheduled = false;
    if (isPumping) return;
    isPumping = true;
    try {
      await runPump();
    } catch (error) {
      console.error('[jobs] pump failure:', error);
    } finally {
      isPumping = false;
    }
  });
}

async function enqueueJob({
  type,
  ownerId,
  idempotencyKey,
  input = {},
  processor,
}) {
  await ensureInitialized();

  if (!ownerId) {
    throw ApiError.unauthorized('Authentication required to enqueue jobs', null, 'AUTH_REQUIRED');
  }
  if (!type || typeof type !== 'string') {
    throw ApiError.badRequest('Job type is required', null, 'INVALID_JOB_TYPE');
  }

  if (processor) {
    registerProcessor(type, processor);
  }
  if (!getProcessor(type)) {
    throw ApiError.badRequest(
      `No processor is registered for job type "${type}"`,
      null,
      'INVALID_JOB_PROCESSOR'
    );
  }

  const normalizedIdempotencyKey = trimString(idempotencyKey) || null;
  const compositeKey = buildIdempotencyCompositeKey(ownerId, type, normalizedIdempotencyKey);
  if (compositeKey) {
    const existing = await repository.findJobByIdempotency({
      ownerId,
      type,
      idempotencyKey: normalizedIdempotencyKey,
    });
    if (existing) {
      return {
        job: sanitizeJobForClient(existing),
        reused: true,
      };
    }
  }

  let job = null;
  try {
    job = await repository.createJob({
      type,
      ownerId,
      idempotencyKey: normalizedIdempotencyKey,
      input,
    });
  } catch (error) {
    if (error?.code === 'JOB_IDEMPOTENCY_CONFLICT' && compositeKey) {
      const existing = await repository.findJobByIdempotency({
        ownerId,
        type,
        idempotencyKey: normalizedIdempotencyKey,
      });
      if (existing) {
        return {
          job: sanitizeJobForClient(existing),
          reused: true,
        };
      }
    }
    throw error;
  }

  schedulePump();
  return {
    job: sanitizeJobForClient(job),
    reused: false,
  };
}

async function getJobForOwner(jobId, ownerId, options = {}) {
  await ensureInitialized();
  const job = await repository.getJob(jobId);
  if (!job) {
    throw ApiError.notFound('Job not found', { jobId }, 'JOB_NOT_FOUND');
  }
  if (!ownerId || job.ownerId !== ownerId) {
    throw ApiError.forbidden('You are not authorized to access this job', { jobId }, 'JOB_FORBIDDEN');
  }
  return sanitizeJobForClient(job, options);
}

async function listJobsForOwner(ownerId, filter = {}, options = {}) {
  await ensureInitialized();
  if (!ownerId) {
    throw ApiError.unauthorized('Authentication required', null, 'AUTH_REQUIRED');
  }

  const page = Math.max(1, Number.parseInt(String(filter.page || ''), 10) || 1);
  const limitRaw = Number.parseInt(String(filter.limit || ''), 10) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;

  const all = await repository.listJobs({
    ownerId,
    type: trimString(filter.type) || null,
    status: trimString(filter.status) || null,
  });

  const sliced = all.slice(offset, offset + limit);
  return {
    jobs: sliced.map((job) => sanitizeJobForClient(job, options)),
    meta: {
      page,
      limit,
      total: all.length,
      totalPages: Math.max(1, Math.ceil(all.length / limit)),
    },
  };
}

async function getStorageInfo() {
  await ensureInitialized();
  return repository.getStorageInfo();
}

module.exports = {
  JOB_STATUSES,
  registerProcessor,
  enqueueJob,
  getJobForOwner,
  listJobsForOwner,
  getStorageInfo,
};
