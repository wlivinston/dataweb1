const { ApiError } = require('../common/apiError');
const repository = require('./datasets.repository');

/**
 * Dataset validation and limits.
 *
 * Every limit here REFUSES rather than truncates. Storing 50,000 rows of a
 * 60,000-row upload and reporting success would give an analyst totals that
 * are wrong by exactly the amount nobody can see, which is the failure mode
 * this whole engine was built to remove. A refusal is a worse experience and
 * a better answer.
 */

const numberFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ROWS = numberFromEnv('DATASET_MAX_ROWS', 1000000);
const MAX_COLUMNS = numberFromEnv('DATASET_MAX_COLUMNS', 512);
const MAX_NAME_LENGTH = 200;

/**
 * Rows per batch.
 *
 * Chosen against the transport limit, not invented: server.js caps a request
 * body at BODY_LIMIT (1mb by default) with MAX_CONTENT_LENGTH_BYTES refusing
 * anything over 20mb whatever else is configured. 5,000 rows of ordinary
 * tabular data sits inside a megabyte with room to spare. A client that wants
 * bigger batches has to raise the transport limit first, and will get a plain
 * 413 from the layer that owns that decision rather than a confusing one here.
 */
const MAX_BATCH_ROWS = numberFromEnv('DATASET_MAX_BATCH_ROWS', 5000);

/** Column types the semantic layer understands. Anything else is refused. */
const COLUMN_TYPES = new Set(['string', 'number', 'date', 'boolean']);

const trimString = (value) => String(value === undefined || value === null ? '' : value).trim();

function assertOwner(ownerId) {
  const owner = trimString(ownerId);
  if (!owner) {
    throw ApiError.unauthorized('A dataset owner is required.');
  }
  return owner;
}

function validateName(name) {
  const trimmed = trimString(name);
  if (!trimmed) {
    throw ApiError.badRequest('A dataset name is required.');
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw ApiError.badRequest(
      `A dataset name may be at most ${MAX_NAME_LENGTH} characters; this one is ${trimmed.length}.`
    );
  }
  return trimmed;
}

/**
 * Normalise the column list.
 *
 * Duplicate names are refused rather than de-duplicated. Two columns called
 * "Amount" would make every reference to Sales[Amount] ambiguous, and picking
 * one silently is how a total ends up summing the wrong column.
 */
function validateColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw ApiError.badRequest('At least one column is required.');
  }
  if (columns.length > MAX_COLUMNS) {
    throw ApiError.payloadTooLarge(
      `A dataset may have at most ${MAX_COLUMNS} columns; this one has ${columns.length}.`
    );
  }

  const seen = new Set();
  return columns.map((column, index) => {
    const name = trimString(column && column.name);
    if (!name) {
      throw ApiError.badRequest(`Column ${index + 1} has no name.`);
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw ApiError.badRequest(
        `Two columns are called "${name}". Every reference to it would be ambiguous, ` +
          'so the dataset is refused rather than stored with one of them silently renamed.'
      );
    }
    seen.add(key);

    const type = trimString(column && column.type).toLowerCase() || 'string';
    if (!COLUMN_TYPES.has(type)) {
      throw ApiError.badRequest(
        `Column "${name}" has type "${type}", which is not one of: ` +
          `${Array.from(COLUMN_TYPES).join(', ')}.`
      );
    }

    return { name, type };
  });
}

/**
 * Check the rows against the declared columns.
 *
 * A cell for a column that was never declared is refused. It means the header
 * and the body disagree, and the engine would read a column that the semantic
 * model does not know exists.
 */
function validateRows(rows, columns) {
  if (!Array.isArray(rows)) {
    throw ApiError.badRequest('Rows must be an array.');
  }
  if (rows.length > MAX_ROWS) {
    throw ApiError.payloadTooLarge(
      `A dataset may have at most ${MAX_ROWS.toLocaleString('en-US')} rows; this one has ` +
        `${rows.length.toLocaleString('en-US')}. It is refused rather than truncated, because ` +
        'a stored fraction of a dataset produces totals that are wrong by an invisible amount.'
    );
  }

  const declared = new Set(columns.map((column) => column.name));

  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw ApiError.badRequest(`Row ${index + 1} is not an object of column values.`);
    }
    for (const key of Object.keys(row)) {
      if (!declared.has(key)) {
        throw ApiError.badRequest(
          `Row ${index + 1} has a value for "${key}", which is not a declared column.`
        );
      }
    }
    return row;
  });
}

async function createDataset({ ownerId, name, sourceName, columns }) {
  const owner = assertOwner(ownerId);
  const cleanName = validateName(name);
  const cleanColumns = validateColumns(columns);

  return repository.createDataset({
    ownerId: owner,
    name: cleanName,
    sourceName: trimString(sourceName) || null,
    columns: cleanColumns,
  });
}

/**
 * Append a batch of rows to a dataset that is still being built.
 *
 * `startIndex` is required rather than inferred. Inferring it from the current
 * count makes a retried batch append twice, and a dataset that silently gained
 * 500 duplicate rows would report totals that are wrong in a way no error ever
 * surfaces. With an explicit index, a retry rewrites the same slots.
 */
