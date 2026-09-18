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

/** A set of rows of one model table, held as indices into that table. */
export interface DaxTable {
  kind: 'table';
  table: string;
  rows: number[];
}

export type DaxValue = DaxScalar | DaxTable;

export const BLANK: null = null;

export const isBlank = (value: DaxValue): value is null => value === null;

export const isTable = (value: DaxValue): value is DaxTable =>
  typeof value === 'object' && value !== null && (value as DaxTable).kind === 'table';

export const isScalar = (value: DaxValue): value is DaxScalar => !isTable(value);

export const makeTable = (table: string, rows: number[]): DaxTable => ({
  kind: 'table',
  table,
  rows,
});

const describe = (value: DaxValue): string => {
  if (isTable(value)) return `a table (${value.table})`;
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
 * Empty strings become BLANK, matching how Power BI treats an empty cell on
 * import: otherwise COUNT and AVERAGE would include cells that look empty.
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
