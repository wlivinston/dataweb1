const { ApiError } = require('../common/apiError');
const datasetsService = require('../datasets/datasets.service');
const repository = require('../datasets/datasets.repository');
// The browser's engine, bundled from src/lib/engine (see engineBundle.test.ts,
// which fails if this file differs from the source). One implementation of the
// DAX semantics on both sides - docs/server-side-compute-decision.md.
const engine = require('../../engine/engine.cjs');
const logger = require('../../config/logger');

/**
 * Questions answered over stored datasets, on the server.
 *
 * Rows are loaded from the store and evaluated by the same engine the browser
 * runs. Nothing about a value is decided in SQL: the store only supplies the
 * rows (pushdown of row selection may come later, predicate by predicate,
 * each proved equivalent - never a value decision).
 */

const numberFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Rows read per round trip to the store. */
const PAGE_ROWS = numberFromEnv('ANALYTICS_PAGE_ROWS', 5000);
/** Total rows one query may load across its datasets. */
// 500k rows is ~0.5 GB of heap and ~2 s to build (measured on the engine
// bundle); 1M was ~1.2 GB, too close to a default serverless function's memory.
const MAX_ROWS = numberFromEnv('ANALYTICS_MAX_ROWS', 500000);
const MAX_DATASETS = 10;
const MAX_TEXT = 4000;
const CACHE_SIZE = numberFromEnv('ANALYTICS_MODEL_CACHE', 8);

// Built models, keyed by owner and the exact dataset versions they came from.
// A model is rebuilt whenever any dataset in it changes (updatedAt), so a
// cached model can never answer for data that has since been replaced.
const modelCache = new Map();

const cacheKey = (ownerId, datasets) =>
  `${ownerId}|${datasets.map((d) => `${d.id}@${d.updatedAt || ''}#${d.rowCount}`).sort().join(',')}`;

const remember = (key, model) => {
  modelCache.delete(key);
  modelCache.set(key, model);
  while (modelCache.size > CACHE_SIZE) modelCache.delete(modelCache.keys().next().value);
};

/**
 * Every row of a completed dataset, or an error. Never a partial dataset: if
 * the store returns fewer rows than the dataset says it holds, that is refused
 * rather than answered over - the same rule the browser's loader keeps.
 */
async function loadAllRows(dataset) {
  const rows = [];
  while (rows.length < dataset.rowCount) {
    const page = await repository.getDatasetRows(dataset.id, { offset: rows.length, limit: PAGE_ROWS });
    if (page.length === 0) break;
    rows.push(...page);
  }
  if (rows.length !== dataset.rowCount) {
    throw ApiError.conflict(
      `"${dataset.name}" returned ${rows.length} of its ${dataset.rowCount} rows. ` +
        'A question is never answered over part of a dataset; try again.'
    );
  }
  return rows;
}

async function modelFor(ownerId, datasetIds) {
  const ids = [...new Set(datasetIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) throw ApiError.badRequest('Name at least one dataset.');
  if (ids.length > MAX_DATASETS) throw ApiError.badRequest(`At most ${MAX_DATASETS} datasets per question.`);

  // Owner-scoped: getDataset refuses another owner's dataset as not found.
  const datasets = [];
  for (const id of ids) {
    const dataset = await datasetsService.getDataset(id, ownerId);
    if (dataset.status !== 'ready') {
      throw ApiError.conflict(`"${dataset.name}" is still being uploaded and cannot be queried yet.`);
    }
    datasets.push(dataset);
  }

  const totalRows = datasets.reduce((sum, d) => sum + d.rowCount, 0);
  if (totalRows > MAX_ROWS) {
    throw ApiError.payloadTooLarge(
      `These datasets hold ${totalRows.toLocaleString()} rows; one question may use at most ${MAX_ROWS.toLocaleString()}.`
    );
  }

  const key = cacheKey(ownerId, datasets);
  const cached = modelCache.get(key);
  if (cached) {
    remember(key, cached);
    return { model: cached, datasets, totalRows, cached: true, loadMs: 0, buildMs: 0 };
  }

  const loadStart = Date.now();
  const engineDatasets = [];
  for (const dataset of datasets) {
    engineDatasets.push(engine.datasetFromStore(dataset, await loadAllRows(dataset)));
  }
  const buildStart = Date.now();
  const model = engine.buildSemanticModel(engineDatasets);
  const buildMs = Date.now() - buildStart;
  remember(key, model);
  return { model, datasets, totalRows, cached: false, loadMs: buildStart - loadStart, buildMs };
}

/**
 * Evaluate a DAX expression, or answer a plain-English question, over the
 * caller's datasets. Exactly one of `expression` and `question`.
 */
async function query({ ownerId, datasetIds, expression, question }) {
  const hasExpression = typeof expression === 'string' && expression.trim() !== '';
  const hasQuestion = typeof question === 'string' && question.trim() !== '';
  if (hasExpression === hasQuestion) {
    throw ApiError.badRequest('Send either a DAX expression or a question, not both and not neither.');
  }
  const text = (hasExpression ? expression : question).trim();
  if (text.length > MAX_TEXT) throw ApiError.badRequest(`Keep it under ${MAX_TEXT} characters.`);

  const { model, datasets, totalRows, cached, loadMs, buildMs } = await modelFor(ownerId, datasetIds || []);
  const evalStart = Date.now();
  const meta = () => {
    const timingMs = { load: loadMs, build: buildMs, evaluate: Date.now() - evalStart };
    // Logged so speed over real stored data can be read from production
    // logs: the function has a 30 s limit, and only measurements against the
    // real store say how close large datasets come to it.
    logger.info({ rows: totalRows, datasets: datasets.length, modelCached: cached, timingMs }, 'analytics query');
    return {
      datasets: datasets.map((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount })),
      rows: totalRows,
      modelCached: cached,
      timingMs,
    };
  };

  if (hasExpression) {
    const result = engine.runDax(text, model);
    if (!result.ok) {
      // The engine refuses rather than guesses; the refusal is the answer.
      throw ApiError.unprocessable(result.message, { detail: result.detail, issues: result.issues }, 'DAX_REFUSED');
    }
    return {
      data: {
        kind: 'dax',
        expression: result.normalised,
        value: result.value,
        formatted: engine.formatDaxValue(result.value),
        warnings: result.warnings,
      },
      meta: meta(),
    };
  }

  const answer = engine.answerQuestion(text, model);
  return { data: { kind: 'question', answer }, meta: meta() };
}

/** Test seam. */
function __resetModelCache() {
  modelCache.clear();
}

module.exports = { query, limits: { MAX_ROWS, MAX_DATASETS, MAX_TEXT }, __resetModelCache };
