import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveDataset,
  loadDatasetRows,
  listStoredDatasets,
  deleteStoredDataset,
  fetchLimits,
  toDataset,
  DatasetStoreError,
  __resetLimitsCache,
  type StoredDataset,
} from '../datasetStore';
import { analyzeColumn } from '../dataUtils';
import { makeDataset } from './fixtures';

/**
 * Storing a dataset and getting it back.
 *
 * Driven against a recorded fake rather than a live server, because what
 * matters here is the SEQUENCE and the refusals: create before rows, rows
 * before complete, batches sized to the server's published limit, and a
 * flat refusal when fewer rows come back than were promised. Those are the
 * properties that decide whether a reloaded dataset can be trusted, and none
 * of them needs a database to check.
 *
 * Value fidelity through real Postgres is a separate test in the backend
 * suite - a fake cannot prove that a zero survives JSONB.
 */

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const LIMITS = {
  MAX_ROWS: 1_000_000,
  MAX_BATCH_ROWS: 10,
  MAX_COLUMNS: 512,
  MAX_PAGE_ROWS: 4,
  MAX_NAME_LENGTH: 200,
};

let calls: Call[] = [];

/** A server that records what it was asked and answers from `handlers`. */
const fakeServer = (
  handlers: Partial<{
    limits: () => unknown;
    list: () => unknown;
    create: () => unknown;
    rows: (call: Call) => unknown;
    complete: () => unknown;
    page: (offset: number, limit: number) => unknown;
    remove: () => unknown;
  }>
) => {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1\/datasets/, '');
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const call: Call = { method, path, body };
    calls.push(call);

    const ok = (payload: unknown) => ({
      ok: true,
      status: 200,
      json: async () => payload,
    });

    if (path.startsWith('/limits')) return ok({ success: true, data: handlers.limits?.() ?? LIMITS });
    if (method === 'DELETE') return ok({ success: true, data: handlers.remove?.() ?? { deleted: true } });
    if (method === 'POST' && path === '')
      return ok({ success: true, data: handlers.create?.() ?? { id: 'ds-1', name: 'x' } });
    if (method === 'POST' && path.endsWith('/complete'))
      return ok({ success: true, data: handlers.complete?.() ?? { id: 'ds-1', status: 'ready' } });
    if (method === 'POST' && path.endsWith('/rows'))
      return ok({ success: true, data: handlers.rows?.(call) ?? { stored: body?.rows?.length ?? 0 } });
    if (method === 'GET' && path.includes('/rows')) {
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0);
      const limit = Number(/limit=(\d+)/.exec(path)?.[1] ?? 0);
      return ok(handlers.page?.(offset, limit));
    }
    if (method === 'GET' && path === '')
      return ok({ success: true, data: handlers.list?.() ?? [] });

    return { ok: false, status: 404, json: async () => ({ success: false, error: { message: 'no route', code: 'NOT_FOUND' } }) };
  });
};

const install = (server: ReturnType<typeof fakeServer>) => {
  vi.stubGlobal('fetch', server);
};

