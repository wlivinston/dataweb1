import { DaxRuntimeError } from './errors';
import { fromCell, type DaxScalar } from './value';
import { findTable, keyOf } from '../semantic/model';
import type { SemanticModel, SemanticTable } from '../semantic/types';

/**
 * Filter context, and what rows of a table it leaves visible.
 *
 * Two kinds of restriction are tracked separately because CALCULATE treats
 * them differently. A column filter is REPLACED when CALCULATE supplies a new
 * one for the same column - `CALCULATE(..., Sales[Region] = "Accra")` inside a
 * report already sliced to Kumasi returns Accra, not nothing. A row
 * restriction from FILTER() is set wholesale, and comes out right because
 * FILTER evaluates its table argument in the outer context first.
 *
 * Getting this backwards is the single easiest way to produce a confident
 * wrong number, which is why the two are not merged into one row set.
 */

export interface FilterContext {
  /**
   * Allowed key sets, nested table -> column -> keys, all lower-cased.
   *
   * Nested rather than keyed by a joined string: a composite key needs a
   * separator that cannot occur in a table or column name, and the obvious
   * choice puts a NUL byte in the source file, which makes git treat it as
   * binary. Nesting sidesteps the question and makes "every filter on this
   * table" a lookup rather than a prefix scan.
   */
  columns: Map<string, Map<string, Set<string>>>;
  /** Visible row indices per table, keyed by lower-cased table name. */
  rows: Map<string, number[]>;
  /**
   * Relationships switched on or off for this calculation, by id.
   *
   * USERELATIONSHIP activates an inactive relationship, which also means
   * deactivating whichever one was joining those two tables - otherwise a
   * filter could reach the same row by two routes and the answer would
   * depend on which was taken.
   */
  relationships: Map<string, boolean>;
}

/** One iterated row, as SUMX and friends establish. */
/** Iterating the rows of a model table, as SUMX(Sales, ...) does. */
export interface ModelRowContext {
  kind: 'row';
  table: string;
  rowIndex: number;
}

/** One column of a derived row, and the value it holds on this row. */
export interface DerivedBinding {
  name: string;
  /** The model column this came from, when it came from one. */
  origin?: { table: string; column: string };
  value: DaxScalar;
}

/**
 * Iterating a computed table, where a row is values rather than a position.
 *
 * ADDCOLUMNS(VALUES(Sales[Region]), ...) has no row of Sales to point at -
 * a region is not a row. So the row context carries the values, and on
 * context transition each binding that still knows its model column
 * narrows that column. That is what makes
 *
 *   ADDCOLUMNS(VALUES(Sales[Region]), "Avg", CALCULATE(AVERAGE(Sales[Amount])))
 *
 * compute an average per region rather than the same grand total on every
 * row - the same failure context transition was introduced to prevent for
 * SUMX.
 */
export interface DerivedRowContext {
  kind: 'derived';
  bindings: DerivedBinding[];
}

export type RowContext = ModelRowContext | DerivedRowContext;

export interface EvalContext {
  filter: FilterContext;
  /** Innermost row context last. */
  rowContexts: RowContext[];
}

const lower = (value: string): string => value.toLowerCase();

export const emptyFilterContext = (): FilterContext => ({
  columns: new Map(),
  rows: new Map(),
  relationships: new Map(),
});

export const emptyEvalContext = (): EvalContext => ({
  filter: emptyFilterContext(),
  rowContexts: [],
});

const cloneFilter = (context: FilterContext): FilterContext => ({
  columns: new Map(
    Array.from(context.columns, ([table, columns]) => [table, new Map(columns)])
  ),
  rows: new Map(context.rows),
  relationships: new Map(context.relationships),
});

/** Whether a relationship propagates filters, after any USERELATIONSHIP. */
export const isRelationshipActive = (
  context: FilterContext,
  relationship: { id: string; isActive: boolean }
): boolean => context.relationships.get(relationship.id) ?? relationship.isActive;

/**
 * Swap which relationship joins a pair of tables.
 *
 * Activates `wanted` and deactivates every other relationship between the
 * same two tables, so exactly one path stays open.
 */
