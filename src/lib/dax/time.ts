/**
 * Date arithmetic for the time intelligence functions.
 *
 * Everything here works on canonical `yyyy-mm-dd` strings - the form the
 * semantic model normalises date columns into - and computes in UTC. Keeping
 * it as pure string-to-string functions means the awkward cases (month-end
 * clamping, leap days, fiscal year boundaries) can be tested against the
 * calendar directly, without a model in the way.
 */

export type DateInterval = 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR';

const MS_PER_DAY = 86_400_000;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const makeKey = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

interface Parts {
  year: number;
  month: number;
  day: number;
}

/** Split a canonical key. Returns null for anything that is not one. */
export const parseKey = (iso: string): Parts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const toUtc = (parts: Parts): Date =>
  new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

const fromUtc = (date: Date): string =>
  makeKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

export const addDays = (iso: string, count: number): string => {
  const parts = parseKey(iso);
  if (!parts) return iso;
  return fromUtc(new Date(toUtc(parts).getTime() + count * MS_PER_DAY));
};

/**
 * Add months, clamping the day to the target month's length.
 *
 * 31 January plus one month is 28 or 29 February, not 2 or 3 March. Without
 * the clamp, a month-over-month measure silently reports the wrong month for
 * every 29th, 30th and 31st.
 */
export const addMonths = (iso: string, count: number): string => {
  const parts = parseKey(iso);
  if (!parts) return iso;
  const total = parts.year * 12 + (parts.month - 1) + count;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return makeKey(year, month, Math.min(parts.day, daysInMonth(year, month)));
};

export const shiftDate = (iso: string, count: number, interval: DateInterval): string => {
  switch (interval) {
    case 'DAY':
      return addDays(iso, count);
    case 'MONTH':
      return addMonths(iso, count);
    case 'QUARTER':
      return addMonths(iso, count * 3);
    case 'YEAR':
      return addMonths(iso, count * 12);
  }
};

export const parseInterval = (value: string): DateInterval | null => {
  const upper = value.trim().toUpperCase();
  if (upper === 'DAY' || upper === 'MONTH' || upper === 'QUARTER' || upper === 'YEAR') {
    return upper;
  }
  return null;
};

export interface DateRange {
  start: string;
  end: string;
}

/** The last day of the year that `iso` falls in, given where the year ends. */
export const yearBounds = (iso: string, endMonth: number, endDay: number): DateRange | null => {
  const parts = parseKey(iso);
  if (!parts) return null;

  // The year closes on the first (endMonth, endDay) that is not before this date.
  const endsNextYear =
    parts.month > endMonth || (parts.month === endMonth && parts.day > endDay);
  const endYear = endsNextYear ? parts.year + 1 : parts.year;

  const end = makeKey(endYear, endMonth, Math.min(endDay, daysInMonth(endYear, endMonth)));
  const priorEnd = makeKey(
    endYear - 1,
    endMonth,
    Math.min(endDay, daysInMonth(endYear - 1, endMonth))
  );

  return { start: addDays(priorEnd, 1), end };
};

export const quarterBounds = (iso: string): DateRange | null => {
  const parts = parseKey(iso);
  if (!parts) return null;
  const firstMonth = Math.floor((parts.month - 1) / 3) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    start: makeKey(parts.year, firstMonth, 1),
    end: makeKey(parts.year, lastMonth, daysInMonth(parts.year, lastMonth)),
  };
};

export const monthBounds = (iso: string): DateRange | null => {
  const parts = parseKey(iso);
  if (!parts) return null;
  return {
    start: makeKey(parts.year, parts.month, 1),
    end: makeKey(parts.year, parts.month, daysInMonth(parts.year, parts.month)),
  };
};

/** The whole period of `interval` that `iso` falls in. */
export const periodBounds = (
  iso: string,
  interval: DateInterval,
  yearEnd: { month: number; day: number }
): DateRange | null => {
  switch (interval) {
    case 'DAY':
      return { start: iso, end: iso };
    case 'MONTH':
      return monthBounds(iso);
    case 'QUARTER':
      return quarterBounds(iso);
    case 'YEAR':
      return yearBounds(iso, yearEnd.month, yearEnd.day);
  }
};

export const inRange = (iso: string, range: DateRange): boolean =>
  iso >= range.start && iso <= range.end;

/**
 * Read a DAX year-end argument such as "6/30" or "12-31".
 *
 * Returns null when the two numbers could be read either way round. DAX
 * resolves this by locale, which means the same expression means different
 * things on different machines; refusing is better than picking. In practice
 * every real year end has a day above 12, so this rejects almost nothing.
 */
export const parseYearEnd = (value: string): { month: number; day: number } | null => {
  const match = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(value.trim());
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);

  const monthFirst = first <= 12 && second <= daysInMonth(2024, first);
  const dayFirst = second <= 12 && first <= daysInMonth(2024, second);

  if (monthFirst && !dayFirst) return { month: first, day: second };
  if (dayFirst && !monthFirst) return { month: second, day: first };
  return null;
};

export const CALENDAR_YEAR_END = { month: 12, day: 31 };
