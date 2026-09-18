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
  calculateWithContext,
  calculateRANKX,
  calculateLOOKUPVALUE,
} from '../kpiFormulaEngine';
import type { DAXFilterContext } from '../types';

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
    expect(calculateTotalYTD(sales, 'amount', 'date', asOf)).toBe(750);
  });

  it('TOTALYTD excludes future-dated rows in the same year', () => {
    // the 2024-11-05 row (450) must not be counted in an August YTD
    expect(calculateTotalYTD(sales, 'amount', 'date', asOf)).toBeLessThan(
      calculateTotalYTD(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z'))
    );
    expect(calculateTotalYTD(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z'))).toBe(1200);
  });

  it('TOTALQTD covers only the reference quarter', () => {
    // Q3 2024 up to 2024-08-15 -> the 2024-08-10 row only
    expect(calculateTotalQTD(sales, 'amount', 'date', asOf)).toBe(350);
  });

  it('TOTALMTD covers only the reference month', () => {
    expect(calculateTotalMTD(sales, 'amount', 'date', asOf)).toBe(350);
    expect(calculateTotalMTD(sales, 'amount', 'date', new Date('2024-05-31T00:00:00Z'))).toBe(250);
  });

  it('SAMEPERIODLASTYEAR returns the prior year total for the same grain', () => {
    // full prior year 2023: 100+200+300+400 = 1000
    expect(calculateSamePeriodLastYear(sales, 'amount', 'date', 'year', asOf)).toBe(1000);
    // Q3 2023 -> the 2023-08-10 row
    expect(calculateSamePeriodLastYear(sales, 'amount', 'date', 'quarter', asOf)).toBe(300);
    // August 2023 -> the 2023-08-10 row
    expect(calculateSamePeriodLastYear(sales, 'amount', 'date', 'month', asOf)).toBe(300);
  });

  it('YoY compares the reference year against the one before it', () => {
    const yoy = calculateYoYChange(sales, 'amount', 'date', new Date('2024-12-31T00:00:00Z'));
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
    const yoy = calculateYoYChange(singleYear, 'amount', 'date', new Date('2024-12-31T00:00:00Z'));
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
