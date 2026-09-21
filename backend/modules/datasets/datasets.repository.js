const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../../config/database');
const logger = require('../../config/logger');

/**
 * Durable storage for uploaded datasets.
 *
 * Rows are stored ONE DATABASE ROW PER DATA ROW, with the cells in a JSONB
 * column. The cheaper shape would be chunked arrays - a thousand data rows per
 * record - and it would write and read faster for the whole-dataset fetch that
 * today's in-memory engine does.
 *
 * It is deliberately not that, because the execution path is still undecided.
 * A dataset stored this way can already be aggregated by Postgres directly:
 *
 *   SELECT data->>'Region', SUM((data->>'Amount')::numeric)
 *   FROM analytics_dataset_rows WHERE dataset_id = $1 GROUP BY 1
 *
 * which is the shape a DAX-to-SQL compiler would emit. Chunked arrays would
 * foreclose that without a rewrite and a re-import of every stored dataset.
 * The cost is paid now, in write volume, so the choice stays open.
 *
 * Follows the storage contract of modules/jobs: durable when DATABASE_URL is
 * set, in-memory otherwise, and never fatal at import time. A developer with
 * no Postgres gets a working API rather than a boot failure.
 */

const STORAGE_MODE = String(process.env.DATASET_STORAGE_MODE || 'auto')
  .trim()
  .toLowerCase();

/**
 * Postgres caps a statement at 65535 bind parameters. Three per row means the
 * ceiling is ~21k rows; 500 keeps each statement small enough that one slow
 * insert does not hold a connection for long.
 */
const INSERT_CHUNK_ROWS = 500;

const memoryDatasets = new Map();
const memoryRows = new Map();

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

