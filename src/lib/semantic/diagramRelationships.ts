// The relationships the diagram draws and the analysis pipeline joins on.
//
// These used to come straight from the schema detector's candidate list, a
// different rule from the one the engine applies. The detector proposes any
// two columns that share values; the engine then keeps a candidate only when
// it can be oriented, its keys actually match (integrity), and it is the one
// active path between its two tables. Skipping those checks put links on the
// diagram that the engine had rejected - participants.followup_score to
// sessions.minutes, because 30, 45, 60 and 90 appear in both - and the
// pipeline then joined the tables on them.
//
// Same lesson as filter direction (`relationshipsFrom`): one rule, called
// from every place that needs it, so the picture and the numbers cannot drift.

import type { Relationship } from '@/lib/types';
import type { SemanticModel, SemanticRelationship } from './types';
import { keyOf } from './model';

const TYPE: Record<SemanticRelationship['cardinality'], Relationship['type']> = {
  oneToMany: 'one-to-many',
  oneToOne: 'one-to-one',
  manyToMany: 'many-to-many',
};

/**
 * The model's active relationships between uploaded datasets, in the shape
 * the diagram and pipeline use. `from` is the many side, `to` the one side,
 * as in the model. The generated date table is not a dataset and is left out.
 */
export const diagramRelationships = (
  model: SemanticModel | null,
  idPrefix = 'auto-rel'
): Relationship[] => {
  if (!model) return [];
  const tables = new Map(model.tables.map(table => [table.name, table]));
  const result: Relationship[] = [];

  model.relationships.forEach((relationship, index) => {
    if (!relationship.isActive) return;
    const from = tables.get(relationship.from.table);
    const to = tables.get(relationship.to.table);
    if (!from || !to || from.isGenerated || to.isGenerated) return;

    result.push({
      id: `${idPrefix}-${index}-${from.datasetId}-${to.datasetId}`,
      fromDataset: from.datasetId,
      toDataset: to.datasetId,
      fromColumn: relationship.from.column,
      toColumn: relationship.to.column,
      type: TYPE[relationship.cardinality],
      confidence: relationship.confidence,
      isFactTable: from.role === 'fact',
      isDimensionTable: to.role === 'dimension',
    });
  });

  return result;
};

/**
 * Copy the one-side columns of `relationship` onto each base row, for the
 * chart pipeline's flattened view.
 *
 * Only a lookup: every base row comes out exactly once. The join this
 * replaces emitted a copy of the base row per match, so joining participants
 * to their sessions repeated each participant once per session and every
 * participant figure in the charts was counted two or three times - the
 * fan-out the semantic model was built to avoid. A many-to-many link, or a
 * key that matches more than one row, adds nothing rather than multiply.
 * Keys compare the way the model compares them (trimmed, case-insensitive).
 */
export const lookupJoin = (
  baseRows: readonly Record<string, unknown>[],
  relatedRows: readonly Record<string, unknown>[],
  relationship: Pick<Relationship, 'fromColumn' | 'toColumn' | 'type'>
): Record<string, unknown>[] => {
  if (relationship.type === 'many-to-many') return [...baseRows];

  const byKey = new Map<string, Record<string, unknown> | null>();
  for (const row of relatedRows) {
    const key = keyOf(row[relationship.toColumn]);
    if (key === null) continue;
    // A second row with the same key makes the lookup ambiguous: mark it.
    byKey.set(key, byKey.has(key) ? null : row);
  }

  return baseRows.map(row => {
    const key = keyOf(row[relationship.fromColumn]);
    const match = key === null ? undefined : byKey.get(key);
    // Base values win a name clash: the row being charted keeps its own data.
    return match ? { ...match, ...row } : row;
  });
};
