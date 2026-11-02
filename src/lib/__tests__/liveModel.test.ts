import { describe, it, expect, vi } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { createModelCache } from '../semantic/liveModel';
import { answerQuestion } from '../nlq';
import { updateDatasetStats } from '../dataUtils';
import type { SemanticModel } from '../semantic/types';
import type { Dataset } from '../types';

/**
 * What reaches Ask Data after the data changes.
 *
 * The engine was right and the chat still answered wrongly: it was handed a
 * model built at the last analysis run, and editing, cleaning or deleting
 * data did not run one. These tests ask the chat's question through the same
 * path the screen uses - datasets in, model out, answerQuestion - after each
 * kind of change the UI can make.
 */

const sales = (amounts: number[], overrides: Partial<Dataset> = {}): Dataset =>
  makeDataset(
    amounts.map(Amount => ({ Amount })),
    [{ name: 'Amount', type: 'number' }],
    { id: 'ds-sales', name: 'Sales', ...overrides }
  );

const totalOf = (model: SemanticModel | null): string => {
  const answer = answerQuestion('What is the total amount?', model);
  if (!answer.ok) throw new Error(`refused: ${answer.reason}`);
  if (answer.shape !== 'scalar') throw new Error('expected one figure');
  return answer.formatted;
};

/** Edit one cell the way DataExplorer does: a new data array, stats recomputed. */
const editCell = (dataset: Dataset, rowIndex: number, column: string, value: unknown): Dataset => {
  const data = [...dataset.data];
  data[rowIndex] = { ...data[rowIndex], [column]: value };
  return updateDatasetStats({ ...dataset, data });
};

/** Delete one row the way the page's onDeleteRow does. */
const deleteRow = (dataset: Dataset, rowIndex: number): Dataset =>
  updateDatasetStats({ ...dataset, data: dataset.data.filter((_, i) => i !== rowIndex) });

describe('the model the chat answers from follows the data', () => {
  it('a cell edit changes the answer', () => {
    const modelFor = createModelCache();
    const before = sales([10, 20, 30]);
    expect(totalOf(modelFor([before]))).toBe(totalOf(buildSemanticModel([before])));

    const after = editCell(before, 0, 'Amount', 100);
    // The stale-model failure answered 60 here.
    expect(totalOf(modelFor([after]))).toBe(totalOf(buildSemanticModel([after])));
    expect(totalOf(modelFor([after]))).not.toBe(totalOf(modelFor([before])));
  });

  it('an edit that keeps the row count and the timestamp still rebuilds', () => {
    // The old signature was id:rowCount:columnCount:updatedAt. Two builds in
    // the same millisecond, or a cleaning step that does not stamp updatedAt,
    // passed it with different numbers underneath.
    const modelFor = createModelCache();
    const stamp = new Date('2026-01-01T00:00:00Z');
    const before = sales([10, 20, 30], { updatedAt: stamp });
    const after: Dataset = {
      ...before,
      data: before.data.map((row, i) => (i === 0 ? { Amount: 100 } : row)),
      updatedAt: stamp,
    };
    expect(after.rowCount).toBe(before.rowCount);

    modelFor([before]);
    expect(totalOf(modelFor([after]))).toBe(totalOf(buildSemanticModel([after])));
  });

  it('a deleted row leaves the answer', () => {
    const modelFor = createModelCache();
    const before = sales([10, 20, 30]);
    modelFor([before]);
    const after = deleteRow(before, 2);
    expect(totalOf(modelFor([after]))).toBe(totalOf(buildSemanticModel([after])));
  });

  it('a removed dataset leaves the model', () => {
    // The pipeline re-ran only when the dataset count went UP, so a removed
    // table stayed queryable in the chat.
    const modelFor = createModelCache();
    const first = sales([10, 20, 30]);
    const second = makeDataset(
      [{ Region: 'North', Target: 5 }],
      [{ name: 'Region', type: 'string' }, { name: 'Target', type: 'number' }],
      { id: 'ds-targets', name: 'Targets' }
    );

    const both = modelFor([first, second]);
    expect(both?.tables.map(t => t.name)).toEqual(['Sales', 'Targets']);

    const one = modelFor([first]);
    expect(one?.tables.map(t => t.name)).toEqual(['Sales']);
  });

  it('removing every dataset leaves no model, so the chat says so instead of answering', () => {
    const modelFor = createModelCache();
    modelFor([sales([10, 20, 30])]);
    expect(modelFor([])).toBeNull();
    expect(answerQuestion('What is the total amount?', modelFor([])).ok).toBe(false);
  });

  it('a renamed dataset is a different table name', () => {
    const modelFor = createModelCache();
    const before = sales([10, 20, 30]);
    modelFor([before]);
    const renamed = { ...before, name: 'Revenue' };
    expect(modelFor([renamed])?.tables.map(t => t.name)).toEqual(['Revenue']);
  });
});

describe('the model is built once per change, not once per caller', () => {
  it('unchanged datasets return the same model without rebuilding', () => {
    const build = vi.fn(buildSemanticModel);
    const modelFor = createModelCache(build);
    const data = sales([10, 20, 30]);

    const first = modelFor([data]);
    // A new array around the same datasets is what setDatasets(prev => ...)
    // produces when nothing in them changed, and what the pipeline passes.
    const second = modelFor([...[data]]);
    expect(second).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('a change rebuilds exactly once', () => {
    const build = vi.fn(buildSemanticModel);
    const modelFor = createModelCache(build);
    const before = sales([10, 20, 30]);
    modelFor([before]);
    const after = editCell(before, 1, 'Amount', 0);
    modelFor([after]);
    modelFor([after]);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
