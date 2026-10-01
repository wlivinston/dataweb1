import { columnRef } from '../dax/printer';
import { fromCell, valuesEqual } from '../dax/value';
import type { DaxScalar } from '../dax/value';
import type { SemanticColumn, SemanticModel } from '../semantic/types';

/**
 * The "in 2024" half of a question.
 *
 * A filter is resolved against the DATA, not guessed from the words. "North"
 * becomes Sales[Region] = "North" because North is a value that is actually
 * in Sales[Region]; if it is in no column, the question is refused by name
 * rather than answered about everything. That matters more here than
 * anywhere else in this module: a filter that silently fails to apply
 * returns the grand total, which is a real number, plausible, and wrong.
 *
 * Nothing here is clever about language. There is no date arithmetic, no
 * "last quarter", no relative periods - those need a notion of today and a
 * fiscal calendar to agree on, and getting them subtly wrong is exactly the
 * failure this engine exists to avoid. They are refused, by saying what is
 * supported.
 */

/**
 * Words that introduce a filter clause.
 *
 * Global, because the first match is not always the right one: "for each" is
 * the grouping split, not a filter, and reading it as one would turn
 * "revenue for each region" into a search for a value called "each region".
 */
const FILTER_MARKER = /\b(?:in|for|during|where|within)\b/g;

/**
 * Date-table columns a person names in a question.
 *
 * The generated date table has twenty-odd columns, and several hold the same
 * literal: 2024 is a value in Year, WeekYear and FiscalYear at once. Scanning
 * all of them would make every year ambiguous and the feature useless, so the
 * ones a person actually says are listed and the computational ones
 * (WeekOfYear, DayOfYear, YearMonth, MonthStart) are left out.
 *
 * FiscalYear is deliberately NOT here. "In 2024" means the calendar year
 * unless someone says fiscal, and a model whose fiscal year starts in July
 * would otherwise answer a different question than the one asked - silently,
 * and off by up to six months. Fiscal filtering is named explicitly instead.
 */
const DATE_FILTER_COLUMNS = new Set([
  'year',
  'quarter',
  'quartername',
  'month',
  'monthname',
  'monthshort',
  'dayname',
]);

/** Filter phrases that need a notion of "now", which this engine does not have. */
const RELATIVE_PERIODS = [
  'last year',
  'this year',
  'next year',
  'last month',
  'this month',
  'last quarter',
  'this quarter',
  'year to date',
  'ytd',
  'last week',
  'this week',
  'today',
  'yesterday',
];

export interface ResolvedFilter {
  /** The DAX predicate, ready to sit inside CALCULATE. */
  predicate: string;
  /** The column filtered, for the interpretation sentence. */
  column: SemanticColumn;
  /** The matched value, as stored. */
  value: DaxScalar;
  /** The words consumed, so the subject can be parsed from what is left. */
  consumed: string;
  /** The question with the filter clause removed, for the rest of the parse. */
  rest: string;
}

export type FilterResolution =
  | { kind: 'none' }
  | { kind: 'found'; value: ResolvedFilter }
  | { kind: 'refused'; reason: string };

/** A value written as DAX: text quoted, numbers bare. */
const literal = (value: DaxScalar): string => {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()';
  return `"${String(value).replace(/"/g, '""')}"`;
};

/** Is this a column a filter phrase may name? */
const filterable = (model: SemanticModel, column: SemanticColumn): boolean => {
  if (column.table === model.dateTableName) {
    return DATE_FILTER_COLUMNS.has(column.name.toLowerCase());
  }
  // A measure is what a question asks ABOUT, not what it filters by.
  // "Revenue in 2024" never means "rows whose revenue is 2024".
  return column.role !== 'measure';
};

const compact = (text: string): string => text.toLowerCase().replace(/[\s_\-./]+/g, '');

/**
 * Does this phrase name a table or a column rather than a value?
 *
 * "How many rows are there in Orders" has a filter marker in it, but Orders
 * is the table being counted, not a value to filter by - and treating it as
 * one refused a question that had worked, which was one of this module's own
 * suggested questions. A phrase that names part of the model is structure,
 * so the filter steps aside and lets the normal parse have it.
 */
const namesPartOfTheModel = (model: SemanticModel, phrase: string): boolean => {
  const want = compact(phrase);
  if (want.length === 0) return false;
  return model.tables.some(
    table =>
      compact(table.name) === want ||
      table.columns.some(column => compact(column.name) === want)
  );
};

