import { describe, it, expect } from 'vitest';
import { evaluateScalar, evaluateDax } from '../dax/evaluate';
import { buildSemanticModel } from '../semantic/model';
import { makeDataset } from './fixtures';
import { isTable } from '../dax/value';
import type { SemanticModel } from '../semantic/types';

/**
 * Two years of monthly sales, one row per month, amount = month number * 10
 * in 2023 and * 100 in 2024. That makes every period total checkable in the
 * head:
 *
 *   2023  Jan 10  Feb 20  Mar 30 ... Dec 120    year 780
 *   2024  Jan 100 Feb 200 Mar 300 ... Dec 1200  year 7800
 *
 *   2024 Q1 = 600      2023 Q1 = 60
 *   2024 Jan-Mar YTD at 15 March = 600
 */
const rows = [] as Record<string, unknown>[];
for (const year of [2023, 2024]) {
  for (let month = 1; month <= 12; month += 1) {
    rows.push({
      OrderID: `${year}-${month}`,
      Amount: month * (year === 2023 ? 10 : 100),
      OrderDate: `${year}-${String(month).padStart(2, '0')}-15`,
    });
  }
}

let cached: SemanticModel | null = null;
const model = (): SemanticModel => {
  if (!cached) {
    cached = buildSemanticModel(
      [
        makeDataset(
          rows,
          [
            { name: 'OrderID', type: 'string' },
            { name: 'Amount', type: 'number' },
            { name: 'OrderDate', type: 'date' },
          ],
          { id: 'ds-sales', name: 'Sales' }
        ),
      ],
      {
        measures: [{ name: 'Total Revenue', expression: 'SUM(Sales[Amount])' }],
      }
    );
  }
  return cached;
};

const scalar = (source: string) => evaluateScalar(source, model());

/** How many rows of the calendar an expression returns. */
const dateCount = (source: string): number => {
  const value = evaluateDax(source, model());
  if (!isTable(value)) throw new Error(`expected a table, got ${String(value)}`);
  return value.rows.length;
};

describe('the fixture', () => {
  it('totals as expected before any time intelligence', () => {
    expect(scalar('SUM(Sales[Amount])')).toBe(8580); // 780 + 7800
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Year] = 2024)')).toBe(7800);
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Year] = 2023)')).toBe(780);
  });
});

describe('DATESYTD and TOTALYTD', () => {
  it('accumulates from the start of the year to the latest date in context', () => {
    // Jan + Feb + Mar of 2024.
    expect(
      scalar('CALCULATE(TOTALYTD(SUM(Sales[Amount]), Date[Date]), Date[Year] = 2024, Date[Month] <= 3)')
    ).toBe(600);
  });

  it('reaches the full year when the whole year is in context', () => {
    expect(
      scalar('CALCULATE(TOTALYTD(SUM(Sales[Amount]), Date[Date]), Date[Year] = 2024)')
    ).toBe(7800);
  });

  it('does not reach back into the prior year', () => {
    // The point of YTD: January 2024 must not pick up December 2023.
    expect(
      scalar('CALCULATE(TOTALYTD(SUM(Sales[Amount]), Date[Date]), Date[Year] = 2024, Date[Month] = 1)')
    ).toBe(100);
  });

  it('returns the same set through DATESYTD inside CALCULATE', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), DATESYTD(Date[Date])), Date[Year] = 2024, Date[Month] <= 3)'
      )
    ).toBe(600);
  });

  it('opens the year where the year-end argument says', () => {
    // A 30 June year end puts March 2024 in the year that began July 2023,
    // so YTD at March 2024 spans Jul-Dec 2023 plus Jan-Mar 2024.
    // 2023 Jul..Dec = 70+80+90+100+110+120 = 570; 2024 Jan..Mar = 600.
    expect(
      scalar(
        'CALCULATE(TOTALYTD(SUM(Sales[Amount]), Date[Date], "6/30"), Date[Year] = 2024, Date[Month] <= 3)'
      )
    ).toBe(1170);
  });

  it('refuses a year end that could be read either way', () => {
    expect(() =>
      scalar('CALCULATE(TOTALYTD(SUM(Sales[Amount]), Date[Date], "6/3"), Date[Year] = 2024)')
    ).toThrow(/not a year end this can read/);
  });

  it('accumulates by quarter and month too', () => {
    // Q1 2024 to the end of February: Jan + Feb.
    expect(
      scalar('CALCULATE(TOTALQTD(SUM(Sales[Amount]), Date[Date]), Date[Year] = 2024, Date[Month] <= 2)')
    ).toBe(300);
    // One row per month, so month to date is just that month.
    expect(
      scalar('CALCULATE(TOTALMTD(SUM(Sales[Amount]), Date[Date]), Date[Year] = 2024, Date[Month] = 3)')
    ).toBe(300);
  });
});

