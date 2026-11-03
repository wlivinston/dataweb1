// Questions answered on the server, for saved datasets too large to load here.
//
// The browser restores saved datasets only up to RESTORE_ROW_BUDGET rows; a
// larger one used to be listed as "too large to load automatically" and was
// then unusable. POST /api/v1/analytics/query runs the same engine as this
// page (backend/engine/engine.cjs, built from src/lib/engine and checked
// against it), so an answer from the server is the answer this page would
// have given with the rows in memory.

import { getApiUrl } from './publicConfig';
import type { NlqAnswer } from './nlq';

export interface ServerAnswerMeta {
  rows: number;
  modelCached: boolean;
  timingMs: { load: number; build: number; evaluate: number };
}

export interface ServerAnswer {
  answer: NlqAnswer;
  meta: ServerAnswerMeta;
}

export class ServerAnalyticsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ServerAnalyticsError';
    this.status = status;
  }
}

/** A user-facing reason for a failed request, never a raw status code. */
export const describeServerFailure = (status: number, serverMessage?: string): string => {
  if (serverMessage && status !== 500 && status !== 502 && status !== 503 && status !== 504) return serverMessage;
  if (status === 504 || status === 408) {
    return 'The server took too long to answer over this much data. Try a narrower question, or try again in a moment.';
  }
  if (status === 401) return 'Sign in again to ask about your saved datasets.';
  if (status === 0) return 'The server could not be reached. Check your connection and try again.';
  return 'The server could not answer just now. Try again in a moment.';
};

/** Ask a plain-English question over saved datasets, on the server. */
export const askServer = async (
  datasetIds: string[],
  question: string,
  token: string
): Promise<ServerAnswer> => {
  let response: Response;
  try {
    response = await fetch(getApiUrl('/api/v1/analytics/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ datasetIds, question }),
    });
  } catch {
    throw new ServerAnalyticsError(describeServerFailure(0), 0);
  }

  let payload: {
    success?: boolean;
    data?: { kind?: string; answer?: NlqAnswer };
    meta?: ServerAnswerMeta;
    error?: { message?: string };
  } | null = null;
  try {
    payload = await response.json();
  } catch {
    throw new ServerAnalyticsError(describeServerFailure(response.status), response.status);
  }

  if (!response.ok || payload?.success === false || !payload?.data?.answer || !payload.meta) {
    throw new ServerAnalyticsError(
      describeServerFailure(response.status, payload?.error?.message),
      response.status
    );
  }
  return { answer: payload.data.answer, meta: payload.meta };
};
