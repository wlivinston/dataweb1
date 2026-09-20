import { DaxRuntimeError } from './errors';

/**
 * DAX values and the coercion rules that go with them.
 *
 * Several of these rules are surprising. BLANK() = 0 is TRUE in DAX, and so
 * is BLANK() = "". They are reproduced here rather than corrected, because
 * the point of this engine is to agree with Power BI: a user who checks our
 * number against theirs and finds a difference has found a bug, whichever of
 * us is more defensible in the abstract.
 *
 * Where a rule is reproduced from documentation rather than from observed
 * Power BI behaviour, the comment says so.
 */

/** BLANK is represented as null. undefined never appears in a DaxValue. */
export type DaxScalar = number | string | boolean | null;

/**
 * A set of rows of one model table, held as indices into that table.
 *
 * Cheap, and it is what filtering wants: a filter is a narrowing of rows
 * that already exist. Every table function that only ever selects - FILTER,
 * ALL, CALCULATETABLE, TOPN - produces one of these.
 */
export interface DaxRowSet {
  kind: 'table';
  source: 'rows';
  table: string;
  rows: number[];
}

/**
 * One column of a derived table.
 *
 * `origin` records the model column a value came from. DAX calls this data
 * lineage, and it is what makes a derived table usable as a CALCULATE
 * filter: a column that still knows it came from Sales[Region] filters
 * Sales[Region], while a computed column filters nothing. Recorded from the
 * start even though filtering by derived tables is refused for now, because
 * a lineage that was never captured cannot be recovered later.
 */
export interface DerivedColumn {
  name: string;
  origin?: { table: string; column: string };
}

/**
 * A table whose columns are computed rather than selected.
 *
 * ADDCOLUMNS, SUMMARIZE and VALUES(column) all produce columns that exist in
 * no model table, so they cannot be expressed as row indices. That is the
 * single reason every table-shaping function in the registry was catalogued
 * but unimplemented.
 */
export interface DaxDerivedTable {
  kind: 'table';
  source: 'derived';
  columns: DerivedColumn[];
  /** Row-major, each row the same length as `columns`. */
  rows: DaxScalar[][];
}

export type DaxTable = DaxRowSet | DaxDerivedTable;

export type DaxValue = DaxScalar | DaxTable;

export const isRowSet = (value: DaxTable): value is DaxRowSet => value.source === 'rows';

export const isDerived = (value: DaxTable): value is DaxDerivedTable =>
  value.source === 'derived';

export const BLANK: null = null;

export const isBlank = (value: DaxValue): value is null => value === null;

export const isTable = (value: DaxValue): value is DaxTable =>
  typeof value === 'object' && value !== null && (value as DaxTable).kind === 'table';

export const isScalar = (value: DaxValue): value is DaxScalar => !isTable(value);

export const makeTable = (table: string, rows: number[]): DaxRowSet => ({
  kind: 'table',
  source: 'rows',
  table,
  rows,
});

export const makeDerivedTable = (
  columns: DerivedColumn[],
  rows: DaxScalar[][]
): DaxDerivedTable => ({
  kind: 'table',
  source: 'derived',
  columns,
  rows,
});

const describe = (value: DaxValue): string => {
  if (isTable(value)) {
    return isRowSet(value)
      ? `a table (${value.table})`
      : `a table of ${value.columns.length} computed ${value.columns.length === 1 ? 'column' : 'columns'}`;
  }
  if (value === null) return 'a blank';
  return `${typeof value} "${value}"`;
};

export const expectScalar = (value: DaxValue, what: string): DaxScalar => {
  if (isTable(value)) {
    throw new DaxRuntimeError(`${what} needs a single value but received ${describe(value)}.`);
  }
  return value;
};

export const expectTable = (value: DaxValue, what: string): DaxTable => {
  if (!isTable(value)) {
    throw new DaxRuntimeError(`${what} needs a table but received ${describe(value)}.`);
  }
  return value;
};

/**
 * A table of model rows, refusing a computed one.
 *
 * Most things that take a table need rows that exist: an iterator has to
 * read the other columns of the row it is on, and a filter has to narrow
 * something. A derived table has neither - its rows are values, not
 * positions - so those callers refuse it rather than quietly reading
 * whatever is at index 0.
 *
 * The refusal is the honest half-step. Making iterators work over derived
 * tables needs row context to address values as well as positions, which is
 * a change worth making on its own rather than smuggling in here.
 */
export const expectRowSet = (value: DaxValue, what: string): DaxRowSet => {
  const table = expectTable(value, what);
  if (isDerived(table)) {
    throw new DaxRuntimeError(
      `${what} needs a table of rows from the model. A computed table - one built by ` +
        `ADDCOLUMNS, or VALUES of a single column - cannot be used here yet.`
    );
  }
  return table;
};

