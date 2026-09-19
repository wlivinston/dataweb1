import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import {
  executeKPIFormula,
  formatKPIValue,
  calculateTotalYTD,
  calculateTotalQTD,
  calculateTotalMTD,
  calculateSamePeriodLastYear,
  calculateYoYChange,
  calculateRunningTotal,
  calculateQoQChange,
  calculateMoMChange,
  calculateWithContext,
  calculateRANKX,
  calculateLOOKUPVALUE,
} from '../kpiFormulaEngine';
import type { DAXFilterContext } from '../types';

/**
 * Asserts the date column could be read, and returns the value.
 *
 * These functions return null when the dates are ambiguous or mixed, so a
 * caller cannot accidentally print a period total that might be a month
 * out. Every assertion below therefore also asserts that this fixture is
 * readable in the first place.
 */
const readable = <T>(value: T | null, what: string): T => {
  expect(value, `${what}: the date column could not be read`).not.toBeNull();
  return value as T;
};

const salesRows = [
  { date: '2023-02-15', region: 'Accra', rep: 'Ama', amount: 100 },
  { date: '2023-05-20', region: 'Accra', rep: 'Ama', amount: 200 },
  { date: '2023-08-10', region: 'Kumasi', rep: 'Kwesi', amount: 300 },
  { date: '2023-11-05', region: 'Kumasi', rep: 'Kwesi', amount: 400 },
  { date: '2024-02-15', region: 'Accra', rep: 'Ama', amount: 150 },
  { date: '2024-05-20', region: 'Accra', rep: 'Yaa', amount: 250 },
  { date: '2024-08-10', region: 'Kumasi', rep: 'Kwesi', amount: 350 },
  { date: '2024-11-05', region: 'Kumasi', rep: 'Yaa', amount: 450 },
];

const sales = makeDataset(salesRows, [
  { name: 'date', type: 'date' },
  { name: 'region', type: 'string' },
  { name: 'rep', type: 'string' },
  { name: 'amount', type: 'number' },
]);

describe('Base aggregations', () => {
  it('sums, averages and counts a numeric column', () => {
    // 100+200+300+400+150+250+350+450 = 2200
    expect(executeKPIFormula(sales, 'SUM', 'amount')).toBe(2200);
    expect(executeKPIFormula(sales, 'AVERAGE', 'amount')).toBe(275);
    expect(executeKPIFormula(sales, 'COUNT', 'amount')).toBe(8);
    expect(executeKPIFormula(sales, 'COUNTROWS')).toBe(8);
  });

  it('computes MIN, MAX and MEDIAN', () => {
    expect(executeKPIFormula(sales, 'MIN', 'amount')).toBe(100);
    expect(executeKPIFormula(sales, 'MAX', 'amount')).toBe(450);
    // sorted: 100,150,200,250,300,350,400,450 -> (250+300)/2
    expect(executeKPIFormula(sales, 'MEDIAN', 'amount')).toBe(275);
  });

  it('counts distinct values, not rows', () => {
    expect(executeKPIFormula(sales, 'DISTINCTCOUNT', 'region')).toBe(2);
    expect(executeKPIFormula(sales, 'DISTINCTCOUNT', 'rep')).toBe(3);
  });

  it('excludes blanks from COUNT but still counts the rows', () => {
    const withBlanks = makeDataset(
      [{ v: 1 }, { v: null }, { v: '' }, { v: 4 }],
      [{ name: 'v', type: 'number' }]
    );
    expect(executeKPIFormula(withBlanks, 'COUNT', 'v')).toBe(2);
    expect(executeKPIFormula(withBlanks, 'COUNTROWS')).toBe(4);
    expect(executeKPIFormula(withBlanks, 'SUM', 'v')).toBe(5);
  });

  it('returns 0 rather than NaN for an empty dataset', () => {
    const empty = makeDataset([], [{ name: 'v', type: 'number' }]);
    expect(executeKPIFormula(empty, 'SUM', 'v')).toBe(0);
    expect(executeKPIFormula(empty, 'AVERAGE', 'v')).toBe(0);
    expect(executeKPIFormula(empty, 'MEDIAN', 'v')).toBe(0);
  });
});