async function appendRows({ ownerId, datasetId, startIndex, rows }) {
  const dataset = await getDataset(datasetId, ownerId);

  if (dataset.status !== 'building') {
    throw ApiError.conflict(
      'This dataset has already been completed. Rows cannot be added to it; create a new one.'
    );
  }

  const index = Number.parseInt(String(startIndex), 10);
  if (!Number.isFinite(index) || index < 0) {
    throw ApiError.badRequest('startIndex must be a row offset of 0 or more.');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw ApiError.badRequest('A batch must contain at least one row.');
  }
  if (rows.length > MAX_BATCH_ROWS) {
    throw ApiError.payloadTooLarge(
      `A single batch may contain at most ${MAX_BATCH_ROWS.toLocaleString('en-US')} rows; ` +
        `this one has ${rows.length.toLocaleString('en-US')}. Send it as several batches.`
    );
  }
  if (index + rows.length > MAX_ROWS) {
    throw ApiError.payloadTooLarge(
      `This batch would take the dataset past ${MAX_ROWS.toLocaleString('en-US')} rows, ` +
        'which is the most one dataset may hold.'
    );
  }

  const cleanRows = validateRows(rows, dataset.columns);
  const written = await repository.appendRows(dataset.id, index, cleanRows);

  return { written, startIndex: index };
}

/**
 * Finish a dataset, refusing it if what arrived is not what was promised.
 *
 * The client says how many rows it sent; the server counts what it actually
 * stored. A mismatch means a batch was lost, duplicated or never sent, and the
 * dataset is left in 'building' rather than marked readable. This is the whole
 * point of having a completion step: without it, a dropped batch produces a
 * dataset that looks finished and quietly answers every question slightly
 * wrong.
 */
async function completeDataset({ ownerId, datasetId, expectedRowCount }) {
  const dataset = await getDataset(datasetId, ownerId);

  if (dataset.status === 'ready') {
    return dataset;
  }

  const expected = Number.parseInt(String(expectedRowCount), 10);
  if (!Number.isFinite(expected) || expected < 0) {
    throw ApiError.badRequest(
      'expectedRowCount is required, so the server can check that everything sent arrived.'
    );
  }

  const stored = await repository.countRows(dataset.id);
  if (stored !== expected) {
    throw ApiError.unprocessable(
      `This dataset was declared as ${expected.toLocaleString('en-US')} rows but ` +
        `${stored.toLocaleString('en-US')} arrived. It has been left incomplete rather than ` +
        'marked ready, because a dataset missing rows answers every question slightly wrong ' +
        'with no sign that anything is missing. Re-send the missing batches and complete again.',
      { expected, stored }
    );
  }

  return repository.markReady(dataset.id, stored);
}

async function listDatasets(ownerId) {
  return repository.listDatasets(assertOwner(ownerId));
}

async function getDataset(datasetId, ownerId) {
  const dataset = await repository.getDataset(trimString(datasetId), assertOwner(ownerId));
  if (!dataset) {
    throw ApiError.notFound('No such dataset.');
  }
  return dataset;
}

/**
 * A page of rows.
 *
 * `limit` is capped rather than honoured blindly, and the response says what
 * was actually applied, so a caller asking for a million rows learns it got a
 * page instead of assuming it got everything.
 */
const MAX_PAGE_ROWS = numberFromEnv('DATASET_MAX_PAGE_ROWS', 5000);

async function getDatasetRows(datasetId, ownerId, { offset = 0, limit = 1000 } = {}) {
  const dataset = await getDataset(datasetId, ownerId);

  if (dataset.status !== 'ready') {
    throw ApiError.conflict(
      'This dataset is still being uploaded. Its rows are not readable until it is completed ' +
        'and its row count verified, so that a partial upload can never be read as a whole one.'
    );
  }

  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const requested = Number.parseInt(String(limit), 10);
  const safeLimit = Math.min(
    MAX_PAGE_ROWS,
    Number.isFinite(requested) && requested > 0 ? requested : 1000
  );

  const rows = await repository.getDatasetRows(dataset.id, {
    offset: safeOffset,
    limit: safeLimit,
  });

  return {
    rows,
    meta: {
      offset: safeOffset,
      limit: safeLimit,
      returned: rows.length,
      rowCount: dataset.rowCount,
      hasMore: safeOffset + rows.length < dataset.rowCount,
    },
  };
}

async function deleteDataset(datasetId, ownerId) {
  const removed = await repository.deleteDataset(trimString(datasetId), assertOwner(ownerId));
  if (!removed) {
    throw ApiError.notFound('No such dataset.');
  }
  return true;
}

module.exports = {
  createDataset,
  appendRows,
  completeDataset,
  listDatasets,
  getDataset,
  getDatasetRows,
  deleteDataset,
  limits: { MAX_ROWS, MAX_BATCH_ROWS, MAX_COLUMNS, MAX_PAGE_ROWS, MAX_NAME_LENGTH },
};
