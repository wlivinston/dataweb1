import type { SemanticModel, SemanticRelationship } from './types';
import { relationshipsFrom } from './model';

/**
 * Whether a filter placed on one table reaches another.
 *
 * Grouping a figure in one table by a column of another is only meaningful if
 * filtering the grouping table narrows the measure's table. When it does not,
 * every group receives the SAME number - the grand total - and the result
 * looks like an ordinary breakdown while meaning nothing at all. That is a
 * worse failure than a refusal, because nothing about it looks wrong.
 *
 * Direction is the whole question. A filter travels from the ONE side of a
 * relationship into the MANY side: a customer dimension narrows an orders
 * fact, and an orders fact leaves the customer dimension whole. So
 * "Amount by Region" works (Customers narrows Sales) while
 * "Credit Limit by Product" does not (Sales cannot narrow Customers), and
 * the second would quietly print the same credit limit against every product.
 *
 * This mirrors `visibleRows` in dax/context.ts, read in the opposite
 * direction: that function walks inward from the table being read, this one
 * walks outward from the table being filtered. The edge rule is shared
 * through `relationshipsFrom`, so the two cannot drift apart - if they did,
 * the NLQ layer would permit questions the engine answers with a constant.
 */

/** A route a filter can take, shortest first. */
export interface PropagationPath {
  /** Table names from the filtering table to the receiving one, inclusive. */
  tables: string[];
  /** The relationships crossed, in the order they are crossed. */
  relationships: SemanticRelationship[];
  /**
   * True when a hop only works because the relationship filters both ways.
   *
   * Worth surfacing: a bidirectional relationship is the one kind of hop
   * whose result changes if somebody later sets it back to single, and in a
   * model with several it can also make a figure ambiguous.
   */
  usesBidirectional: boolean;
}

const lower = (value: string): string => value.trim().toLowerCase();

/**
 * The far end of a relationship, seen from `table`.
 *
 * Deliberately does NOT re-check the direction. `relationshipsFrom` has
 * already decided which relationships carry a filter out of this table, and
 * the first version of this function repeated that rule here - which meant
 * two copies that could disagree, and a mutation test that removed the copy
 * here changed nothing at all. One rule, in the function the engine shares.
 */
const receiverOf = (relationship: SemanticRelationship, table: string): string =>
  lower(relationship.to.table) === lower(table)
    ? relationship.from.table
    : relationship.to.table;

/** Whether this hop only works because the relationship filters both ways. */
const hopNeedsBidirectional = (
  relationship: SemanticRelationship,
  table: string
): boolean => lower(relationship.to.table) !== lower(table);

/**
 * The shortest route by which a filter on `fromTable` reaches `toTable`, or
 * null if it never does.
 *
 * Shortest rather than any: the path is shown to the user to justify a number
 * that crossed a join, and the fewest hops is the simplest true explanation.
 * Breadth-first, so the first route found is the shortest; `seen` also makes
 * a relationship cycle terminate rather than recurse.
 */
export const propagationPath = (
  model: SemanticModel,
  fromTable: string,
  toTable: string
): PropagationPath | null => {
  const target = lower(toTable);
  if (lower(fromTable) === target) {
    return { tables: [fromTable], relationships: [], usesBidirectional: false };
  }

  const seen = new Set<string>([lower(fromTable)]);
  const queue: PropagationPath[] = [
    { tables: [fromTable], relationships: [], usesBidirectional: false },
  ];

  while (queue.length > 0) {
    const path = queue.shift()!;
    const head = path.tables[path.tables.length - 1];

    for (const relationship of relationshipsFrom(model, head)) {
      const receiver = receiverOf(relationship, head);
      if (seen.has(lower(receiver))) continue;
      seen.add(lower(receiver));

      const next: PropagationPath = {
        tables: [...path.tables, receiver],
        relationships: [...path.relationships, relationship],
        usesBidirectional:
          path.usesBidirectional || hopNeedsBidirectional(relationship, head),
      };

      if (lower(receiver) === target) return next;
      queue.push(next);
    }
  }

  return null;
};

/** Whether a filter on `fromTable` narrows `toTable` at all. */
export const filterReaches = (
  model: SemanticModel,
  fromTable: string,
  toTable: string
): boolean => propagationPath(model, fromTable, toTable) !== null;

/** A path written out for a person, e.g. `Customers -> Sales`. */
export const describePath = (path: PropagationPath): string => path.tables.join(' → ');

/**
 * The join columns of each hop, e.g. `Sales[CustomerID] = Customers[CustomerID]`.
 *
 * Shown rather than just the table names because two tables can be joinable
 * on more than one column, and which one was used changes the answer.
 */
export const describeJoins = (path: PropagationPath): string =>
  path.relationships
    .map(
      relationship =>
        `${relationship.from.table}[${relationship.from.column}] = ` +
        `${relationship.to.table}[${relationship.to.column}]`
    )
    .join(', ');