describe('SAMEPERIODLASTYEAR', () => {
  it('returns the matching period a year earlier', () => {
    // March 2024 is 300; March 2023 is 30.
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Date[Date])), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(30);
  });

  it('works across a whole year', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Date[Date])), Date[Year] = 2024)'
      )
    ).toBe(780);
  });

  it('supports a year-over-year growth measure', () => {
    // The shape every sales report needs: (this year - last year) / last year.
    const growth =
      'VAR Current = SUM(Sales[Amount]) ' +
      'VAR Prior = CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Date[Date])) ' +
      'RETURN DIVIDE(Current - Prior, Prior)';
    // March: (300 - 30) / 30 = 9.
    expect(scalar(`CALCULATE(${growth}, Date[Year] = 2024, Date[Month] = 3)`)).toBe(9);
  });

  it('returns BLANK when there is no prior period', () => {
    // 2023 is the first year, so it has nothing behind it.
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Date[Date])), Date[Year] = 2023)'
      )
    ).toBeNull();
  });

  it('maps 29 February onto 28 February in a common year', () => {
    // The calendar is generated, so the leap day is really there to be moved.
    expect(
      dateCount(
        'CALCULATE(SAMEPERIODLASTYEAR(Date[Date]), Date[Year] = 2024, Date[Month] = 2)'
      )
    ).toBe(28);
  });
});

describe('DATEADD', () => {
  it('shifts by the interval given', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), DATEADD(Date[Date], -1, MONTH)), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(200);
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), DATEADD(Date[Date], -1, YEAR)), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(30);
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), DATEADD(Date[Date], -1, QUARTER)), Date[Year] = 2024, Date[Month] = 4)'
      )
    ).toBe(100);
  });

  it('shifts forwards as well as backwards', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), DATEADD(Date[Date], 1, MONTH)), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(400);
  });

  it('rejects an interval it does not know', () => {
    expect(() =>
      scalar('CALCULATE(SUM(Sales[Amount]), DATEADD(Date[Date], -1, WEEK))')
    ).toThrow(/not an interval/);
  });
});

describe('PREVIOUS* and PARALLELPERIOD', () => {
  it('returns the whole previous month', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), PREVIOUSMONTH(Date[Date])), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(200);
  });

  it('returns the whole previous quarter', () => {
    // Q1 2024 selected, so the previous quarter is Q4 2023 = 100+110+120.
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), PREVIOUSQUARTER(Date[Date])), Date[Year] = 2024, Date[Quarter] = 1)'
      )
    ).toBe(330);
  });

  it('returns the whole previous year', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), PREVIOUSYEAR(Date[Date])), Date[Year] = 2024)'
      )
    ).toBe(780);
  });

  it('returns a whole period, unlike DATEADD which returns matching days', () => {
    // One month in context, shifted back a year. PARALLELPERIOD widens to the
    // whole year; DATEADD keeps just the matching days.
    expect(
      dateCount(
        'CALCULATE(PARALLELPERIOD(Date[Date], -1, YEAR), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(365);
    expect(
      dateCount(
        'CALCULATE(DATEADD(Date[Date], -1, YEAR), Date[Year] = 2024, Date[Month] = 3)'
      )
    ).toBe(31);
  });
});

describe('DATESINPERIOD, FIRSTDATE and LASTDATE', () => {
  it('finds the first and last date in context', () => {
    expect(scalar('CALCULATE(FIRSTDATE(Date[Date]), Date[Year] = 2024)')).toBe('2024-01-01');
    expect(scalar('CALCULATE(LASTDATE(Date[Date]), Date[Year] = 2024)')).toBe('2024-12-31');
  });

  it('takes a rolling window ending at a date', () => {
    // Three months ending 31 March 2024: Jan, Feb, Mar = 600.
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), DATESINPERIOD(Date[Date], "2024-03-31", -3, MONTH))'
      )
    ).toBe(600);
  });

  it('takes a window running forwards from a date', () => {
    // Three months from 1 January 2024.
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), DATESINPERIOD(Date[Date], "2024-01-01", 3, MONTH))'
      )
    ).toBe(600);
  });

  it('spans exactly the right number of days either way', () => {
    expect(
      dateCount('DATESINPERIOD(Date[Date], "2024-03-31", -3, MONTH)')
    ).toBe(31 + 29 + 31);
    expect(dateCount('DATESINPERIOD(Date[Date], "2024-01-01", 3, MONTH)')).toBe(31 + 29 + 31);
  });

  it('combines with LASTDATE for a rolling total', () => {
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), DATESINPERIOD(Date[Date], LASTDATE(Date[Date]), -3, MONTH))'
      )
    ).toBe(3300); // Oct + Nov + Dec 2024 = 1000 + 1100 + 1200
  });
});

describe('failing loudly', () => {
  it('refuses a column that does not hold dates', () => {
    expect(() => scalar('SUM(Sales[Amount]) + COUNTROWS(DATESYTD(Sales[Amount]))')).toThrow(
      /needs a date column/
    );
  });

  it('names the calendar in the message, so the fix is obvious', () => {
    expect(() => scalar('COUNTROWS(DATESYTD(Sales[OrderID]))')).toThrow(/Date\[Date\]/);
  });

  it('returns an empty set rather than guessing when nothing is in context', () => {
    expect(
      scalar('CALCULATE(SUM(Sales[Amount]), Date[Year] = 1999, DATESYTD(Date[Date]))')
    ).toBeNull();
  });
});
