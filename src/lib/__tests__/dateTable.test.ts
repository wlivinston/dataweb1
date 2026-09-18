import { describe, it, expect } from 'vitest';
import {
  generateDateTable,
  fiscalPeriodOf,
  isoWeek,
  toDateKey,
  DATE_TABLE_COLUMNS,
} from '../semantic/dateTable';

const utc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('isoWeek', () => {
  /**
   * Goldens are ISO 8601 facts, checked against the calendar by hand rather
   * than captured from this implementation.
   */
  it('puts 2025-12-29 in week 1 of 2026, not week 53 of 2025', () => {
    // The week-year differs from the calendar year at the boundary. Grouping
    // by calendar Year would split this week across two buckets.
    expect(isoWeek(utc('2025-12-29'))).toEqual({ week: 1, year: 2026 });
  });

  it('puts 2021-01-01 in week 53 of 2020', () => {
    expect(isoWeek(utc('2021-01-01'))).toEqual({ week: 53, year: 2020 });
  });

  it('starts the year at week 1 when 1 January is a Monday', () => {
    expect(isoWeek(utc('2024-01-01'))).toEqual({ week: 1, year: 2024 });
  });

  it('numbers a mid-year date correctly', () => {
    // 2024-07-01 is the Monday opening ISO week 27.
    expect(isoWeek(utc('2024-07-01'))).toEqual({ week: 27, year: 2024 });
  });
});