function mapDbRowToDataset(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    sourceName: row.source_name || null,
    status: row.status || 'building',
    rowCount: Number(row.row_count || 0),
    columns: Array.isArray(row.columns_json) ? row.columns_json : [],
    byteSize: Number(row.byte_size || 0),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
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
    `CREATE TABLE IF NOT EXISTS analytics_datasets (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      source_name TEXT NULL,
      status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','ready')),
      row_count INTEGER NOT NULL DEFAULT 0,
      columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      byte_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    []
  );

  await query(
    `CREATE TABLE IF NOT EXISTS analytics_dataset_rows (
      dataset_id UUID NOT NULL REFERENCES analytics_datasets (id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      data JSONB NOT NULL,
      PRIMARY KEY (dataset_id, row_index)
    )`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_analytics_datasets_owner_created
     ON analytics_datasets (owner_id, created_at DESC)`,
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
      logger.info('using durable database-backed dataset storage');
    } catch (error) {
      durableEnabled = false;
      initialized = true;
      if (!initWarningEmitted) {
        initWarningEmitted = true;
        logger.warn(
          { err: error?.message || error },
          'durable dataset storage unavailable, falling back to in-memory'
        );
      }
      if (STORAGE_MODE === 'database') {
        const strictError = new Error(
          `DATASET_STORAGE_MODE=database but durable storage initialization failed: ${
            error?.message || 'unknown error'
          }`
        );
        strictError.code = 'DATASET_STORAGE_INIT_FAILED';
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

// ============================================================
// In-memory implementation
// ============================================================

function memoryCreateDataset(dataset, rows) {
  memoryDatasets.set(dataset.id, dataset);
  memoryRows.set(dataset.id, rows);
  return dataset;
}

function memoryListDatasets(ownerId) {
  return Array.from(memoryDatasets.values())
    .filter((entry) => entry.ownerId === ownerId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function memoryGetRows(datasetId, offset, limit) {
  const rows = memoryRows.get(datasetId) || [];
  return rows.slice(offset, offset + limit);
}

function memoryDeleteDataset(datasetId, ownerId) {
  const existing = memoryDatasets.get(datasetId);
  if (!existing || existing.ownerId !== ownerId) return false;
  memoryDatasets.delete(datasetId);
  memoryRows.delete(datasetId);
  return true;
}

// ============================================================
// Public API
// ============================================================

/**
 * Create the dataset header. Rows arrive afterwards, in batches.
 *
 * A dataset starts as 'building' and is not readable as data until it is
 * completed. The transport layer caps a request body at a megabyte by default
 * and twenty at the absolute most, so any dataset worth moving off the browser
 * cannot arrive in one request - and a single-request upload would have left
 * the memory ceiling exactly where it was, just on a different machine.
 */
async function createDataset({ ownerId, name, sourceName, columns }) {
  await ensureReady();

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const dataset = {
    id,
    ownerId,
    name,
    sourceName: sourceName || null,
    status: 'building',
    rowCount: 0,
    columns,
    byteSize: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (!durableEnabled) {
    return memoryCreateDataset(dataset, []);
  }

  await query(
    `INSERT INTO analytics_datasets
       (id, owner_id, name, source_name, status, row_count, columns_json, byte_size)
     VALUES ($1, $2, $3, $4, 'building', 0, $5::jsonb, 0)`,
    [id, ownerId, name, dataset.sourceName, JSON.stringify(columns)]
  );

  return dataset;
}

/**
 * Append a batch of rows at a caller-supplied starting index.
 *
 * The index comes from the caller rather than from a running count so that a
 * retried batch overwrites the rows it wrote the first time instead of
 * appending them twice. ON CONFLICT DO UPDATE makes the write idempotent: a
 * client that times out and retries gets the same dataset, not a doubled one.
 */
async function appendRows(datasetId, startIndex, rows) {
  await ensureReady();

  const addedBytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');

  if (!durableEnabled) {
    const existing = memoryRows.get(datasetId) || [];
    rows.forEach((row, offset) => {
      existing[startIndex + offset] = row;
    });
    memoryRows.set(datasetId, existing);
    const header = memoryDatasets.get(datasetId);
    if (header) {
      header.byteSize += addedBytes;
      header.updatedAt = new Date().toISOString();
    }
    return rows.length;
  }

  // One connection for the whole batch, so a failure part-way through rolls
  // the whole batch back instead of leaving some of its rows behind.
  await withTransaction(async (run) => {
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
      const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS);
      const values = [];
      const params = [];
      chunk.forEach((row, offset) => {
        const base = offset * 3;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
        params.push(datasetId, startIndex + start + offset, JSON.stringify(row));
      });
      await run(
        `INSERT INTO analytics_dataset_rows (dataset_id, row_index, data)
         VALUES ${values.join(', ')}
         ON CONFLICT (dataset_id, row_index) DO UPDATE SET data = EXCLUDED.data`,
        params
      );
    }

    await run(
      `UPDATE analytics_datasets
       SET byte_size = byte_size + $2, updated_at = NOW()
       WHERE id = $1`,
      [datasetId, addedBytes]
    );
  });

  return rows.length;
}

/** How many rows are actually stored. The number the client claims is checked against this. */
async function countRows(datasetId) {
  await ensureReady();
  if (!durableEnabled) {
    const rows = memoryRows.get(datasetId) || [];
    // A sparse array from an out-of-order batch must not count its holes.
    return rows.reduce((total, row) => (row === undefined ? total : total + 1), 0);
  }

  const result = await query(
    `SELECT COUNT(*)::int AS count FROM analytics_dataset_rows WHERE dataset_id = $1`,
    [datasetId]
  );
  return Number((result.rows || [])[0]?.count || 0);
}

/** Mark a dataset readable, recording the row count that was verified. */
async function markReady(datasetId, rowCount) {
  await ensureReady();
  if (!durableEnabled) {
    const header = memoryDatasets.get(datasetId);
    if (!header) return null;
    header.status = 'ready';
    header.rowCount = rowCount;
    header.updatedAt = new Date().toISOString();
    return header;
  }

  const result = await query(
    `UPDATE analytics_datasets
     SET status = 'ready', row_count = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, owner_id, name, source_name, status, row_count, columns_json,
               byte_size, created_at, updated_at`,
    [datasetId, rowCount]
  );
  return mapDbRowToDataset((result.rows || [])[0]);
}

async function listDatasets(ownerId) {
  await ensureReady();
  if (!durableEnabled) return memoryListDatasets(ownerId);

  const result = await query(
    `SELECT id, owner_id, name, source_name, status, row_count, columns_json, byte_size,
            created_at, updated_at
     FROM analytics_datasets
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId]
  );
  return (result.rows || []).map(mapDbRowToDataset);
}

async function getDataset(datasetId, ownerId) {
  await ensureReady();
  if (!durableEnabled) {
    const entry = memoryDatasets.get(datasetId);
    return entry && entry.ownerId === ownerId ? entry : null;
  }

  const result = await query(
    `SELECT id, owner_id, name, source_name, status, row_count, columns_json, byte_size,
            created_at, updated_at
     FROM analytics_datasets
     WHERE id = $1 AND owner_id = $2`,
    [datasetId, ownerId]
  );
  return mapDbRowToDataset((result.rows || [])[0]);
}

/**
 * A page of rows, in stored order.
 *
 * Always ordered by row_index. An unordered LIMIT would return an arbitrary
 * slice that is indistinguishable from the first N, which is the same defect
 * the engine's own row cap was fixed for.
 */
async function getDatasetRows(datasetId, { offset = 0, limit = 1000 } = {}) {
  await ensureReady();
  if (!durableEnabled) return memoryGetRows(datasetId, offset, limit);

  const result = await query(
    `SELECT data FROM analytics_dataset_rows
     WHERE dataset_id = $1
     ORDER BY row_index
     OFFSET $2 LIMIT $3`,
    [datasetId, offset, limit]
  );
  return (result.rows || []).map((row) => row.data);
}

async function deleteDataset(datasetId, ownerId) {
  await ensureReady();
  if (!durableEnabled) return memoryDeleteDataset(datasetId, ownerId);

  const result = await query(
    `DELETE FROM analytics_datasets WHERE id = $1 AND owner_id = $2`,
    [datasetId, ownerId]
  );
  return Number(result.rowCount || 0) > 0;
}

/** Test seam: which backing store is live, once initialisation has run. */
async function storageMode() {
  await ensureReady();
  return durableEnabled ? 'database' : 'memory';
}

/** Test seam: drop in-memory state between tests. Never touches Postgres. */
function __resetMemoryStore() {
  memoryDatasets.clear();
  memoryRows.clear();
}

module.exports = {
  createDataset,
  appendRows,
  countRows,
  markReady,
  listDatasets,
  getDataset,
  getDatasetRows,
  deleteDataset,
  storageMode,
  __resetMemoryStore,
};
