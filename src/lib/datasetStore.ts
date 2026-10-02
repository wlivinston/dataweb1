import { getApiUrl } from './publicConfig';
import type { ColumnInfo, Dataset, DataType } from './types';

/**
 * Storing an uploaded dataset on the server, and getting it back.
 *
 * Until this existed, a refresh lost the upload. The dataset endpoints were
 * built, tested against the production database, and called by nothing.
 *
 * The rule throughout is the one the server already follows: REFUSE rather
 * than return something partial. A dataset that comes back ten rows short is
 * not a dataset that is nearly right - it is a set of totals that are wrong
 * by exactly the amount nobody can see, which is the failure this whole
 * engine was built to remove. Every path here would rather throw.
 */

/** What the server knows about a stored dataset, without its rows. */
export interface StoredDataset {
  id: string;
  name: string;
  sourceName: string | null;
  status: 'building' | 'ready';
  rowCount: number;
  columns: Array<{ name: string; type: DataType }>;
  byteSize: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DatasetLimits {
  MAX_ROWS: number;
  MAX_BATCH_ROWS: number;
  MAX_COLUMNS: number;
  MAX_PAGE_ROWS: number;
  MAX_NAME_LENGTH: number;
}

export class DatasetStoreError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'DatasetStoreError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Limits the client would otherwise have to invent.
 *
 * Used only when /limits cannot be reached. Deliberately SMALLER than the
 * server's defaults: guessing low costs an extra round trip, guessing high
 * costs a 413 in the middle of a long upload.
 */
const FALLBACK_LIMITS: DatasetLimits = {
  MAX_ROWS: 1_000_000,
  MAX_BATCH_ROWS: 1_000,
  MAX_COLUMNS: 512,
  MAX_PAGE_ROWS: 1_000,
  MAX_NAME_LENGTH: 200,
};

const BASE = '/api/v1/datasets';

const request = async <T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(getApiUrl(`${BASE}${path}`), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  let payload: { success?: boolean; data?: unknown; meta?: unknown; error?: { code?: string; message?: string } } | null =
    null;
  try {
    payload = await response.json();
  } catch {
    // A body that is not JSON at all - a proxy error page, say. The status
    // still says something useful, so report that rather than a parse error.
    throw new DatasetStoreError(
      `The server returned ${response.status} with no readable body.`,
      response.status,
      'UNREADABLE'
    );
  }

  if (!response.ok || payload?.success === false) {
    throw new DatasetStoreError(
      payload?.error?.message || `Request failed with ${response.status}.`,
      response.status,
      payload?.error?.code || 'UNKNOWN'
    );
  }

  return payload as T;
};

let cachedLimits: DatasetLimits | null = null;

export const fetchLimits = async (token: string): Promise<DatasetLimits> => {
  if (cachedLimits) return cachedLimits;
  try {
    const payload = await request<{ data: DatasetLimits }>('/limits', token);
    cachedLimits = { ...FALLBACK_LIMITS, ...payload.data };
  } catch {
    // Not fatal. The upload can proceed on the conservative fallback, and
    // failing the whole save because a limits lookup failed would be worse
    // than sending smaller batches than necessary.
    cachedLimits = FALLBACK_LIMITS;
  }
  return cachedLimits;
};

/** Only for tests - the cache is per page load otherwise. */
export const __resetLimitsCache = (): void => {
  cachedLimits = null;
};

export const listStoredDatasets = async (token: string): Promise<StoredDataset[]> => {
  const payload = await request<{ data: StoredDataset[] }>('', token);
  return Array.isArray(payload.data) ? payload.data : [];
};

export const deleteStoredDataset = async (id: string, token: string): Promise<void> => {
  await request(`/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
};

/**
 * The columns as the server accepts them.
 *
 * ColumnInfo carries computed statistics - min, max, mean, null counts - that
 * are derived from the rows and would go stale the moment anything changed.
 * Only the name and type are stored; everything else is recomputed on load by
 * the same code that computed it on upload.
 */
const columnsForStorage = (columns: ColumnInfo[]): Array<{ name: string; type: DataType }> =>
  columns.map(column => ({ name: column.name, type: column.type }));

export interface SaveProgress {
  /** Rows written so far. */
  sent: number;
  total: number;
}

/**
 * Store a dataset: create the header, send the rows in batches, complete.
 *
 * Completion is where the server compares what it stored against what was
 * promised, so a dataset that loses rows in transit stays unreadable rather
 * than becoming a shorter dataset that looks fine.
 */
export const saveDataset = async (
  dataset: Dataset,
  token: string,
  onProgress?: (progress: SaveProgress) => void
): Promise<StoredDataset> => {
  const limits = await fetchLimits(token);
  const rows = dataset.data || [];

  if (rows.length > limits.MAX_ROWS) {
    throw new DatasetStoreError(
      `This dataset has ${rows.length.toLocaleString()} rows and the server stores at most ` +
        `${limits.MAX_ROWS.toLocaleString()}.`,
      413,
      'TOO_MANY_ROWS'
    );
  }

  const created = await request<{ data: StoredDataset }>('', token, {
    method: 'POST',
    body: JSON.stringify({
      name: dataset.name.slice(0, limits.MAX_NAME_LENGTH),
      sourceName: dataset.file?.name || dataset.name,
      columns: columnsForStorage(dataset.columns),
    }),
  });

  const id = created.data.id;
  const batchSize = Math.max(1, limits.MAX_BATCH_ROWS);

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    await request(`/${encodeURIComponent(id)}/rows`, token, {
      method: 'POST',
      body: JSON.stringify({ startIndex: start, rows: batch }),
    });
    onProgress?.({ sent: Math.min(start + batch.length, rows.length), total: rows.length });
  }

  const completed = await request<{ data: StoredDataset }>(
    `/${encodeURIComponent(id)}/complete`,
    token,
    { method: 'POST', body: JSON.stringify({ expectedRowCount: rows.length }) }
  );

  return completed.data;
};

export interface LoadProgress {
  loaded: number;
  total: number;
}

interface RowsPage {
  data: Record<string, unknown>[];
  meta: {
    offset: number;
    limit: number;
    returned: number;
    rowCount: number;
    hasMore: boolean;
  };
}

/**
 * Read every row of a stored dataset.
 *
 * Paged, because the server caps a page and will not be talked out of it. The
 * loop stops on hasMore, but ALSO stops if a page returns nothing while
 * claiming more remain - otherwise a server that answered that way would spin
 * here forever, and a hung tab is a worse bug than a failed load.
 *
 * The row count is checked at the end. Returning short would hand the engine
 * a dataset whose every total is quietly wrong.
 */
export const loadDatasetRows = async (
  stored: StoredDataset,
  token: string,
  onProgress?: (progress: LoadProgress) => void
): Promise<Record<string, unknown>[]> => {
  const limits = await fetchLimits(token);
  const pageSize = Math.max(1, limits.MAX_PAGE_ROWS);
  const rows: Record<string, unknown>[] = [];

  let offset = 0;
  for (;;) {
    const page = await request<RowsPage>(
      `/${encodeURIComponent(stored.id)}/rows?offset=${offset}&limit=${pageSize}`,
      token
    );
    const batch = Array.isArray(page.data) ? page.data : [];
    rows.push(...batch);
    onProgress?.({ loaded: rows.length, total: page.meta?.rowCount ?? stored.rowCount });

    if (batch.length === 0) break;
    if (!page.meta?.hasMore) break;
    offset += batch.length;
  }

  if (rows.length !== stored.rowCount) {
    throw new DatasetStoreError(
      `"${stored.name}" should have ${stored.rowCount.toLocaleString()} rows but ` +
        `${rows.length.toLocaleString()} came back. Not loading a partial dataset - every ` +
        'figure computed from it would be wrong by the missing rows.',
      500,
      'INCOMPLETE'
    );
  }

  return rows;
};

/**
 * A stored dataset as the app's own Dataset, statistics and all.
 *
 * analyzeColumn is the same function the upload path uses, so a reloaded
 * dataset is described by exactly the code that described it the first time -
 * rather than by stored statistics that could have been computed by an older
 * version of that code.
 */
export const toDataset = (
  stored: StoredDataset,
  rows: Record<string, unknown>[],
  analyzeColumn: (name: string, values: unknown[]) => ColumnInfo
): Dataset => {
  const columns = stored.columns.map(column => {
    const analysed = analyzeColumn(
      column.name,
      rows.map(row => row[column.name])
    );
    // The stored type wins. It was decided when the file was parsed, with the
    // original cell types visible; re-detecting from JSON round-tripped values
    // could quietly reclassify a column - a date column read back as text
    // loses every time-intelligence question the user could ask of it.
    return { ...analysed, type: column.type };
  });

  return {
    id: stored.id,
    name: stored.name,
    description: stored.sourceName ? `Stored: ${stored.sourceName}` : 'Stored dataset',
    columns,
    rowCount: rows.length,
    dataTypes: Object.fromEntries(stored.columns.map(column => [column.name, column.type])),
    data: rows,
    createdAt: stored.createdAt ? new Date(stored.createdAt) : undefined,
    updatedAt: stored.updatedAt ? new Date(stored.updatedAt) : undefined,
  };
};