describe('Time intelligence', () => {
  // All assertions pin an explicit reference date. These functions previously
  // read the wall clock, so the same dataset produced different answers
  // depending on the day the report was run.
  const asOf = new Date('2024-08-15T00:00:00Z');

  it('TOTALYTD sums only the current year up to the reference date', () => {
    // 2024 rows on or before 2024-08-15: 150 + 250 + 350 = 750
    expect(readable(calculateTotalYTD(sales, 'amount', 'date', asOf), 'YTD')).toBe(750);
  });

  it('TOTALYTD excludes future-dated rows in the same year', () => {
    // the 2024-11-05 row (450) must not be counted in an August YTD
    expect(readable(calculateTotalYTD(sales, 'amount', 'date', asOf), 'YTD')).toBeLessThan(
      readable(
        calculateTotalYTD(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z')),
        'YTD year end'
      )
    );
    expect(
      readable(
        calculateTotalYTD(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z')),
        'YTD year end'
      )
    ).toBe(1200);
  });

  it('TOTALQTD covers only the reference quarter', () => {
    // Q3 2024 up to 2024-08-15 -> the 2024-08-10 row only
    expect(readable(calculateTotalQTD(sales, 'amount', 'date', asOf), 'QTD')).toBe(350);
  });

  it('TOTALMTD covers only the reference month', () => {
    expect(readable(calculateTotalMTD(sales, 'amount', 'date', asOf), 'MTD')).toBe(350);
    expect(
      readable(
        calculateTotalMTD(sales, 'amount', 'date', new Date('2024-05-31T00:00:00Z')),
        'MTD May'
      )
    ).toBe(250);
  });

  it('SAMEPERIODLASTYEAR returns the prior year total for the same grain', () => {
    // full prior year 2023: 100+200+300+400 = 1000
    expect(
      readable(calculateSamePeriodLastYear(sales, 'amount', 'date', 'year', asOf), 'SPLY year')
    ).toBe(1000);
    // Q3 2023 -> the 2023-08-10 row
    expect(
      readable(
        calculateSamePeriodLastYear(sales, 'amount', 'date', 'quarter', asOf),
        'SPLY quarter'
      )
    ).toBe(300);
    // August 2023 -> the 2023-08-10 row
    expect(
      readable(calculateSamePeriodLastYear(sales, 'amount', 'date', 'month', asOf), 'SPLY month')
    ).toBe(300);
  });

  it('YoY compares the reference year against the one before it', () => {
    const yoy = readable(
      calculateYoYChange(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z')),
      'YoY'
    );
    expect(yoy.currentYear).toBe(1200); // 150+250+350+450
    expect(yoy.previousYear).toBe(1000); // 100+200+300+400
    expect(yoy.absolute).toBe(200);
    expect(yoy.percentage).toBeCloseTo(20, 6);
  });

  it('YoY reports 0% rather than Infinity when the prior year is empty', () => {
    const singleYear = makeDataset(
      [{ date: '2024-03-01', amount: 500 }],
      [
        { name: 'date', type: 'date' },
        { name: 'amount', type: 'number' },
      ]
    );
    const yoy = readable(
      calculateYoYChange(singleYear, 'amount', 'date', new Date('2024-12-31T00:00:00Z')),
      'YoY single year'
    );
    expect(yoy.previousYear).toBe(0);
    expect(yoy.percentage).toBe(0);
    expect(Number.isFinite(yoy.percentage)).toBe(true);
  });

  it('running total accumulates in date order regardless of row order', () => {
    const shuffled = makeDataset(
      [
        { date: '2024-03-01', amount: 30 },
        { date: '2024-01-01', amount: 10 },
        { date: '2024-02-01', amount: 20 },
      ],
      [
        { name: 'date', type: 'date' },
        { name: 'amount', type: 'number' },
      ]
    );
    expect(calculateRunningTotal(shuffled, 'amount', 'date')).toEqual([10, 30, 60]);
  });
});

describe('CALCULATE (filter context)', () => {
  it('applies a single equality filter before aggregating', () => {
    const filters: DAXFilterContext[] = [{ column: 'region', operator: '=', value: 'Accra' }];
    // Accra rows: 100 + 200 + 150 + 250 = 700
    expect(calculateWithContext(sales, 'SUM', 'amount', filters)).toBe(700);
  });

  it('intersects multiple filters', () => {
    const filters: DAXFilterContext[] = [
      { column: 'region', operator: '=', value: 'Kumasi' },
      { column: 'rep', operator: '=', value: 'Kwesi' },
    ];
    // Kumasi AND Kwesi: 300 + 400 + 350 = 1050 (the 2024 Kumasi/Yaa row is excluded)
    expect(calculateWithContext(sales, 'SUM', 'amount', filters)).toBe(1050);
    // ...and it is strictly narrower than either filter alone.
    expect(calculateWithContext(sales, 'SUM', 'amount', [filters[0]])).toBe(1500);
  });

  it('supports comparison and set operators', () => {
    expect(
      calculateWithContext(sales, 'SUM', 'amount', [
        { column: 'amount', operator: '>', value: 300 },
      ])
    ).toBe(1200); // 400 + 350 + 450

    expect(
      calculateWithContext(sales, 'COUNTROWS', 'amount', [
        { column: 'rep', operator: 'IN', value: ['Ama', 'Yaa'] },
      ])
    ).toBe(5);

    expect(
      calculateWithContext(sales, 'COUNTROWS', 'amount', [
        { column: 'rep', operator: 'NOT IN', value: ['Ama'] },
      ])
    ).toBe(5);
  });

  it('returns the unfiltered total when no filters are supplied', () => {
    expect(calculateWithContext(sales, 'SUM', 'amount', [])).toBe(
      executeKPIFormula(sales, 'SUM', 'amount')
    );
  });

  it('returns 0 when the filter matches nothing', () => {
    expect(
      calculateWithContext(sales, 'SUM', 'amount', [
        { column: 'region', operator: '=', value: 'Tamale' },
      ])
    ).toBe(0);
  });
});

describe('RANKX', () => {
  // Ranks come back in original row order. Amounts are
  // [100, 200, 300, 400, 150, 250, 350, 450].
  it('ranks descending with 1 as the largest value', () => {
    expect(calculateRANKX(sales, 'amount', 'DESC')).toEqual([8, 6, 4, 2, 7, 5, 3, 1]);
  });

  it('ranks ascending when asked', () => {
    expect(calculateRANKX(sales, 'amount', 'ASC')).toEqual([1, 3, 5, 7, 2, 4, 6, 8]);
  });

  it('uses competition ranking for ties (1, 2, 2, 4)', () => {
    const tied = makeDataset(
      [{ v: 10 }, { v: 20 }, { v: 20 }, { v: 5 }],
      [{ name: 'v', type: 'number' }]
    );
    expect(calculateRANKX(tied, 'v', 'DESC')).toEqual([3, 1, 1, 4]);
  });
});

describe('LOOKUPVALUE', () => {
  it('returns the matching value from another row', () => {
    const result = calculateLOOKUPVALUE(sales, 'rep', 'amount', 300);
    expect(result).toBe('Kwesi');
  });

  it('returns null when nothing matches', () => {
    expect(calculateLOOKUPVALUE(sales, 'rep', 'amount', 999)).toBeNull();
  });
});

describe('KPI formatting', () => {
  it('formats currency, percentage and plain numbers distinctly', () => {
    expect(formatKPIValue(1234.5, 'currency')).toMatch(/1,234/);
    expect(formatKPIValue(0.42, 'percentage')).toContain('%');
    expect(formatKPIValue(1234567, 'number')).toMatch(/1,234,567|1\.23M/);
  });
});

// ============================================================
// Dates at period boundaries, and dates that cannot be read
//
// The fixture above uses mid-month dates only - the 5th, 10th, 15th, 20th -
// so it could never expose the bug these functions carried: they parsed with
// `new Date(String(value))` and then read `.getFullYear()`, a LOCAL getter.
// An ISO date parses as midnight UTC, which renders as the PREVIOUS day
// anywhere west of Greenwich, so a row dated 1 January fell into the wrong
// year and vanished from year-to-date.
//
// vitest.config.ts pins TZ to Pacific/Honolulu (UTC-10) precisely so these
// fail when the arithmetic goes back through local time.
// ============================================================

describe('Dates at period boundaries', () => {
  const boundary = makeDataset(
    [
      { date: '2023-12-31', amount: 400 },
      { date: '2024-01-01', amount: 100 },
      { date: '2024-06-30', amount: 200 },
      { date: '2024-07-01', amount: 800 },
    ],
    [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'number' },
    ]
  );

  it('counts 1 January in the new year, not the old one', () => {
    // 100 + 200 + 800 = 1100. The local-getter version returned 1000: the
    // 1 January row was read as 31 December 2023 and dropped.
    expect(
      readable(calculateTotalYTD(boundary, 'amount', 'date', new Date('2024-12-31T00:00:00Z')), 'YTD')
    ).toBe(1100);
  });

  it('counts 31 December in the old year, not the new one', () => {
    expect(
      readable(calculateTotalYTD(boundary, 'amount', 'date', new Date('2023-12-31T00:00:00Z')), 'YTD')
    ).toBe(400);
  });

  it('puts 30 June and 1 July in different quarters', () => {
    expect(
      readable(calculateTotalQTD(boundary, 'amount', 'date', new Date('2024-06-30T00:00:00Z')), 'Q2')
    ).toBe(200);
    expect(
      readable(calculateTotalQTD(boundary, 'amount', 'date', new Date('2024-09-30T00:00:00Z')), 'Q3')
    ).toBe(800);
  });

  it('includes the reference date itself in year to date', () => {
    expect(
      readable(calculateTotalYTD(boundary, 'amount', 'date', new Date('2024-01-01T00:00:00Z')), 'YTD')
    ).toBe(100);
  });

  it('compares the right two years either side of the boundary', () => {
    const yoy = readable(
      calculateYoYChange(boundary, 'amount', 'date', new Date('2024-12-31T00:00:00Z')),
      'YoY'
    );
    expect(yoy.currentYear).toBe(1100);
    expect(yoy.previousYear).toBe(400);
  });

  it('orders a running total across a year boundary', () => {
    const shuffled = makeDataset(
      [
        { date: '2024-01-01', amount: 100 },
        { date: '2023-12-31', amount: 400 },
      ],
      [
        { name: 'date', type: 'date' },
        { name: 'amount', type: 'number' },
      ]
    );
    expect(calculateRunningTotal(shuffled, 'amount', 'date')).toEqual([400, 500]);
  });
});

describe('Dates that cannot be read', () => {
  /** 03/04 and 05/06 are valid both ways round, so nothing settles the order. */
  const ambiguous = makeDataset(
    [
      { date: '03/04/2024', amount: 100 },
      { date: '05/06/2024', amount: 200 },
    ],
    [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'number' },
    ]
  );

  it('returns null rather than picking a reading', () => {
    // The previous version silently took the American reading, putting the
    // first row in March instead of April. A monthly total that is one month
    // out looks entirely plausible, so nobody would catch it.
    const asOf = new Date('2024-12-31T00:00:00Z');
    expect(calculateTotalYTD(ambiguous, 'amount', 'date', asOf)).toBeNull();
    expect(calculateTotalQTD(ambiguous, 'amount', 'date', asOf)).toBeNull();
    expect(calculateTotalMTD(ambiguous, 'amount', 'date', asOf)).toBeNull();
    expect(calculateSamePeriodLastYear(ambiguous, 'amount', 'date', 'year', asOf)).toBeNull();
    expect(calculateYoYChange(ambiguous, 'amount', 'date', asOf)).toBeNull();
    expect(calculateQoQChange(ambiguous, 'amount', 'date')).toBeNull();
    expect(calculateMoMChange(ambiguous, 'amount', 'date')).toBeNull();
  });

  it('never returns zero for an unreadable column', () => {
    // Zero is a number a reader would act on. Null is not.
    const result = calculateTotalYTD(ambiguous, 'amount', 'date', new Date('2024-12-31T00:00:00Z'));
    expect(result).not.toBe(0);
  });

  it('still reads a column whose ordering the data settles', () => {
    // 25/12 can only be day-first, which fixes the reading for the column.
    const settled = makeDataset(
      [
        { date: '25/12/2024', amount: 100 },
        { date: '03/04/2024', amount: 200 },
      ],
      [
        { name: 'date', type: 'date' },
        { name: 'amount', type: 'number' },
      ]
    );
    expect(
      readable(calculateTotalYTD(settled, 'amount', 'date', new Date('2024-12-31T00:00:00Z')), 'YTD')
    ).toBe(300);
    // Day-first: the second row is 3 April, so it lands in Q2 not Q1.
    expect(
      readable(calculateTotalQTD(settled, 'amount', 'date', new Date('2024-06-30T00:00:00Z')), 'Q2')
    ).toBe(200);
  });

  it('still totals a running sum when dates are unreadable, without dropping rows', () => {
    // The cumulative total must still reach the full sum; only the ordering
    // is unavailable.
    const totals = calculateRunningTotal(ambiguous, 'amount', 'date');
    expect(totals[totals.length - 1]).toBe(300);
  });
});

describe('Running total with a few unreadable dates', () => {
  /** ISO format is settled by the good rows; one value is simply not a date. */
  const partial = makeDataset(
    [
      { date: 'not a date', amount: 5 },
      { date: '2024-01-02', amount: 20 },
      { date: '2024-01-01', amount: 10 },
    ],
    [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'number' },
    ]
  );

  it('sorts the readable rows and puts the unreadable one last', () => {
    // 1 Jan, then 2 Jan, then the row with no usable date. Letting the
    // undated row sort anywhere it likes makes a cumulative series start
    // from the wrong place, which is hard to spot on a chart.
    expect(calculateRunningTotal(partial, 'amount', 'date')).toEqual([10, 30, 35]);
  });

  it('keeps every row, so the series still reaches the full total', () => {
    const totals = calculateRunningTotal(partial, 'amount', 'date');
    expect(totals).toHaveLength(3);
    expect(totals[totals.length - 1]).toBe(35);
  });

  it('excludes the undated row from period totals without losing the rest', () => {
    expect(
      readable(calculateTotalYTD(partial, 'amount', 'date', new Date('2024-12-31T00:00:00Z')), 'YTD')
    ).toBe(30);
  });
});