export const withRelationshipSwapped = (
  context: FilterContext,
  wanted: { id: string; from: { table: string }; to: { table: string } },
  all: { id: string; from: { table: string }; to: { table: string } }[]
): FilterContext => {
  const next = cloneFilter(context);
  const pairOf = (r: { from: { table: string }; to: { table: string } }) =>
    [lower(r.from.table), lower(r.to.table)].sort().join('<->');
  const pair = pairOf(wanted);

  for (const relationship of all) {
    if (pairOf(relationship) !== pair) continue;
    next.relationships.set(relationship.id, relationship.id === wanted.id);
  }
  return next;
};

/** Replace any existing filter on this column, as a CALCULATE argument does. */
export const withColumnFilter = (
  context: FilterContext,
  table: string,
  column: string,
  allowed: Set<string>
): FilterContext => {
  const next = cloneFilter(context);
  const owner = next.columns.get(lower(table)) ?? new Map<string, Set<string>>();
  owner.set(lower(column), allowed);
  next.columns.set(lower(table), owner);
  return next;
};

/** Restrict a table to an explicit row set, as FILTER() does. */
export const withRowFilter = (
  context: FilterContext,
  table: string,
  rows: number[]
): FilterContext => {
  const next = cloneFilter(context);
  next.rows.set(lower(table), rows);
  return next;
};

/** ALL(Table): drop every filter placed directly on that table. */
export const withoutTable = (context: FilterContext, table: string): FilterContext => {
  const next = cloneFilter(context);
  next.rows.delete(lower(table));
  next.columns.delete(lower(table));
  return next;
};

/** ALL(Table[Column]): drop the filter on one column only. */
export const withoutColumn = (
  context: FilterContext,
  table: string,
  column: string
): FilterContext => {
  const next = cloneFilter(context);
  const owner = next.columns.get(lower(table));
  if (owner) {
    owner.delete(lower(column));
    if (owner.size === 0) next.columns.delete(lower(table));
  }
  return next;
};

/**
 * Intersect with whatever filter is already on this column.
 *
 * CALCULATE's filter arguments override the OUTER context but combine with
 * each other, so they are cleared first and then intersected in.
 */
export const andColumnFilter = (
  context: FilterContext,
  table: string,
  column: string,
  allowed: Set<string>
): FilterContext => {
  const existing = context.columns.get(lower(table))?.get(lower(column));
  if (!existing) return withColumnFilter(context, table, column, allowed);
  return withColumnFilter(
    context,
    table,
    column,
    new Set(Array.from(allowed).filter(key => existing.has(key)))
  );
};

/** Intersect with whatever row restriction is already on this table. */
export const andRowFilter = (
  context: FilterContext,
  table: string,
  rows: number[]
): FilterContext => {
  const existing = context.rows.get(lower(table));
  if (!existing) return withRowFilter(context, table, rows);
  const keep = new Set(rows);
  return withRowFilter(context, table, existing.filter(index => keep.has(index)));
};

/**
 * Pin a table to a single row.
 *
 * This is what CALCULATE's context transition does: inside SUMX, a CALCULATE
 * turns "the row being iterated" into a filter that the aggregation inside
 * can see. Without it, SUMX(Sales, CALCULATE(SUM(Sales[Amount]))) would
 * return the grand total on every row.
 */
export const withRowPinned = (
  context: FilterContext,
  table: string,
  rowIndex: number
): FilterContext =>
  // Clearing first matters as much as pinning. Context transition filters by
  // the WHOLE row, replacing whatever filtered that table before; leaving the
  // old column filters to intersect makes RANKX(ALL(Customers), [Measure])
  // blank out every customer except the one already in scope, and the rank
  // comes back as 1 for everybody.
  withRowFilter(withoutTable(context, table), table, [rowIndex]);

const requireTable = (model: SemanticModel, name: string): SemanticTable => {
  const table = findTable(model, name);
  if (!table) {
    const names = model.tables.map(t => t.name).join(', ');
    throw new DaxRuntimeError(`There is no table called "${name}". Available: ${names}.`);
  }
  return table;
};

/** Memo for one evaluation; filter contexts are immutable so this is safe. */
export interface VisibilityCache {
  byContext: Map<FilterContext, Map<string, number[]>>;
}

export const createVisibilityCache = (): VisibilityCache => ({ byContext: new Map() });

const allRowIndices = (table: SemanticTable): number[] =>
  Array.from({ length: table.rowCount }, (_, i) => i);

/**
 * The rows of `tableName` visible under `context`.
 *
 * Direct filters apply first, then filters propagate along active
 * relationships from the one side to the many side - and transitively, so a
 * filter on a region dimension reaches the fact table through the customer
 * dimension between them.
 */