beforeEach(() => {
  calls = [];
  __resetLimitsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sample = (rows: number) =>
  makeDataset(
    Array.from({ length: rows }, (_, i) => ({ OrderID: `O${i}`, Amount: i })),
    [
      { name: 'OrderID', type: 'string' },
      { name: 'Amount', type: 'number' },
    ]
  );

const storedHeader = (overrides: Partial<StoredDataset> = {}): StoredDataset => ({
  id: 'ds-1',
  name: 'Sales',
  sourceName: 'sales.csv',
  status: 'ready',
  rowCount: 10,
  columns: [
    { name: 'OrderID', type: 'string' },
    { name: 'Amount', type: 'number' },
  ],
  byteSize: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('saving a dataset', () => {
  it('creates, sends rows in batches, then completes - in that order', async () => {
    install(fakeServer({}));
    await saveDataset(sample(25), 'tok');

    const sequence = calls.filter(call => !call.path.startsWith('/limits'));
    expect(sequence.map(call => `${call.method} ${call.path}`)).toEqual([
      'POST ',
      'POST /ds-1/rows',
      'POST /ds-1/rows',
      'POST /ds-1/rows',
      'POST /ds-1/complete',
    ]);
  });

  it('sizes batches to the limit the server publishes', async () => {
    // Not a hardcoded 5000. The server publishes /limits precisely so a client
    // does not have to guess, and a guess that is too big fails mid-upload.
    install(fakeServer({}));
    await saveDataset(sample(25), 'tok');

    const batches = calls.filter(call => call.path.endsWith('/rows') && call.method === 'POST');
    expect(batches.map(call => (call.body!.rows as unknown[]).length)).toEqual([10, 10, 5]);
    expect(batches.map(call => call.body!.startIndex)).toEqual([0, 10, 20]);
  });

  it('tells the server how many rows to expect, so a short upload is caught', async () => {
    install(fakeServer({}));
    await saveDataset(sample(25), 'tok');
    const complete = calls.find(call => call.path.endsWith('/complete'));
    expect(complete!.body).toEqual({ expectedRowCount: 25 });
  });

  it('stores only the name and type of each column', async () => {
    // The computed statistics are derived from the rows, so storing them
    // would mean storing something that can go stale against its own data.
    install(fakeServer({}));
    await saveDataset(sample(3), 'tok');
    const create = calls.find(call => call.method === 'POST' && call.path === '');
    expect(create!.body!.columns).toEqual([
      { name: 'OrderID', type: 'string' },
      { name: 'Amount', type: 'number' },
    ]);
  });

  it('sends an empty dataset as a header and a completion, with no batches', async () => {
    install(fakeServer({}));
    await saveDataset(sample(0), 'tok');
    expect(calls.some(call => call.path.endsWith('/rows'))).toBe(false);
    expect(calls.find(call => call.path.endsWith('/complete'))!.body).toEqual({
      expectedRowCount: 0,
    });
  });

  it('refuses before uploading anything when there are too many rows', async () => {
    install(fakeServer({ limits: () => ({ ...LIMITS, MAX_ROWS: 10 }) }));
    await expect(saveDataset(sample(11), 'tok')).rejects.toThrow(/at most/);
    expect(calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('carries the bearer token on every request', async () => {
    const server = fakeServer({});
    install(server);
    await saveDataset(sample(12), 'tok-abc');
    for (const [, init] of server.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer tok-abc',
      });
    }
  });

  it('surfaces the server message rather than a bare status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/limits')
          ? { ok: true, status: 200, json: async () => ({ success: true, data: LIMITS }) }
          : {
              ok: false,
              status: 413,
              json: async () => ({
                success: false,
                error: { code: 'PAYLOAD_TOO_LARGE', message: 'Batch too large.' },
              }),
            }
      )
    );
    await expect(saveDataset(sample(5), 'tok')).rejects.toThrow('Batch too large.');
  });

  it('falls back to a small batch size when limits cannot be read', async () => {
    // Guessing low costs a round trip; guessing high costs a 413 halfway
    // through a long upload.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).replace(/^.*\/api\/v1\/datasets/, '');
        if (path.startsWith('/limits')) throw new Error('offline');
        calls.push({
          method: (init?.method || 'GET').toUpperCase(),
          path,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'ds-1' } }) };
      })
    );

    const limits = await fetchLimits('tok');
    expect(limits.MAX_BATCH_ROWS).toBe(1000);
    expect(limits.MAX_BATCH_ROWS).toBeLessThan(5000);
  });
});