describe('fiscalPeriodOf', () => {
  it('treats a January start as the calendar year under either naming', () => {
    expect(fiscalPeriodOf(2024, 3, { startMonth: 1, naming: 'endYear' })).toEqual({
      year: 2024,
      quarter: 1,
      month: 3,
    });
    expect(fiscalPeriodOf(2024, 3, { startMonth: 1, naming: 'startYear' })).toEqual({
      year: 2024,
      quarter: 1,
      month: 3,
    });
  });

  it('names a July fiscal year by its ending year when asked', () => {
    const fiscal = { startMonth: 7, naming: 'endYear' as const };
    // Jul 2024 - Jun 2025 is FY2025. Both ends must agree.
    expect(fiscalPeriodOf(2024, 7, fiscal)).toEqual({ year: 2025, quarter: 1, month: 1 });
    expect(fiscalPeriodOf(2025, 6, fiscal)).toEqual({ year: 2025, quarter: 4, month: 12 });
    // The day before the year opens belongs to the prior fiscal year.
    expect(fiscalPeriodOf(2024, 6, fiscal)).toEqual({ year: 2024, quarter: 4, month: 12 });
  });

  it('names the same July fiscal year by its starting year when asked', () => {
    const fiscal = { startMonth: 7, naming: 'startYear' as const };
    expect(fiscalPeriodOf(2024, 7, fiscal)).toEqual({ year: 2024, quarter: 1, month: 1 });
    expect(fiscalPeriodOf(2025, 6, fiscal)).toEqual({ year: 2024, quarter: 4, month: 12 });
  });

  it('handles an April start, as used across much of the public sector', () => {
    const fiscal = { startMonth: 4, naming: 'endYear' as const };
    expect(fiscalPeriodOf(2024, 4, fiscal)).toEqual({ year: 2025, quarter: 1, month: 1 });
    expect(fiscalPeriodOf(2024, 3, fiscal)).toEqual({ year: 2024, quarter: 4, month: 12 });
    expect(fiscalPeriodOf(2024, 10, fiscal)).toEqual({ year: 2025, quarter: 3, month: 7 });
  });

  it('assigns every month of a fiscal year exactly once', () => {
    const fiscal = { startMonth: 7, naming: 'endYear' as const };
    const assigned = new Set<number>();
    for (let offset = 0; offset < 12; offset += 1) {
      const month = ((6 + offset) % 12) + 1;
      const year = offset < 6 ? 2024 : 2025;
      const period = fiscalPeriodOf(year, month, fiscal);
      expect(period.year).toBe(2025);
      assigned.add(period.month);
    }
    expect([...assigned].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('generateDateTable', () => {
  it('produces one row per day, inclusive of both ends', () => {
    const rows = generateDateTable(utc('2024-01-01'), utc('2024-01-31'));
    expect(rows).toHaveLength(31);
    expect(rows[0].Date).toBe('2024-01-01');
    expect(rows[30].Date).toBe('2024-01-31');
  });

  it('covers a leap year with 366 contiguous days', () => {
    const rows = generateDateTable(utc('2024-01-01'), utc('2024-12-31'));
    expect(rows).toHaveLength(366);
    expect(rows.some(r => r.Date === '2024-02-29')).toBe(true);
  });

  it('has no gaps and no duplicates, which is the whole point of a date table', () => {
    const rows = generateDateTable(utc('2023-11-15'), utc('2024-03-10'));
    const keys = rows.map(r => r.Date);
    expect(new Set(keys).size).toBe(keys.length);

    for (let i = 1; i < rows.length; i += 1) {
      const previous = new Date(`${rows[i - 1].Date}T00:00:00.000Z`).getTime();
      const current = new Date(`${rows[i].Date}T00:00:00.000Z`).getTime();
      expect(current - previous).toBe(86_400_000);
    }
  });

  it('runs behind UTC, or the drift tests below prove nothing', () => {
    // vitest.config.ts pins TZ. Two ways this test could go vacuous:
    //
    //   - Under UTC, local and UTC getters are identical.
    //   - Under an offset AHEAD of UTC, the midnight-UTC instants held
    //     internally render as afternoon on the same local day, so local
    //     getters still yield the correct calendar date.
    //
    // Only a zone behind UTC exercises the bug. getTimezoneOffset returns
    // positive minutes for those.
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);
  });

  it('does not drift across a timezone boundary', () => {
    // Two instants, one near each end of the UTC day, so the local calendar
    // date differs from the UTC one whichever side of Greenwich TZ sits.
    const earlyInDay = generateDateTable(
      new Date('2024-03-01T00:30:00.000Z'),
      new Date('2024-03-01T00:30:00.000Z')
    );
    const lateInDay = generateDateTable(
      new Date('2024-03-01T23:30:00.000Z'),
      new Date('2024-03-01T23:30:00.000Z')
    );

    for (const rows of [earlyInDay, lateInDay]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].Date).toBe('2024-03-01');
      expect(rows[0].Month).toBe(3);
      expect(rows[0].Day).toBe(1);
      expect(rows[0].MonthEnd).toBe('2024-03-31');
    }
  });

  it('keeps toDateKey on the UTC calendar day for both ends of the day', () => {
    expect(toDateKey(new Date('2024-03-01T00:30:00.000Z'))).toBe('2024-03-01');
    expect(toDateKey(new Date('2024-03-01T23:30:00.000Z'))).toBe('2024-03-01');
  });

  it('labels weekdays from a known calendar', () => {
    const rows = generateDateTable(utc('2024-01-01'), utc('2024-01-07'));
    expect(rows.map(r => r.DayName)).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    expect(rows.map(r => r.IsWeekend)).toEqual([
      false, false, false, false, false, true, true,
    ]);
  });

  it('counts the day of year through a leap February', () => {
    const rows = generateDateTable(utc('2024-01-01'), utc('2024-12-31'));
    expect(rows.find(r => r.Date === '2024-03-01')?.DayOfYear).toBe(61);
    expect(rows[365].DayOfYear).toBe(366);

    const nonLeap = generateDateTable(utc('2023-01-01'), utc('2023-12-31'));
    expect(nonLeap.find(r => r.Date === '2023-03-01')?.DayOfYear).toBe(60);
    expect(nonLeap).toHaveLength(365);
  });

  it('reports month boundaries, including a short February', () => {
    const rows = generateDateTable(utc('2024-02-10'), utc('2024-02-10'));
    expect(rows[0].MonthStart).toBe('2024-02-01');
    expect(rows[0].MonthEnd).toBe('2024-02-29');

    const nonLeap = generateDateTable(utc('2023-02-10'), utc('2023-02-10'));
    expect(nonLeap[0].MonthEnd).toBe('2023-02-28');
  });

  it('exposes every column it advertises', () => {
    const rows = generateDateTable(utc('2024-05-01'), utc('2024-05-01'));
    for (const column of DATE_TABLE_COLUMNS) {
      expect(rows[0]).toHaveProperty(column);
      expect(rows[0][column]).toBeDefined();
    }
  });

  it('pads a partial calendar year out to whole years', () => {
    const rows = generateDateTable(utc('2024-03-15'), utc('2024-05-20'), {
      padToFullYears: true,
    });
    expect(rows[0].Date).toBe('2024-01-01');
    expect(rows[rows.length - 1].Date).toBe('2024-12-31');
    expect(rows).toHaveLength(366);
  });

  it('pads to fiscal boundaries, not calendar ones, for a July start', () => {
    const rows = generateDateTable(utc('2024-03-15'), utc('2024-05-20'), {
      fiscal: { startMonth: 7, naming: 'endYear' },
      padToFullYears: true,
    });
    // March 2024 sits in FY2024, which runs Jul 2023 - Jun 2024.
    expect(rows[0].Date).toBe('2023-07-01');
    expect(rows[rows.length - 1].Date).toBe('2024-06-30');
    expect(rows[0].FiscalYear).toBe(2024);
    expect(rows[rows.length - 1].FiscalYear).toBe(2024);
  });

  it('pads to fiscal boundaries under start-year naming too', () => {
    const rows = generateDateTable(utc('2024-08-15'), utc('2024-09-10'), {
      fiscal: { startMonth: 7, naming: 'startYear' },
      padToFullYears: true,
    });
    expect(rows[0].Date).toBe('2024-07-01');
    expect(rows[rows.length - 1].Date).toBe('2025-06-30');
  });

  it('gives a padded fiscal table exactly one of each fiscal period', () => {
    const rows = generateDateTable(utc('2024-03-15'), utc('2024-05-20'), {
      fiscal: { startMonth: 7, naming: 'endYear' },
      padToFullYears: true,
    });
    const fiscalMonths = new Set(rows.map(r => r.FiscalMonth));
    const fiscalQuarters = new Set(rows.map(r => r.FiscalQuarter));
    const fiscalYears = new Set(rows.map(r => r.FiscalYear));

    expect(fiscalMonths.size).toBe(12);
    expect(fiscalQuarters.size).toBe(4);
    expect(fiscalYears.size).toBe(1);
  });

  it('keeps the week-year separate from the calendar year', () => {
    const rows = generateDateTable(utc('2025-12-29'), utc('2025-12-31'));
    expect(rows[0].Year).toBe(2025);
    expect(rows[0].WeekYear).toBe(2026);
    expect(rows[0].WeekOfYear).toBe(1);
  });

  it('rejects a reversed range rather than returning nothing', () => {
    expect(() => generateDateTable(utc('2024-05-01'), utc('2024-01-01'))).toThrow(
      /`from` is after `to`/
    );
  });

  it('rejects an invalid date', () => {
    expect(() => generateDateTable(new Date('nonsense'), utc('2024-01-01'))).toThrow(
      /not a valid date/
    );
  });

  it('rejects an out-of-range fiscal start month', () => {
    expect(() =>
      generateDateTable(utc('2024-01-01'), utc('2024-01-02'), { fiscal: { startMonth: 13 } })
    ).toThrow(/from 1 to 12/);
  });

  it('refuses a range large enough to exhaust memory', () => {
    // A stray year like 9999 in a source column would otherwise allocate
    // millions of rows before anything noticed.
    expect(() => generateDateTable(utc('2024-01-01'), utc('9999-01-01'))).toThrow(
      /exceeds the .* row limit/
    );
  });
});

describe('toDateKey', () => {
  it('pads month and day so keys sort lexically', () => {
    expect(toDateKey(utc('2024-01-05'))).toBe('2024-01-05');
    expect(toDateKey(utc('2024-11-25'))).toBe('2024-11-25');
  });
});
