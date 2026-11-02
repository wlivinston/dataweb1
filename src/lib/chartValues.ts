// How a chart reads a cell: the same rules the DAX engine uses.
//
// The chart generator did its own arithmetic, and read cells its own way:
//
// - `Number(cell) || 0` made a blank or "NA" a real zero. A sum survives that;
//   an average, a correlation, a box plot and a scatter point do not. A row
//   with an empty "Days Held" was plotted at 0, and pulled every correlation
//   toward whichever column had fewer blanks.
// - `String(cell || 'Other')` named a blank category "Other" - the same name
//   as the bucket of small slices - and other paths named it "" or "Unknown",
//   so a stacked chart had a series with no name at all.
// - Categories were compared as raw strings, so " workshop " and "Workshop"
//   were two bars, while the engine (and Ask Data) counted them as one group.
//
// This is the same class of bug as the KPI tiles that once disagreed with the
// engine beside them, so the fix is the same: reuse the engine's own rules
// rather than restate them. `cellAsNumber` is the DAX conversion; `keyOf` is
// how the model compares text (trimmed, case-insensitive).

import { cellAsNumber } from '@/lib/dax/value';
import { keyOf } from '@/lib/semantic/model';

/** What Power BI shows for a blank category. */
export const BLANK_LABEL = '(Blank)';

/** A cell as a number, or null when it is blank or not a number. Never 0 for "nothing". */
export const chartNumber = (value: unknown): number | null => cellAsNumber(value);

/** `keyOf` never returns '', so '' is free to mean "blank". */
const BLANK_KEY = '';

/**
 * Groups raw category cells the way the engine does, remembering a label for
 * each group: the first spelling seen, trimmed, so " workshop " and
 * "Workshop" become one group labelled "Workshop" when that came first.
 */
export class CategoryGroups {
  private readonly labels = new Map<string, string>();

  /** The group a cell belongs to. */
  key(value: unknown): string {
    const key = keyOf(value) ?? BLANK_KEY;
    if (!this.labels.has(key)) {
      this.labels.set(key, key === BLANK_KEY ? BLANK_LABEL : String(value).trim());
    }
    return key;
  }

  /** The label to show for a group. */
  label(key: string): string {
    return this.labels.get(key) ?? (key === BLANK_KEY ? BLANK_LABEL : key);
  }
}

export interface CategoryTotal {
  category: string;
  value: number;
  /** Rows with a number in them - a blank value is not a zero. */
  count: number;
}

/**
 * Sum of `valueColumn` per category of `categoryColumn`, largest first.
 *
 * A row whose value is blank still makes its category exist (a category with
 * no figures is a fact about the data), but adds nothing to the sum or count.
 */
export const sumByCategory = (
  rows: readonly Record<string, unknown>[],
  categoryColumn: string,
  valueColumn: string,
  transform: (value: number) => number = value => value
): CategoryTotal[] => {
  const groups = new CategoryGroups();
  const totals = new Map<string, { value: number; count: number }>();
  for (const row of rows) {
    const key = groups.key(row[categoryColumn]);
    const entry = totals.get(key) ?? { value: 0, count: 0 };
    const number = chartNumber(row[valueColumn]);
    if (number !== null) {
      entry.value += transform(number);
      entry.count += 1;
    }
    totals.set(key, entry);
  }
  return [...totals.entries()]
    .map(([key, { value, count }]) => ({ category: groups.label(key), value, count }))
    .sort((a, b) => b.value - a.value);
};

/** The numbers in a column, blanks and non-numbers left out. */
export const numbersIn = (rows: readonly Record<string, unknown>[], column: string): number[] => {
  const values: number[] = [];
  for (const row of rows) {
    const number = chartNumber(row[column]);
    if (number !== null) values.push(number);
  }
  return values;
};

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * How many rows a chart was drawn from, and what was left out of it.
 *
 * `columns` are the numeric columns the chart reads; a row with any of them
 * blank (or not a number, like "NA") is counted as left out. `totalRows` is
 * the dataset's size when the chart was drawn from a sample.
 */
export const coverageNote = (
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  totalRows: number = rows.length
): string => {
  const sampled = totalRows > rows.length;
  const base = sampled
    ? `Drawn from a sample of ${rows.length.toLocaleString()} of ${plural(totalRows, 'row')}.`
    : `Drawn from ${plural(rows.length, 'row')}.`;
  if (columns.length === 0) return base;
  let missing = 0;
  for (const row of rows) {
    if (columns.some(column => chartNumber(row[column]) === null)) missing++;
  }
  if (missing === 0) return base;
  const names = columns.join(' or ');
  return `${base} ${plural(missing, 'row')} with a blank or non-numeric ${names} ${missing === 1 ? 'is' : 'are'} left out.`;
};