const compare = (left: unknown, right: string): boolean => {
  const scalar = fromCell(left);
  if (scalar === null) return false;
  if (typeof scalar === 'number') {
    const asNumber = Number(right);
    return Number.isFinite(asNumber) && scalar === asNumber;
  }
  return valuesEqual(String(scalar).toLowerCase(), right.toLowerCase());
};

/**
 * Every column holding this literal.
 *
 * Scans stored rows rather than a cached distinct list, because a stale list
 * would quietly stop matching values that are really there.
 */
const columnsHolding = (
  model: SemanticModel,
  phrase: string
): Array<{ column: SemanticColumn; value: DaxScalar }> => {
  const hits: Array<{ column: SemanticColumn; value: DaxScalar }> = [];

  for (const table of model.tables) {
    for (const column of table.columns) {
      if (!filterable(model, column)) continue;
      for (const row of table.rows) {
        if (!compare(row[column.name], phrase)) continue;
        hits.push({ column, value: fromCell(row[column.name]) });
        break;
      }
    }
  }
  return hits;
};

/**
 * Pull a filter clause off a question.
 *
 * Returns `none` when there is no filter, so a question without one is
 * unaffected. Returns `refused` rather than guessing whenever the phrase
 * names something this engine cannot pin to one column.
 */
export const extractFilter = (text: string, model: SemanticModel): FilterResolution => {
  FILTER_MARKER.lastIndex = 0;
  let marker: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = FILTER_MARKER.exec(text)) !== null) {
    // "for each" belongs to the grouping split, not to a filter.
    if (/^\s+each\b/.test(text.slice(match.index + match[0].length))) continue;
    marker = match;
    break;
  }
  if (!marker) return { kind: 'none' };

  const head = text.slice(0, marker.index);
  const tail = text.slice(marker.index + marker[0].length);
  const skippedArticle = /^\s*the\s+/.exec(tail);
  const phrase = tail.replace(/^\s*the\s+/, '').trim();
  const phraseStart =
    marker.index + marker[0].length + (skippedArticle ? skippedArticle[0].length : tail.length - tail.trimStart().length);

  if (phrase.length === 0) return { kind: 'none' };

  const relative = RELATIVE_PERIODS.find(
    period => phrase === period || phrase.startsWith(`${period} `)
  );
  if (relative) {
    return {
      kind: 'refused',
      reason:
        `"${relative}" is relative to today, and this engine has no notion of today - ` +
        'a period it worked out itself could silently differ from the one you meant. ' +
        'Name the period instead, for example "in 2024".',
    };
  }

  // Longest first: "North America" before "North", so a two-word value is not
  // cut down to a one-word column that also happens to hold "North".
  if (namesPartOfTheModel(model, phrase)) return { kind: 'none' };

  const candidateWords = phrase.split(/\s+/).filter(Boolean);
  for (let length = candidateWords.length; length >= 1; length -= 1) {
    const attempt = candidateWords.slice(0, length).join(' ');
    if (namesPartOfTheModel(model, attempt)) return { kind: 'none' };
    const hits = columnsHolding(model, attempt);

    if (hits.length === 1) {
      const { column, value } = hits[0];
      const leftover = text.slice(phraseStart + attempt.length);
      return {
        kind: 'found',
        value: {
          predicate: `${columnRef(column.table, column.name)} = ${literal(value)}`,
          column,
          value,
          consumed: attempt,
          rest: `${head} ${leftover}`.replace(/\s+/g, ' ').trim(),
        },
      };
    }

    if (hits.length > 1) {
      const names = hits.map(hit => `${hit.column.table}[${hit.column.name}]`).join(' and ');
      return {
        kind: 'refused',
        reason:
          `"${attempt}" is a value in ${names}, so I cannot tell which one you mean. ` +
          'Name the column, for example "where Region is ' +
          `${attempt}".`,
      };
    }
  }

  return {
    kind: 'refused',
    reason:
      `Nothing in this data has the value "${phrase}", so I cannot filter by it. ` +
      'A filter has to name a value that is actually in a column - a region, a ' +
      'product, a year - rather than a description of one.',
  };
};

/** Wrap an aggregation in its filter. */
export const applyFilter = (dax: string, filter: ResolvedFilter): string =>
  `CALCULATE(${dax}, ${filter.predicate})`;

/** How the filter reads in the interpretation sentence. */
export const describeFilter = (filter: ResolvedFilter): string =>
  `where ${filter.column.table}[${filter.column.name}] is ${
    typeof filter.value === 'string' ? `"${filter.value}"` : String(filter.value)
  }`;
