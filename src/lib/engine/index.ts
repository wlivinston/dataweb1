// The engine's public surface for the server.
//
// Bundled by `npm run build:engine` into backend/engine/engine.cjs, which the
// backend requires. The backend is plain CommonJS with no build step, so the
// bundle is committed - and engineBundle.test.ts rebuilds it from this source
// and fails if the committed file differs. The server therefore runs the same
// source as the browser, never a copy that can drift: one implementation of
// the semantics the Power BI parity sheets verify (docs/server-side-compute-decision.md).
//
// Keep this surface small. Anything exported here is a contract the backend
// depends on; anything not exported is free to change.

import { analyzeColumn } from '@/lib/dataUtils';
import { toDataset, type StoredDataset } from '@/lib/storedDataset';
import type { Dataset } from '@/lib/types';

export { buildSemanticModel } from '@/lib/semantic/model';
export { runDax, formatDaxValue } from '@/lib/dax/run';
export { answerQuestion } from '@/lib/nlq';
export type { StoredDataset } from '@/lib/storedDataset';

/**
 * A stored dataset and its rows as the engine's Dataset - through the same
 * `toDataset` and `analyzeColumn` the browser uses when it reloads one.
 */
export const datasetFromStore = (stored: StoredDataset, rows: Record<string, unknown>[]): Dataset =>
  toDataset(stored, rows, analyzeColumn);
