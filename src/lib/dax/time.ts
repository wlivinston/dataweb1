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

// ============================================================
// Week numbering and date differences
// ============================================================

/** Days since the Unix epoch, which was a Thursday. */
const epochDay = (iso: string): number | null => {
  const parts = parseKey(iso);
  if (!parts) return null;
  return Math.floor(toUtc(parts).getTime() / MS_PER_DAY);
};

/** Day of week with Sunday as 0, matching the DAX WEEKNUM default. */
const sundayIndex = (parts: Parts): number => toUtc(parts).getUTCDay();

/**
 * Week of the year.
 *
 * `returnType` follows DAX: 1 starts weeks on Sunday, 2 on Monday, and both
 * put 1 January in week 1. 21 is ISO 8601, where the week belongs to whichever
 * year holds its Thursday - so 29 December 2025 is week 1 of 2026.
 */
export const weekNumber = (iso: string, returnType = 1): number | null => {
  const parts = parseKey(iso);
  if (!parts) return null;

  if (returnType === 21) {
    const target = toUtc(parts);
    const isoDay = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - isoDay);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil(((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  }

  if (returnType !== 1 && returnType !== 2) return null;

  const jan1 = { year: parts.year, month: 1, day: 1 };
  const offset =
    returnType === 1 ? sundayIndex(jan1) : (sundayIndex(jan1) + 6) % 7;
  const dayOfYear =
    Math.floor((toUtc(parts).getTime() - toUtc(jan1).getTime()) / MS_PER_DAY) + 1;

  return Math.floor((dayOfYear - 1 + offset) / 7) + 1;
};

/**
 * Count the interval boundaries crossed between two dates.
 *
 * This is DAX's definition, and it is not the same as elapsed time: 31
 * December to 1 January is one YEAR, because one year boundary lies between
 * them, even though only a day has passed.
 */
export const dateDifference = (
  startIso: string,
  endIso: string,
  interval: DateInterval | 'WEEK'
): number | null => {
  const start = parseKey(startIso);
  const end = parseKey(endIso);
  if (!start || !end) return null;

  switch (interval) {
    case 'DAY': {
      const a = epochDay(startIso);
      const b = epochDay(endIso);
      return a === null || b === null ? null : b - a;
    }
    case 'WEEK': {
      // Weeks turn over on Sunday, so shift the epoch (a Thursday) by 4.
      const a = epochDay(startIso);
      const b = epochDay(endIso);
      if (a === null || b === null) return null;
      return Math.floor((b + 4) / 7) - Math.floor((a + 4) / 7);
    }
    case 'MONTH':
      return (end.year - start.year) * 12 + (end.month - start.month);
    case 'QUARTER':
      return (
        (end.year - start.year) * 4 +
        (Math.ceil(end.month / 3) - Math.ceil(start.month / 3))
      );
    case 'YEAR':
      return end.year - start.year;
  }
};

export const parseDifferenceInterval = (
  value: string
): DateInterval | 'WEEK' | null => {
  const upper = value.trim().toUpperCase();
  if (upper === 'WEEK') return 'WEEK';
  return parseInterval(upper);
};

/** The last day of the month `offset` months from `iso`. */
export const endOfMonth = (iso: string, offset: number): string | null => {
  const shifted = addMonths(iso, offset);
  const parts = parseKey(shifted);
  if (!parts) return null;
  return makeKey(parts.year, parts.month, daysInMonth(parts.year, parts.month));
};
