import type { DataType } from '../types';
import type { Aggregation, ColumnRole } from './types';

/**
 * Work out what a column is for.
 *
 * The decision that earns its keep here is numeric identifier versus measure.
 * A CustomerID of 10234 is a number, and a tool that offers to sum it looks
 * foolish and can produce a figure someone screenshots. Name evidence is
 * trusted over shape evidence, because `Amount` full of whole numbers is
 * still an amount.
 *
 * Every verdict carries a reason. These are heuristics over someone else's
 * spreadsheet, so they will sometimes be wrong, and a user overriding one
 * deserves to know what it was based on.
 */

export interface ColumnRoleInput {
  name: string;
  dataType: DataType;
  rowCount: number;
  uniqueCount: number;
  nullCount: number;
  /** Column values, used for the integer and text-length checks. */
  values?: unknown[];
}

export interface ColumnRoleOptions {
  /** Set when the column was matched to another table's key. */
  participatesInRelationship?: boolean;
}

export interface ColumnRoleVerdict {
  role: ColumnRole;
  defaultAggregation: Aggregation;
  reason: string;
}

/** Trailing tokens that mark a column as an identifier rather than a value. */
const IDENTIFIER_TOKENS = new Set([
  'id', 'ids', 'key', 'code', 'no', 'num', 'number', 'ref', 'reference',
  'sku', 'upc', 'ean', 'isbn', 'uuid', 'guid', 'pk', 'fk',
]);

/** Leading tokens that mark an identifier when they open the name. */
const IDENTIFIER_PREFIXES = new Set(['id', 'key', 'pk', 'fk']);

/**
 * Split CustomerID, customer_id and "Customer No" alike into tokens.
 * The camelCase boundary is inserted before splitting on separators.
 */
export const tokeniseColumnName = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .map(token => token.trim().toLowerCase())
    .filter(token => token.length > 0);

export const looksLikeIdentifier = (name: string): boolean => {
  const tokens = tokeniseColumnName(name);
  if (tokens.length === 0) return false;
  if (IDENTIFIER_TOKENS.has(tokens[tokens.length - 1])) return true;
  // "ID Number" and "Key Account" differ; only treat a prefix as an
  // identifier when the name is short enough to be nothing else.
  if (tokens.length <= 2 && IDENTIFIER_PREFIXES.has(tokens[0])) return true;
  return false;
};

const TEXT_LENGTH_THRESHOLD = 25;
const TEXT_UNIQUE_RATIO = 0.7;
const IMPLICIT_KEY_UNIQUE_RATIO = 0.95;

const isWholeNumber = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed);
  }
  return false;
};

const presentValues = (values: unknown[] | undefined): unknown[] =>
  (values ?? []).filter(v => v !== null && v !== undefined && v !== '');

const allWholeNumbers = (values: unknown[] | undefined): boolean => {
  const present = presentValues(values);
  if (present.length === 0) return false;
  return present.every(isWholeNumber);
};

/**
 * Returns null when there is nothing to measure.
 *
 * Not zero: a zero would read as "short text" and promote a column of long
 * unique comments to a key on no evidence at all. Absent evidence must not
 * look like positive evidence.
 */
const averageTextLength = (values: unknown[] | undefined): number | null => {
  const present = presentValues(values);
  if (present.length === 0) return null;
  const total = present.reduce<number>((sum, v) => sum + String(v).length, 0);
  return total / present.length;
};

/** A column with no repeats and no blanks can identify its rows. */
const isCandidateKey = (input: ColumnRoleInput): boolean =>
  input.rowCount > 0 && input.nullCount === 0 && input.uniqueCount === input.rowCount;

const uniqueRatio = (input: ColumnRoleInput): number =>
  input.rowCount === 0 ? 0 : input.uniqueCount / input.rowCount;

export const inferColumnRole = (
  input: ColumnRoleInput,
  options: ColumnRoleOptions = {}
): ColumnRoleVerdict => {
  const named = looksLikeIdentifier(input.name);
  const candidateKey = isCandidateKey(input);

  if (input.dataType === 'date') {
    return {
      role: 'date',
      defaultAggregation: 'none',
      reason: 'Holds dates, so it anchors time intelligence rather than being aggregated.',
    };
  }

  if (input.dataType === 'boolean') {
    return {
      role: 'flag',
      defaultAggregation: 'count',
      reason: 'Holds true/false values, so it filters and counts rather than sums.',
    };
  }

  if (named) {
    return candidateKey
      ? {
          role: 'key',
          defaultAggregation: 'distinctCount',
          reason: `Named like an identifier and every value is unique with no blanks, so it identifies rows.`,
        }
      : {
          role: 'foreignKey',
          defaultAggregation: 'distinctCount',
          reason: `Named like an identifier but values repeat, so it points at another table rather than identifying rows here.`,
        };
  }

  if (input.dataType === 'number') {
    // Shape evidence alone is weak: an amount column of whole cedis is nearly
    // unique and entirely integral. Require a confirmed relationship before
    // overriding the default reading of a number as a measure.
    if (
      options.participatesInRelationship &&
      allWholeNumbers(input.values) &&
      uniqueRatio(input) >= IMPLICIT_KEY_UNIQUE_RATIO
    ) {
      return candidateKey
        ? {
            role: 'key',
            defaultAggregation: 'distinctCount',
            reason:
              'Whole numbers, unique per row, and matched to another table - an identifier despite the plain name.',
          }
        : {
            role: 'foreignKey',
            defaultAggregation: 'distinctCount',
            reason:
              'Whole numbers matched to another table, so it joins rather than measures.',
          };
    }

    return {
      role: 'measure',
      defaultAggregation: 'sum',
      reason: 'Numeric with no sign of being an identifier, so it is treated as a value to aggregate.',
    };
  }

  // Strings. Both branches below need measured length; without values there
  // is no basis to claim a column is either a key or free text.
  const textLength = averageTextLength(input.values);

  if (
    candidateKey &&
    uniqueRatio(input) === 1 &&
    textLength !== null &&
    textLength <= TEXT_LENGTH_THRESHOLD
  ) {
    return {
      role: 'key',
      defaultAggregation: 'distinctCount',
      reason: 'Short text, unique in every row and never blank, so it identifies rows.',
    };
  }

  if (
    uniqueRatio(input) > TEXT_UNIQUE_RATIO &&
    textLength !== null &&
    textLength > TEXT_LENGTH_THRESHOLD
  ) {
    return {
      role: 'text',
      defaultAggregation: 'count',
      reason: 'Long and mostly distinct, so grouping by it would produce one row per record.',
    };
  }

  return {
    role: 'dimension',
    defaultAggregation: 'distinctCount',
    reason: 'Repeating text values, so it is useful to group and filter by.',
  };
};
