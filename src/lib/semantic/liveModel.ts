// The semantic model for the data as it stands right now.
//
// Ask Data, the measure library and the DAX calculator all answer from a
// model. That model used to be held in component state and rebuilt only when
// an analysis pipeline ran - on upload, or on "Apply & Analyze". Editing a
// cell, deleting a row, cleaning a dataset or removing one did not run a
// pipeline, so the chat went on answering from rows that were no longer on
// screen: a correct engine, given the wrong data.
//
// The model is a snapshot, so the fix is not to patch it on every edit but to
// know when it no longer describes its inputs. Edits in this app replace a
// dataset's `data` array (and `updateDatasetStats` its `columns`) rather than
// mutating them, so reference identity is an exact staleness test - stronger
// than the old id/rowCount/updatedAt signature, which an edit that kept the
// row count and landed in the same millisecond as the last build could pass.

import type { Dataset } from '@/lib/types';
import type { SemanticModel } from './types';
import { buildSemanticModel } from './model';

/** The parts of a dataset the model is built from. */
interface ModelInput {
  id: string;
  name: string;
  data: unknown[];
  columns: Dataset['columns'];
}

const inputOf = (dataset: Dataset): ModelInput => ({
  id: dataset.id,
  name: dataset.name,
  data: dataset.data,
  columns: dataset.columns,
});

/**
 * Whether a model built from `previous` still describes `datasets`.
 *
 * Order matters: table names are deduplicated in input order, so swapping two
 * datasets with clashing names changes which one gets the suffix.
 */
export const sameModelInputs = (previous: readonly ModelInput[], datasets: readonly Dataset[]): boolean =>
  previous.length === datasets.length &&
  previous.every((input, index) => {
    const dataset = datasets[index];
    return (
      input.id === dataset.id &&
      input.name === dataset.name &&
      input.data === dataset.data &&
      input.columns === dataset.columns
    );
  });

export type ModelFor = (datasets: readonly Dataset[]) => SemanticModel | null;

/**
 * A function returning the model for a set of datasets, building it only when
 * they differ from the last call. Building costs a pass over the rows
 * (relationship orientation is measured from the data), so the UI and the
 * analysis pipeline share one of these and the work is done once per change.
 */
export const createModelCache = (
  build: (datasets: Dataset[]) => SemanticModel = buildSemanticModel
): ModelFor => {
  let inputs: ModelInput[] | null = null;
  let model: SemanticModel | null = null;

  return datasets => {
    if (datasets.length === 0) {
      inputs = [];
      model = null;
      return null;
    }
    if (inputs && sameModelInputs(inputs, datasets)) return model;
    model = build([...datasets]);
    inputs = datasets.map(inputOf);
    return model;
  };
};