/**
 * Coerce to a number for arithmetic.
 *
 * BLANK becomes 0 and TRUE/FALSE become 1/0, matching DAX. A string that is
 * not a number is an error rather than NaN, so a bad value stops the
 * calculation instead of poisoning every total downstream.
 */
export const toNumber = (value: DaxValue, what: string): number => {
  const scalar = expectScalar(value, what);
  if (scalar === null) return 0;
  if (typeof scalar === 'number') {
    if (!Number.isFinite(scalar)) return scalar;
    return scalar;
  }
  if (typeof scalar === 'boolean') return scalar ? 1 : 0;

  const trimmed = scalar.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new DaxRuntimeError(`${what} cannot treat the text "${scalar}" as a number.`);
  }
  return parsed;
};

/** Coerce to text. BLANK becomes the empty string, as the & operator does. */
export const toText = (value: DaxValue, what: string): string => {
  const scalar = expectScalar(value, what);
  if (scalar === null) return '';
  if (typeof scalar === 'boolean') return scalar ? 'TRUE' : 'FALSE';
  return String(scalar);
};

/**
 * Coerce to a condition.
 *
 * BLANK and 0 are false; every other number is true. A non-numeric string is
 * an error, because silently treating "yes" as false would quietly drop rows.
 */
export const toBoolean = (value: DaxValue, what: string): boolean => {
  const scalar = expectScalar(value, what);
  if (scalar === null) return false;
  if (typeof scalar === 'boolean') return scalar;
  if (typeof scalar === 'number') return scalar !== 0;

  const upper = scalar.trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE' || upper === '') return false;
  throw new DaxRuntimeError(`${what} cannot treat the text "${scalar}" as true or false.`);
};

/** True when a scalar can take part in numeric comparison. */
const numericLike = (value: DaxScalar): boolean => {
  if (value === null) return true;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  const trimmed = value.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed));
};

/**
 * Order two scalars, returning negative, zero or positive.
 *
 * Numbers compare numerically, text compares case-insensitively - DAX is not
 * case-sensitive, so "Accra" and "ACCRA" are the same value. A blank compared
 * against a number is 0, and against text is the empty string, which is what
 * makes BLANK() = 0 true.
 */
export const compareScalars = (left: DaxScalar, right: DaxScalar): number => {
  if (numericLike(left) && numericLike(right)) {
    const a = left === null ? 0 : typeof left === 'boolean' ? (left ? 1 : 0) : Number(left);
    const b = right === null ? 0 : typeof right === 'boolean' ? (right ? 1 : 0) : Number(right);
    return a === b ? 0 : a < b ? -1 : 1;
  }

  const a = (left === null ? '' : String(left)).toLowerCase();
  const b = (right === null ? '' : String(right)).toLowerCase();
  return a === b ? 0 : a < b ? -1 : 1;
};

export const valuesEqual = (left: DaxScalar, right: DaxScalar): boolean =>
  compareScalars(left, right) === 0;

/**
 * Normalise a raw cell from the model into a DaxScalar.
 *
 * An empty string becomes BLANK. This is a DELIBERATE DIVERGENCE from Power
 * BI's Text/CSV connector, which stores an empty text field as "" - verified
 * 2026-09-20 on the same file: COUNTA(Sales[Region]) is 18 there and 17
 * here, ISBLANK is FALSE there and TRUE here, and LOOKUPVALUE at the empty
 * row answers NOT-BLANK there. The comment that used to sit here claimed the
 * opposite, and was never checked.
 *
 * Kept anyway, because an empty cell in a CSV means "missing", and this
 * product reports missingness: null counts, completeness, and the "N blank
 * rows are left out" note in an answer. Treating "" as a value makes
 * completeness report 100% on data with empty cells, which is a worse and
 * quieter failure than a disagreement about ISBLANK. Power BI users
 * routinely add a "Replace empty with null" step for the same reason, so
 * what "agreeing with Power BI" means here depends on the import path.
 *
 * The divergence is narrow and fully characterised: it changes ISBLANK and
 * COUNTA on a TEXT column containing empty cells, and nothing else. Filters
 * agree because BLANK = "" is TRUE in DAX, DISTINCTCOUNT and grouping agree
 * because either way it is one distinct value, and numeric columns are BLANK
 * in both. See blank-expected.ts for the evidence.
 */
export const fromCell = (value: unknown): DaxScalar => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value);
  return text.trim() === '' ? null : text;
};

/** The numeric value of a cell, or null when it is not a number. */
export const cellAsNumber = (value: unknown): number | null => {
  const scalar = fromCell(value);
  if (scalar === null) return null;
  if (typeof scalar === 'number') return scalar;
  if (typeof scalar === 'boolean') return scalar ? 1 : 0;
  const parsed = Number(scalar.trim());
  return Number.isFinite(parsed) ? parsed : null;
};
