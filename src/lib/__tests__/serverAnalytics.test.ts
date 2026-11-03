import { describe, it, expect, vi, afterEach } from 'vitest';
import { askServer, describeServerFailure, ServerAnalyticsError } from '../serverAnalytics';

/**
 * The client for questions answered on the server. Whatever goes wrong, the
 * user gets a reason in words - never a status code, never a number.
 */

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  );

afterEach(() => vi.restoreAllMocks());

describe('askServer', () => {
  it('returns the answer and the meta', async () => {
    const answer = { ok: true, shape: 'scalar', question: 'q', dax: 'SUM(T[A])', value: 3, formatted: '3', interpretation: 'i' };
    const meta = { rows: 600000, modelCached: false, timingMs: { load: 1200, build: 900, evaluate: 50 } };
    const fetchMock = respond(200, { success: true, data: { kind: 'question', answer }, meta });
    await expect(askServer(['d1'], 'total A', 'token')).resolves.toEqual({ answer, meta });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/analytics\/query$/);
    expect(JSON.parse(String(init?.body))).toEqual({ datasetIds: ['d1'], question: 'total A' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it("passes on the server's own reason for a refusal", async () => {
    respond(409, { success: false, error: { message: '"Sales" is still being uploaded and cannot be queried yet.' } });
    await expect(askServer(['d1'], 'q', 't')).rejects.toThrow('"Sales" is still being uploaded');
  });

  it('turns a timeout into words', async () => {
    respond(504, 'An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT');
    await expect(askServer(['d1'], 'q', 't')).rejects.toThrow(/took too long/);
  });

  it('turns a network failure into words', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await askServer(['d1'], 'q', 't').catch(e => e);
    expect(error).toBeInstanceOf(ServerAnalyticsError);
    expect(error.message).toMatch(/could not be reached/);
  });

  it('never shows an internal server error message verbatim', () => {
    expect(describeServerFailure(500, 'TypeError: Cannot read properties of undefined')).not.toMatch(/TypeError/);
  });
});
