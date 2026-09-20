import { describe, it, expect } from 'vitest';
import {
  inferDateFormat,
  parseDateValue,
  summariseDateColumn,
} from '../semantic/dates';

const key = (date: Date | null): string | null =>
  date
    ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
        date.getUTCDate()
      ).padStart(2, '0')}`
    : null;

describe('inferDateFormat', () => {
  it('recognises ISO without ambiguity', () => {
    const result = inferDateFormat(['2024-03-15', '2024-04-01', '2024-12-31']);
    expect(result.format).toBe('iso');
    expect(result.status).toBe('certain');
    expect(result.parsedCount).toBe(3);
  });

  it('settles on day-first from a single value whose day exceeds 12', () => {
    // 15 cannot be a month, so the whole column reads day-first - including
    // the rows that would otherwise be ambiguous.
    const result = inferDateFormat(['03/04/2024', '15/03/2024', '01/02/2024']);
    expect(result.format).toBe('dayFirst');
    expect(result.status).toBe('certain');
    expect(result.example).toBe('15/03/2024');
  });

  it('settles on month-first from a second component exceeding 12', () => {
    const result = inferDateFormat(['03/04/2024', '03/15/2024', '01/02/2024']);
    expect(result.format).toBe('monthFirst');
    expect(result.status).toBe('certain');
  });

  it('reports ambiguity instead of guessing', () => {
    // Every value is readable both ways. Picking one silently would move
    // 3 April to 4 March and change every monthly total.
    const result = inferDateFormat(['03/04/2024', '01/02/2024', '12/11/2024']);
    expect(result.format).toBeNull();
    expect(result.status).toBe('ambiguous');
    expect(result.example).toBe('03/04/2024');
  });

  it('reports a column that demands both readings as inconsistent', () => {
    const result = inferDateFormat(['15/03/2024', '03/15/2024']);
    expect(result.format).toBeNull();
    expect(result.status).toBe('inconsistent');
    expect(result.example).toMatch(/cannot both be right/);
  });

  it('does not treat a same-value date as ambiguous evidence', () => {
    // 05/05/2024 means the same thing either way, so it is no example of a
    // meaning-changing ambiguity even though it parses both ways.
    const result = inferDateFormat(['05/05/2024', '07/07/2024']);
    expect(result.status).toBe('ambiguous');
    expect(result.example).toBeUndefined();
  });

  it('reports a non-date column as unrecognised', () => {
    const result = inferDateFormat(['Accra', 'Kumasi', 'Tamale']);
    expect(result.format).toBeNull();
    expect(result.status).toBe('unrecognised');
  });

  it('ignores blanks rather than counting them as failures', () => {
    const result = inferDateFormat(['2024-03-15', '', null, undefined, '   ', '2024-04-01']);
    expect(result.format).toBe('iso');
    expect(result.totalCount).toBe(2);
  });

  it('accepts Date objects as already resolved', () => {
    const result = inferDateFormat([new Date('2024-03-15T00:00:00Z')]);
    expect(result.format).toBe('iso');
    expect(result.status).toBe('certain');
  });

  it('handles an empty column', () => {
    expect(inferDateFormat([]).status).toBe('unrecognised');
    expect(inferDateFormat([null, '']).status).toBe('unrecognised');
  });

  it('does not let an impossible date decide the format', () => {
    // 31/02 is not a real day under either reading, so it supplies no
    // evidence and must not be mistaken for day-first proof.
    const result = inferDateFormat(['31/02/2024', '01/02/2024']);
    expect(result.status).toBe('ambiguous');
  });
});

describe('parseDateValue', () => {
  it('reads the same string differently under each format', () => {
    // The entire reason this module exists.
    expect(key(parseDateValue('03/04/2024', 'dayFirst'))).toBe('2024-04-03');
    expect(key(parseDateValue('03/04/2024', 'monthFirst'))).toBe('2024-03-04');
  });

  it('parses ISO regardless of the column format', () => {
    expect(key(parseDateValue('2024-03-15', 'dayFirst'))).toBe('2024-03-15');
    expect(key(parseDateValue('2024-03-15', 'monthFirst'))).toBe('2024-03-15');
  });

  it('refuses a slash-separated value in an ISO column', () => {
    // No agreed reading, so returning either would be a coin flip.
    expect(parseDateValue('03/04/2024', 'iso')).toBeNull();
  });

  it('rejects a day that does not exist rather than rolling it over', () => {
    // Date.UTC turns 31 February into 2 March. That must not reach the model.
    expect(parseDateValue('31/02/2024', 'dayFirst')).toBeNull();
    expect(parseDateValue('2024-02-30', 'iso')).toBeNull();
    expect(parseDateValue('2023-02-29', 'iso')).toBeNull();
  });

  it('accepts 29 February in a leap year', () => {
    expect(key(parseDateValue('2024-02-29', 'iso'))).toBe('2024-02-29');
    expect(key(parseDateValue('29/02/2024', 'dayFirst'))).toBe('2024-02-29');
  });

  it('pivots two-digit years at 69', () => {
    expect(key(parseDateValue('01/01/68', 'dayFirst'))).toBe('2068-01-01');
    expect(key(parseDateValue('01/01/69', 'dayFirst'))).toBe('1969-01-01');
    expect(key(parseDateValue('01/01/99', 'dayFirst'))).toBe('1999-01-01');
  });

  it('accepts dots and dashes as separators', () => {
    expect(key(parseDateValue('15.03.2024', 'dayFirst'))).toBe('2024-03-15');
    expect(key(parseDateValue('15-03-2024', 'dayFirst'))).toBe('2024-03-15');
  });

  it('keeps an ISO datetime on its UTC calendar day', () => {
    expect(key(parseDateValue('2024-03-15T23:45:00Z', 'iso'))).toBe('2024-03-15');
    expect(key(parseDateValue('2024-03-15T00:15:00Z', 'iso'))).toBe('2024-03-15');
  });

  it('returns null instead of an Invalid Date', () => {
    // An Invalid Date would propagate NaN through every downstream sum.
    expect(parseDateValue('not a date', 'iso')).toBeNull();
    expect(parseDateValue(null, 'iso')).toBeNull();
    expect(parseDateValue(undefined, 'iso')).toBeNull();
    expect(parseDateValue('', 'iso')).toBeNull();
    expect(parseDateValue(new Date('nonsense'), 'iso')).toBeNull();
  });
});

describe('summariseDateColumn', () => {
  it('reports the range under the inferred format', () => {
    const summary = summariseDateColumn(['15/03/2024', '01/02/2024', '28/12/2024']);
    expect(summary.appliedFormat).toBe('dayFirst');
    expect(key(summary.min)).toBe('2024-02-01');
    expect(key(summary.max)).toBe('2024-12-28');
    expect(summary.parsed).toBe(3);
    expect(summary.failed).toBe(0);
  });

  it('produces a different range for the same strings read month-first', () => {
    const values = ['03/04/2024', '01/02/2024'];
    const dayFirst = summariseDateColumn(values, 'dayFirst');
    const monthFirst = summariseDateColumn(values, 'monthFirst');

    expect(key(dayFirst.min)).toBe('2024-02-01');
    expect(key(dayFirst.max)).toBe('2024-04-03');
    expect(key(monthFirst.min)).toBe('2024-01-02');
    expect(key(monthFirst.max)).toBe('2024-03-04');
  });

  it('applies a fallback only when the column is ambiguous', () => {
    const ambiguous = summariseDateColumn(['03/04/2024', '01/02/2024'], 'dayFirst');
    expect(ambiguous.inference.status).toBe('ambiguous');
    expect(ambiguous.appliedFormat).toBe('dayFirst');

    // Evidence beats the fallback: a 15 in the first position is day-first
    // whatever the caller would have preferred.
    const decided = summariseDateColumn(['15/03/2024', '01/02/2024'], 'monthFirst');
    expect(decided.appliedFormat).toBe('dayFirst');
  });

  it('refuses to apply a fallback to an inconsistent column', () => {
    // Dirty data is a different problem from ambiguous data, and a fallback
    // would paper over half the rows being wrong.
    const summary = summariseDateColumn(['15/03/2024', '03/15/2024'], 'dayFirst');
    expect(summary.inference.status).toBe('inconsistent');
    expect(summary.appliedFormat).toBeNull();
    expect(summary.min).toBeNull();
  });

  it('keeps the original inference alongside what was applied', () => {
    const summary = summariseDateColumn(['03/04/2024'], 'dayFirst');
    expect(summary.inference.status).toBe('ambiguous');
    expect(summary.inference.format).toBeNull();
    expect(summary.appliedFormat).toBe('dayFirst');
  });

  it('counts values that fail to parse under the applied format', () => {
    const summary = summariseDateColumn(['2024-03-15', '2024-13-01', '2024-02-30']);
    expect(summary.parsed).toBe(1);
    expect(summary.failed).toBe(2);
  });
});
