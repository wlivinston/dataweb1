import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// @ts-expect-error - plain .mjs build script, no types
import { bundleEngine, ENGINE_BUNDLE_PATH } from '../../../scripts/build-engine.mjs';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { answerQuestion } from '../nlq';
import { datasetFromStore } from '../engine';
import { loadCsvDataset, loadOrders, loadCustomers } from './fixtures/powerbi/load';
import { PARITY_CASES, type ParityCase } from './fixtures/powerbi/expected';
import { GROUPING_CASES } from './fixtures/powerbi/grouping-expected';
import { TABLE_CASES } from './fixtures/powerbi/table-expected';
import { BLANK_CASES } from './fixtures/powerbi/blank-expected';
import { FILTER_CASES } from './fixtures/powerbi/filter-expected';
import { CROSSTABLE_CASES } from './fixtures/powerbi/crosstable-expected';

/**
 * The server runs the browser's engine - provably.
 *
 * The backend requires backend/engine/engine.cjs, a bundle of src/lib/engine.
 * docs/server-side-compute-decision.md rejected a second implementation (DAX
 * translated to SQL) because it would have to agree with the first forever;
 * a stale or hand-edited bundle would be the same failure by accident. So:
 *
 *  1. the committed bundle must equal a fresh build of the source, and
 *  2. every Power BI parity case - the judgement calls the engine is checked
 *     on - must give the identical result through the bundle and the source.
 */

const require = createRequire(import.meta.url);
const bundled = require(ENGINE_BUNDLE_PATH) as typeof import('../engine');

describe('the committed engine bundle', () => {
  it('is a fresh build of src/lib/engine (run `npm run build:engine` if this fails)', async () => {
    const committed = readFileSync(ENGINE_BUNDLE_PATH, 'utf8');
    expect(committed === (await bundleEngine())).toBe(true);
  });
});

const salesTypes = { OrderID: 'string', Date: 'date', Region: 'string', Product: 'string', Amount: 'number' } as const;
const sales = () => [loadCsvDataset('sales.csv', { id: 'ds-powerbi-sales', name: 'Sales', types: { ...salesTypes } })];
const ordersAndCustomers = () => [loadOrders(), loadCustomers()];

const sheets: Array<[string, ParityCase[], () => ReturnType<typeof sales>]> = [
  ['DAX semantics', PARITY_CASES, sales],
  ['grouping', GROUPING_CASES, sales],
  ['table', TABLE_CASES, sales],
  ['blank', BLANK_CASES, sales],
  ['filter', FILTER_CASES, sales],
  ['cross-table', CROSSTABLE_CASES, ordersAndCustomers],
];

describe.each(sheets)('the %s parity sheet through the server bundle', (_name, cases, datasets) => {
  const sourceModel = buildSemanticModel(datasets());
  const bundleModel = bundled.buildSemanticModel(datasets());

  it.each(cases.map(c => [c.id, c.engineDax ?? c.dax] as const))('%s', (_id, dax) => {
    const viaSource = runDax(dax, sourceModel);
    const viaBundle = bundled.runDax(dax, bundleModel);
    expect(JSON.stringify(viaBundle)).toBe(JSON.stringify(viaSource));
  });
});

describe('plain-English questions through the server bundle', () => {
  const sourceModel = buildSemanticModel(sales());
  const bundleModel = bundled.buildSemanticModel(sales());
  it.each([
    'total Amount by Region',
    'average Amount',
    'top 2 Product by Amount',
    'how many rows are there in Sales?',
    'what is the colour of the sky?',
  ])('%s', question => {
    expect(JSON.stringify(bundled.answerQuestion(question, bundleModel)))
      .toBe(JSON.stringify(answerQuestion(question, sourceModel)));
  });
});

describe('a stored dataset becomes the same Dataset on both sides', () => {
  it('datasetFromStore matches the browser reload path', () => {
    const stored = {
      id: 'd1', name: 'Sales', sourceName: 'sales.csv', status: 'ready' as const, rowCount: 2,
      columns: [{ name: 'Region', type: 'string' as const }, { name: 'Amount', type: 'number' as const }],
      byteSize: 0, createdAt: null, updatedAt: null,
    };
    const rows = [{ Region: 'North', Amount: 10 }, { Region: ' north ', Amount: '' }];
    expect(JSON.stringify(bundled.datasetFromStore(stored, rows))).toBe(JSON.stringify(datasetFromStore(stored, rows)));
  });
});
