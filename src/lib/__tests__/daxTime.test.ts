import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  daysInMonth,
  monthBounds,
  parseInterval,
  parseKey,
  parseYearEnd,
  periodBounds,
  quarterBounds,
  shiftDate,
  yearBounds,
  CALENDAR_YEAR_END,
} from '../dax/time';

describe('parseKey', () => {
  it('accepts a canonical key', () => {
    expect(parseKey('2024-03-15')).toEqual({ year: 2024, month: 3, day: 15 });
  });

  it('rejects a day that does not exist', () => {
    expect(parseKey('2024-02-30')).toBeNull();
    expect(parseKey('2023-02-29')).toBeNull();
    expect(parseKey('2024-13-01')).toBeNull();
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseKey('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects anything that is not the canonical form', () => {
    expect(parseKey('15/03/2024')).toBeNull();
    expect(parseKey('2024-3-5')).toBeNull();
    expect(parseKey('')).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });
});

describe('addMonths', () => {
  it('clamps the day to the target month', () => {
    // 31 January plus a month is the end of February, not 2 or 3 March.
    // Without this, every 29th, 30th and 31st lands in the wrong month.
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2024-05-31', 1)).toBe('2024-06-30');
  });

  it('moves a leap day back to 28 February in a common year', () => {
    // What SAMEPERIODLASTYEAR has to do with 29 February.
    expect(addMonths('2024-02-29', -12)).toBe('2023-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('keeps a day that exists in both months', () => {
    expect(addMonths('2024-01-15', 1)).toBe('2024-02-15');
    expect(addMonths('2024-01-15', -1)).toBe('2023-12-15');
  });

  it('crosses years in both directions', () => {
    expect(addMonths('2024-11-15', 3)).toBe('2025-02-15');
    expect(addMonths('2024-02-15', -3)).toBe('2023-11-15');
    expect(addMonths('2024-01-15', -13)).toBe('2022-12-15');
  });
});

describe('shiftDate', () => {
  it('shifts by each supported interval', () => {
    expect(shiftDate('2024-03-15', 1, 'DAY')).toBe('2024-03-16');
    expect(shiftDate('2024-03-15', 1, 'MONTH')).toBe('2024-04-15');
    expect(shiftDate('2024-03-15', 1, 'QUARTER')).toBe('2024-06-15');
    expect(shiftDate('2024-03-15', 1, 'YEAR')).toBe('2025-03-15');
  });

  it('shifts backwards', () => {
    expect(shiftDate('2024-03-15', -1, 'YEAR')).toBe('2023-03-15');
    expect(shiftDate('2024-03-15', -1, 'QUARTER')).toBe('2023-12-15');
  });
});

describe('parseInterval', () => {
  it('accepts the four DAX intervals in any case', () => {
    expect(parseInterval('year')).toBe('YEAR');
    expect(parseInterval('MONTH')).toBe('MONTH');
    expect(parseInterval(' Quarter ')).toBe('QUARTER');
    expect(parseInterval('DAY')).toBe('DAY');
  });

  it('rejects anything else', () => {
    expect(parseInterval('week')).toBeNull();
    expect(parseInterval('')).toBeNull();
  });
});

describe('yearBounds', () => {
  it('gives the calendar year by default', () => {
    expect(yearBounds('2024-03-15', 12, 31)).toEqual({
      start: '2024-01-01',
      end: '2024-12-31',
    });
  });

  it('handles the first and last day of the calendar year', () => {
    expect(yearBounds('2024-01-01', 12, 31)?.start).toBe('2024-01-01');
    expect(yearBounds('2024-12-31', 12, 31)?.end).toBe('2024-12-31');
  });

  it('gives a July-start fiscal year for a 30 June year end', () => {
    // FY runs 1 July to 30 June. March 2024 is in the year ending June 2024.
    expect(yearBounds('2024-03-15', 6, 30)).toEqual({
      start: '2023-07-01',
      end: '2024-06-30',
    });
    // August 2024 is in the next one.
    expect(yearBounds('2024-08-15', 6, 30)).toEqual({
      start: '2024-07-01',
      end: '2025-06-30',
    });
  });

  it('puts the year-end day itself in the closing year, not the next', () => {
    expect(yearBounds('2024-06-30', 6, 30)?.end).toBe('2024-06-30');
    expect(yearBounds('2024-07-01', 6, 30)?.end).toBe('2025-06-30');
  });

  it('survives a February year end across a leap boundary', () => {
    const leap = yearBounds('2024-02-29', 2, 29);
    expect(leap?.end).toBe('2024-02-29');
    // The prior year has no 29 February, so the year opens on 1 March.
    expect(leap?.start).toBe('2023-03-01');
  });
});

describe('quarterBounds and monthBounds', () => {
  it('finds the calendar quarter', () => {
    expect(quarterBounds('2024-02-15')).toEqual({ start: '2024-01-01', end: '2024-03-31' });
    expect(quarterBounds('2024-08-15')).toEqual({ start: '2024-07-01', end: '2024-09-30' });
    expect(quarterBounds('2024-12-31')).toEqual({ start: '2024-10-01', end: '2024-12-31' });
  });

  it('finds the month, including a leap February', () => {
    expect(monthBounds('2024-02-15')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthBounds('2023-02-15')).toEqual({ start: '2023-02-01', end: '2023-02-28' });
  });
});

describe('periodBounds', () => {
  it('returns the whole period containing a date', () => {
    expect(periodBounds('2024-05-15', 'MONTH', CALENDAR_YEAR_END)).toEqual({
      start: '2024-05-01',
      end: '2024-05-31',
    });
    expect(periodBounds('2024-05-15', 'QUARTER', CALENDAR_YEAR_END)).toEqual({
      start: '2024-04-01',
      end: '2024-06-30',
    });
    expect(periodBounds('2024-05-15', 'YEAR', CALENDAR_YEAR_END)).toEqual({
      start: '2024-01-01',
      end: '2024-12-31',
    });
    expect(periodBounds('2024-05-15', 'DAY', CALENDAR_YEAR_END)).toEqual({
      start: '2024-05-15',
      end: '2024-05-15',
    });
  });
});

describe('parseYearEnd', () => {
  it('reads an unambiguous year end', () => {
    // Every year end in real use has a day above 12.
    expect(parseYearEnd('6/30')).toEqual({ month: 6, day: 30 });
    expect(parseYearEnd('12/31')).toEqual({ month: 12, day: 31 });
    expect(parseYearEnd('3-31')).toEqual({ month: 3, day: 31 });
    expect(parseYearEnd('30/6')).toEqual({ month: 6, day: 30 });
  });

  it('refuses one that could be read either way', () => {
    // DAX resolves this by locale, so the same expression means different
    // things on different machines. Refusing beats picking.
    expect(parseYearEnd('6/3')).toBeNull();
    expect(parseYearEnd('1/12')).toBeNull();
  });

  it('refuses a date that does not exist', () => {
    expect(parseYearEnd('2/30')).toBeNull();
    expect(parseYearEnd('nonsense')).toBeNull();
  });
});

describe('daysInMonth', () => {
  it('knows February', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });
});
