/**
 * Parse date values out of uploaded data.
 *
 * The hazard this module exists for: `03/04/2024` is 3 April in most of the
 * world and 4 March in the United States. `new Date('03/04/2024')` silently
 * picks the American reading. Getting that wrong does not throw - it moves a
 * transaction into a different month and quietly changes every monthly total.
 *
 * So format is decided per column, from the whole column, not per value. A
 * column containing `15/03/2024` anywhere is day-first everywhere, because no
 * month is 15. When nothing in the column settles it, that is reported as
 * ambiguous rather than guessed at.
 */

export type DateFormat = 'iso' | 'dayFirst' | 'monthFirst';

export type DateFormatStatus =
  /** ISO, or a value whose day component exceeds 12, settles the reading. */
  | 'certain'
  /** Every value parses both ways. Nothing in the data can decide it. */
  | 'ambiguous'
  /** Some values demand day-first and others month-first. The column is dirty. */
  | 'inconsistent'
  /** Nothing recognisable as a date. */
  | 'unrecognised';

export interface DateFormatInference {
  format: DateFormat | null;
  status: DateFormatStatus;
  /** How many values yielded a date under the chosen reading. */
  parsedCount: number;
  /** How many non-empty values were considered. */
  totalCount: number;
  /** A value that would mean different things under each reading. */
  example?: string;
}

/**
 * Two-digit years pivot here: 00-68 are 2000s, 69-99 are 1900s.
 * This matches the POSIX and Excel convention.
 */
const TWO_DIGIT_YEAR_PIVOT = 69;

const ISO_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]|$)/;
const SLASH_PATTERN = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s]|$)/;

const expandYear = (year: number, digits: number): number => {
  if (digits === 4) return year;
  return year < TWO_DIGIT_YEAR_PIVOT ? 2000 + year : 1900 + year;
};

/**
 * Build a UTC date, returning null if the components do not describe a real
 * day. Date.UTC rolls 31 February over into March rather than failing, so the
 * result is checked back against its inputs.
 */
const makeUtcDate = (year: number, month: number, day: number): Date | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

interface NumericParts {
  first: number;
  second: number;
  year: number;
}

/** Split a non-ISO date string into its three numbers, or null. */
const splitNumeric = (value: string): NumericParts | null => {
  const match = SLASH_PATTERN.exec(value);
  if (!match) return null;
  return {
    first: Number(match[1]),
    second: Number(match[2]),
    year: expandYear(Number(match[3]), match[3].length),
  };
};

const parseIso = (value: string): Date | null => {
  const match = ISO_PATTERN.exec(value);
  if (!match) return null;
  return makeUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
};

/** Normalise whatever the sheet gave us into a trimmed string, or null. */
const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

/**
 * Decide how a column's dates should be read, from the whole column.
 *
 * Deliberately does not fall back to a default when the data is ambiguous -
 * that choice belongs to the caller, which can record it as a warning the
 * user gets to see and override.
 */