describe('loading a dataset', () => {
  const pageOf = (rows: Record<string, unknown>[], total: number) =>
    (offset: number, limit: number) => {
      const slice = rows.slice(offset, offset + limit);
      return {
        success: true,
        data: slice,
        meta: {
          offset,
          limit,
          returned: slice.length,
          rowCount: total,
          hasMore: offset + slice.length < total,
        },
      };
    };

  const tenRows = Array.from({ length: 10 }, (_, i) => ({ OrderID: `O${i}`, Amount: i }));

  it('pages until every row is in hand', async () => {
    install(fakeServer({ page: pageOf(tenRows, 10) }));
    const rows = await loadDatasetRows(storedHeader(), 'tok');

    expect(rows).toHaveLength(10);
    expect(rows).toEqual(tenRows);
    // MAX_PAGE_ROWS is 4, so 4 + 4 + 2.
    const pages = calls.filter(call => call.method === 'GET' && call.path.includes('/rows'));
    expect(pages).toHaveLength(3);
    expect(pages.map(call => /offset=(\d+)/.exec(call.path)![1])).toEqual(['0', '4', '8']);
  });

  it('reports progress as pages arrive', async () => {
    install(fakeServer({ page: pageOf(tenRows, 10) }));
    const seen: number[] = [];
    await loadDatasetRows(storedHeader(), 'tok', progress => seen.push(progress.loaded));
    expect(seen).toEqual([4, 8, 10]);
  });

  it('refuses a dataset that comes back short rather than returning it', async () => {
    // The whole point. A dataset ten rows short is not nearly right - every
    // total computed from it is wrong by exactly the amount nobody can see.
    const short = tenRows.slice(0, 6);
    install(fakeServer({ page: pageOf(short, 6) }));

    await expect(loadDatasetRows(storedHeader({ rowCount: 10 }), 'tok')).rejects.toThrow(
      /should have 10 rows but 6 came back/
    );
  });

  it('stops instead of spinning when a page is empty but claims more remain', async () => {
    // A server answering this way is broken, but a client that loops forever
    // on it hangs the tab, which is worse than a wrong answer.
    install(
      fakeServer({
        page: () => ({
          success: true,
          data: [],
          meta: { offset: 0, limit: 4, returned: 0, rowCount: 10, hasMore: true },
        }),
      })
    );

    await expect(loadDatasetRows(storedHeader({ rowCount: 10 }), 'tok')).rejects.toThrow(
      DatasetStoreError
    );
    expect(calls.filter(call => call.path.includes('/rows')).length).toBeLessThan(5);
  });

  it('loads an empty dataset without complaining', async () => {
    install(fakeServer({ page: pageOf([], 0) }));
    const rows = await loadDatasetRows(storedHeader({ rowCount: 0 }), 'tok');
    expect(rows).toEqual([]);
  });
});

describe('rebuilding the app Dataset', () => {
  it('recomputes statistics with the same function the upload path uses', async () => {
    const rows = [{ Amount: 0 }, { Amount: 10 }, { Amount: 5 }];
    const dataset = toDataset(
      storedHeader({ rowCount: 3, columns: [{ name: 'Amount', type: 'number' }] }),
      rows,
      analyzeColumn
    );

    const amount = dataset.columns[0];
    // A genuine zero has to survive the whole round trip, including the
    // minimum. This is the same confusion that made the Excel import turn
    // every zero into a blank.
    expect(amount.min).toBe(0);
    expect(amount.max).toBe(10);
    expect(amount.nullCount).toBe(0);
    expect(dataset.rowCount).toBe(3);
  });

  it('keeps the stored column type instead of re-detecting it', async () => {
    // A date column read back out of JSON and re-detected could be
    // reclassified as text, and every time-intelligence question the user
    // could ask of it would disappear.
    const rows = [{ When: '2024-01-15' }, { When: '2024-02-20' }];
    const dataset = toDataset(
      storedHeader({ rowCount: 2, columns: [{ name: 'When', type: 'date' }] }),
      rows,
      analyzeColumn
    );
    expect(dataset.columns[0].type).toBe('date');
    expect(dataset.dataTypes.When).toBe('date');
  });
});

describe('listing and deleting', () => {
  it('returns the stored headers', async () => {
    install(fakeServer({ list: () => [storedHeader(), storedHeader({ id: 'ds-2' })] }));
    const list = await listStoredDatasets('tok');
    expect(list.map(entry => entry.id)).toEqual(['ds-1', 'ds-2']);
  });

  it('survives a list response that is not an array', async () => {
    install(fakeServer({ list: () => null }));
    await expect(listStoredDatasets('tok')).resolves.toEqual([]);
  });

  it('deletes by id, url-encoded', async () => {
    install(fakeServer({}));
    await deleteStoredDataset('a b/c', 'tok');
    const removal = calls.find(call => call.method === 'DELETE');
    expect(removal!.path).toBe('/a%20b%2Fc');
  });
});