/**
 * Stands for a blank value inside a column filter's allowed set.
 *
 * Filters are held as sets of `keyOf` strings, and keyOf returns null for a
 * blank - so before this existed, a blank cell could never satisfy a filter
 * no matter what the filter said. CALCULATE(..., Sales[Region] <> "North")
 * quietly dropped every row with no region, because BLANK <> "North" is TRUE
 * in DAX but the row had no key to match on. Power BI returns 4000 for the
 * parity fixture; this engine returned 3800.
 *
 * The surrounding spaces are what make it safe: keyOf trims, so no real
 * value can ever produce a key with leading or trailing whitespace, and the
 * sentinel cannot collide with a cell that literally reads "(blank)".
 */
export const BLANK_KEY = ' (blank) ';

export const visibleRows = (
  model: SemanticModel,
  tableName: string,
  context: FilterContext,
  cache: VisibilityCache = createVisibilityCache(),
  visiting: Set<string> = new Set()
): number[] => {
  const table = requireTable(model, tableName);
  const key = lower(table.name);

  let perContext = cache.byContext.get(context);
  if (!perContext) {
    perContext = new Map();
    cache.byContext.set(context, perContext);
  }
  const memoised = perContext.get(key);
  if (memoised) return memoised;

  // A relationship cycle would otherwise recurse forever. The model
  // deactivates duplicate paths, but a user-defined model may still loop.
  if (visiting.has(key)) return allRowIndices(table);
  visiting.add(key);

  try {
    let rows = context.rows.get(key) ?? allRowIndices(table);

    const columnFilters = context.columns.get(key);
    if (columnFilters) {
      for (const [columnName, allowed] of columnFilters) {
        const actual = table.columns.find(c => lower(c.name) === columnName);
        if (!actual) continue;
        rows = rows.filter(index => {
          const cellKey = keyOf(table.rows[index][actual.name]);
          // A blank is a value a filter can legitimately admit, so it is
          // matched through the sentinel rather than discarded.
          return allowed.has(cellKey === null ? BLANK_KEY : cellKey);
        });
      }
    }

    for (const relationship of model.relationships) {
      if (!isRelationshipActive(context, relationship)) continue;

      // Filters travel from the one side into the many side. A bidirectional
      // relationship also carries them back.
      const incoming =
        lower(relationship.from.table) === key
          ? { near: relationship.from, far: relationship.to }
          : relationship.crossFilter === 'both' && lower(relationship.to.table) === key
            ? { near: relationship.to, far: relationship.from }
            : null;
      if (!incoming) continue;

      const farTable = findTable(model, incoming.far.table);
      if (!farTable) continue;

      const farRows = visibleRows(model, farTable.name, context, cache, visiting);
      if (farRows.length === farTable.rowCount) continue; // Nothing to propagate.

      const allowed = new Set<string>();
      for (const index of farRows) {
        const cellKey = keyOf(farTable.rows[index][incoming.far.column]);
        if (cellKey !== null) allowed.add(cellKey);
      }

      rows = rows.filter(index => {
        const cellKey = keyOf(table.rows[index][incoming.near.column]);
        return cellKey !== null && allowed.has(cellKey);
      });
    }

    perContext.set(key, rows);
    return rows;
  } finally {
    visiting.delete(key);
  }
};

/** Read one cell as a DAX scalar. */
export const cellValue = (
  model: SemanticModel,
  tableName: string,
  columnName: string,
  rowIndex: number
): DaxScalar => {
  const table = requireTable(model, tableName);
  const column = table.columns.find(c => lower(c.name) === lower(columnName));
  if (!column) {
    const names = table.columns.map(c => c.name).join(', ');
    throw new DaxRuntimeError(
      `"${table.name}" has no column called "${columnName}". Available: ${names}.`
    );
  }
  const row = table.rows[rowIndex];
  return row ? fromCell(row[column.name]) : null;
};

/** The distinct keys of a column across a set of rows. */
export const distinctKeysOf = (
  model: SemanticModel,
  tableName: string,
  columnName: string,
  rows: number[]
): Set<string> => {
  const table = requireTable(model, tableName);
  const keys = new Set<string>();
  for (const index of rows) {
    const cellKey = keyOf(table.rows[index][columnName]);
    if (cellKey !== null) keys.add(cellKey);
  }
  return keys;
};
