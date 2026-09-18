/**
 * Generate a contiguous date table.
 *
 * Time intelligence is impossible without one. DAX functions like
 * SAMEPERIODLASTYEAR or DATESYTD need a table with one row per day and no
 * gaps: if the user's data skips a month, "the previous month" has no meaning
 * to look up. So the model generates its own rather than trusting the dates
 * present in the fact table.
 *
 * Everything here is computed in UTC. Using local time would shift a
 * `2024-03-01` string by a day for anyone west of Greenwich, silently moving
 * rows into the wrong month.
 */

/** Which calendar year a fiscal year takes its name from. */
export type FiscalYearNaming = 'startYear' | 'endYear';

export interface FiscalConfig {
  /** Month the fiscal year opens, 1-12. 1 means fiscal == calendar. */
  startMonth: number;
  /**
   * Whether FY is named for the year it starts or ends. A July start named
   * by end year makes Jul 2024 - Jun 2025 into "FY2025"; named by start year
   * it is "FY2024". Both conventions are in real use, so this is explicit
   * rather than assumed.
   */
  naming: FiscalYearNaming;
}

export const DEFAULT_FISCAL: FiscalConfig = { startMonth: 1, naming: 'endYear' };

export interface DateTableRow {
  Date: string;
  Year: number;
  Quarter: number;
  QuarterName: string;
  Month: number;
  MonthName: string;
  MonthShort: string;
  YearMonth: string;
  YearQuarter: string;
  Day: number;
  DayOfYear: number;
  DayOfWeek: number;
  DayName: string;
  IsWeekend: boolean;
  WeekOfYear: number;
  WeekYear: number;
  MonthStart: string;
  MonthEnd: string;
  FiscalYear: number;
  FiscalYearName: string;
  FiscalQuarter: number;
  FiscalQuarterName: string;
  FiscalMonth: number;
  [key: string]: string | number | boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Monday-first, matching the ISO day numbering used for DayOfWeek. */
const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

const MS_PER_DAY = 86_400_000;

const utc = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

/** ISO 8601 day number: Monday is 1, Sunday is 7. */
const isoDayOfWeek = (date: Date): number => date.getUTCDay() || 7;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const toDateKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

/**
 * ISO 8601 week number and its week-year.
 *
 * The week-year is not always the calendar year: 2025-12-29 falls in week 1
 * of 2026. Grouping by (Year, WeekOfYear) instead of (WeekYear, WeekOfYear)
 * would split that week across two buckets.
 */
export const isoWeek = (date: Date): { week: number; year: number } => {
  const target = utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  // Shift to the Thursday of this week; the ISO year is whichever year owns it.
  target.setUTCDate(target.getUTCDate() + 4 - isoDayOfWeek(target));
  const year = target.getUTCFullYear();
  const yearStart = utc(year, 1, 1);
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return { week, year };
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export interface FiscalPeriod {
  year: number;
  quarter: number;
  month: number;
}

/**
 * Map a calendar date onto its fiscal period.
 *
 * Exported because measures need it outside the date table - a fiscal YTD
 * filter has to agree with the table's own FiscalYear column.
 */
export const fiscalPeriodOf = (
  year: number,
  month: number,
  fiscal: FiscalConfig
): FiscalPeriod => {
  const startMonth = fiscal.startMonth;
  const fiscalMonth = ((month - startMonth + 12) % 12) + 1;
  const fiscalQuarter = Math.ceil(fiscalMonth / 3);

  let fiscalYear: number;
  if (startMonth === 1) {
    // A January start is the calendar year under either naming convention.
    fiscalYear = year;
  } else if (fiscal.naming === 'endYear') {
    fiscalYear = month >= startMonth ? year + 1 : year;
  } else {
    fiscalYear = month >= startMonth ? year : year - 1;
  }

  return { year: fiscalYear, quarter: fiscalQuarter, month: fiscalMonth };
};

const normaliseFiscal = (fiscal: Partial<FiscalConfig> | undefined): FiscalConfig => {
  const startMonth = fiscal?.startMonth ?? DEFAULT_FISCAL.startMonth;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError(
      `Fiscal year start month must be an integer from 1 to 12, received ${startMonth}.`
    );
  }
  return { startMonth, naming: fiscal?.naming ?? DEFAULT_FISCAL.naming };
};

/** Guard against a bad range silently allocating an enormous array. */
const MAX_DATE_TABLE_ROWS = 200 * 366;

export interface DateTableOptions {
  fiscal?: Partial<FiscalConfig>;
  /** Extend the range to whole calendar years, so YTD comparisons are complete. */
  padToFullYears?: boolean;
}

/**
 * Build one row per day from `from` to `to` inclusive.
 *
 * `padToFullYears` matters for year-over-year work: if the data starts in
 * March, an unpadded table has no January row, and a January YTD filter
 * silently returns nothing rather than zero.
 */
export const generateDateTable = (
  from: Date,
  to: Date,
  options: DateTableOptions = {}
): DateTableRow[] => {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new RangeError('generateDateTable: `from` is not a valid date.');
  }
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new RangeError('generateDateTable: `to` is not a valid date.');
  }
  if (from.getTime() > to.getTime()) {
    throw new RangeError('generateDateTable: `from` is after `to`.');
  }

  const fiscal = normaliseFiscal(options.fiscal);

  let start = utc(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate());
  let end = utc(to.getUTCFullYear(), to.getUTCMonth() + 1, to.getUTCDate());

  if (options.padToFullYears) {
    // Pad to fiscal year boundaries, which are calendar boundaries when
    // startMonth is 1.
    const startFiscal = fiscalPeriodOf(start.getUTCFullYear(), start.getUTCMonth() + 1, fiscal);
    const endFiscal = fiscalPeriodOf(end.getUTCFullYear(), end.getUTCMonth() + 1, fiscal);
    const openingYear =
      fiscal.startMonth === 1 || fiscal.naming === 'startYear'
        ? startFiscal.year
        : startFiscal.year - 1;
    start = utc(openingYear, fiscal.startMonth, 1);

    const closingYear =
      fiscal.startMonth === 1
        ? endFiscal.year
        : fiscal.naming === 'endYear'
          ? endFiscal.year
          : endFiscal.year + 1;
    const closingMonth = fiscal.startMonth === 1 ? 12 : fiscal.startMonth - 1;
    end = utc(closingYear, closingMonth, daysInMonth(closingYear, closingMonth));
  }

  const span = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (span > MAX_DATE_TABLE_ROWS) {
    throw new RangeError(
      `generateDateTable: range spans ${span} days, which exceeds the ` +
        `${MAX_DATE_TABLE_ROWS} row limit. Check the source column for a stray date.`
    );
  }

  const rows: DateTableRow[] = [];
  const cursor = new Date(start.getTime());

  for (let i = 0; i < span; i += 1) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const quarter = Math.ceil(month / 3);
    const dayOfWeek = isoDayOfWeek(cursor);
    const week = isoWeek(cursor);
    const fiscalPeriod = fiscalPeriodOf(year, month, fiscal);
    const yearStart = utc(year, 1, 1);
    const lastDay = daysInMonth(year, month);

    rows.push({
      Date: toDateKey(cursor),
      Year: year,
      Quarter: quarter,
      QuarterName: `Q${quarter}`,
      Month: month,
      MonthName: MONTH_NAMES[month - 1],
      MonthShort: MONTH_NAMES[month - 1].slice(0, 3),
      YearMonth: `${year}-${pad2(month)}`,
      YearQuarter: `${year}-Q${quarter}`,
      Day: day,
      DayOfYear: Math.floor((cursor.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1,
      DayOfWeek: dayOfWeek,
      DayName: DAY_NAMES[dayOfWeek - 1],
      IsWeekend: dayOfWeek >= 6,
      WeekOfYear: week.week,
      WeekYear: week.year,
      MonthStart: toDateKey(utc(year, month, 1)),
      MonthEnd: toDateKey(utc(year, month, lastDay)),
      FiscalYear: fiscalPeriod.year,
      FiscalYearName: `FY${fiscalPeriod.year}`,
      FiscalQuarter: fiscalPeriod.quarter,
      FiscalQuarterName: `FY${fiscalPeriod.year} Q${fiscalPeriod.quarter}`,
      FiscalMonth: fiscalPeriod.month,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows;
};

/** Column names the generated table always provides, for role assignment. */
export const DATE_TABLE_COLUMNS: string[] = [
  'Date', 'Year', 'Quarter', 'QuarterName', 'Month', 'MonthName', 'MonthShort',
  'YearMonth', 'YearQuarter', 'Day', 'DayOfYear', 'DayOfWeek', 'DayName',
  'IsWeekend', 'WeekOfYear', 'WeekYear', 'MonthStart', 'MonthEnd',
  'FiscalYear', 'FiscalYearName', 'FiscalQuarter', 'FiscalQuarterName', 'FiscalMonth',
];