export const inferDateFormat = (values: unknown[]): DateFormatInference => {
  let considered = 0;
  let isoCount = 0;
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  let parseableBothWays = 0;
  let dayFirstExample: string | undefined;
  let monthFirstExample: string | undefined;
  let ambiguousExample: string | undefined;

  for (const raw of values) {
    if (raw instanceof Date) {
      if (!Number.isNaN(raw.getTime())) {
        considered += 1;
        isoCount += 1;
      }
      continue;
    }

    const text = asText(raw);
    if (text === null) continue;
    considered += 1;

    if (parseIso(text)) {
      isoCount += 1;
      continue;
    }

    const parts = splitNumeric(text);
    if (!parts) continue;

    const asDayFirst = makeUtcDate(parts.year, parts.second, parts.first);
    const asMonthFirst = makeUtcDate(parts.year, parts.first, parts.second);

    if (asDayFirst && !asMonthFirst) {
      // First component exceeds 12, so it can only be a day.
      dayFirstEvidence += 1;
      dayFirstExample ??= text;
    } else if (asMonthFirst && !asDayFirst) {
      monthFirstEvidence += 1;
      monthFirstExample ??= text;
    } else if (asDayFirst && asMonthFirst) {
      parseableBothWays += 1;
      if (parts.first !== parts.second) ambiguousExample ??= text;
    }
  }

  if (considered === 0) {
    return { format: null, status: 'unrecognised', parsedCount: 0, totalCount: 0 };
  }

  const numericTotal = dayFirstEvidence + monthFirstEvidence + parseableBothWays;

  // A column of genuine ISO values, with no ambiguous numeric forms mixed in.
  if (isoCount > 0 && numericTotal === 0) {
    return { format: 'iso', status: 'certain', parsedCount: isoCount, totalCount: considered };
  }

  if (dayFirstEvidence > 0 && monthFirstEvidence > 0) {
    return {
      format: null,
      status: 'inconsistent',
      parsedCount: 0,
      totalCount: considered,
      example: `${dayFirstExample} and ${monthFirstExample} cannot both be right`,
    };
  }

  if (dayFirstEvidence > 0) {
    return {
      format: 'dayFirst',
      status: 'certain',
      parsedCount: isoCount + numericTotal,
      totalCount: considered,
      example: dayFirstExample,
    };
  }

  if (monthFirstEvidence > 0) {
    return {
      format: 'monthFirst',
      status: 'certain',
      parsedCount: isoCount + numericTotal,
      totalCount: considered,
      example: monthFirstExample,
    };
  }

  if (parseableBothWays > 0) {
    // Every value has both components at 12 or below. Nothing here can decide.
    return {
      format: null,
      status: 'ambiguous',
      parsedCount: 0,
      totalCount: considered,
      example: ambiguousExample,
    };
  }

  return { format: null, status: 'unrecognised', parsedCount: 0, totalCount: considered };
};

/**
 * Parse one value under a known column format.
 *
 * Returns null rather than an Invalid Date, so a caller cannot accidentally
 * propagate NaN through arithmetic.
 */
export const parseDateValue = (value: unknown, format: DateFormat): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = asText(value);
  if (text === null) return null;

  const iso = parseIso(text);
  if (iso) return iso;

  const parts = splitNumeric(text);
  if (!parts) return null;

  if (format === 'monthFirst') {
    return makeUtcDate(parts.year, parts.first, parts.second);
  }
  if (format === 'dayFirst') {
    return makeUtcDate(parts.year, parts.second, parts.first);
  }
  // Under 'iso', a slash-separated value has no agreed reading; refuse it
  // rather than pick one.
  return null;
};

export interface DateColumnSummary {
  inference: DateFormatInference;
  /** The format actually applied, after any caller-supplied fallback. */
  appliedFormat: DateFormat | null;
  min: Date | null;
  max: Date | null;
  parsed: number;
  failed: number;
}

/**
 * Summarise a column of dates under an agreed format.
 *
 * `fallback` is used only when the column is genuinely ambiguous. Passing one
 * is a product decision; the summary still carries the original inference so
 * the caller can tell the user what was assumed.
 */
export const summariseDateColumn = (
  values: unknown[],
  fallback?: DateFormat
): DateColumnSummary => {
  const inference = inferDateFormat(values);
  const appliedFormat =
    inference.format ?? (inference.status === 'ambiguous' ? (fallback ?? null) : null);

  if (!appliedFormat) {
    return { inference, appliedFormat: null, min: null, max: null, parsed: 0, failed: 0 };
  }

  let min: Date | null = null;
  let max: Date | null = null;
  let parsed = 0;
  let failed = 0;

  for (const raw of values) {
    if (asText(raw) === null && !(raw instanceof Date)) continue;
    const date = parseDateValue(raw, appliedFormat);
    if (!date) {
      failed += 1;
      continue;
    }
    parsed += 1;
    if (!min || date.getTime() < min.getTime()) min = date;
    if (!max || date.getTime() > max.getTime()) max = date;
  }

  return { inference, appliedFormat, min, max, parsed, failed };
};
