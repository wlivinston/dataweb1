import { describe, it, expect } from 'vitest';
import { evaluateDax, evaluateScalar } from '../dax/evaluate';
import { buildSemanticModel } from '../semantic/model';
import { emptyFilterContext, withColumnFilter } from '../dax/context';
import { parseDax } from '../dax/parser';
import { makeDataset } from './fixtures';
import { isTable } from '../dax/value';
import { collectFunctionNames } from '../dax/ast';
import type { SemanticMeasure, SemanticModel } from '../semantic/types';
import type { Dataset } from '../types';

/**
 * Sales with two date columns, so the model creates a second, inactive
 * relationship to the calendar - which is what USERELATIONSHIP exists to
 * switch on.
 *
 *   O1  C1  100  ordered 2024-01-15  shipped 2024-02-10
 *   O2  C1  250  ordered 2024-02-20  shipped 2024-03-05
 *   O3  C2   75  ordered 2024-03-05  shipped 2024-03-20
 *   O4  C3  400  ordered 2024-03-28  shipped 2024-04-10
 *
 *   total 825   |  by order month: Jan 100, Feb 250, Mar 475, Apr none
 *               |  by ship month:  Feb 100, Mar 325, Apr 400
 *
 * Customers: C1 Ama and C3 Yaa in Greater Accra, C2 Kofi in Ashanti.
 * Revenue per customer: C1 350, C2 75, C3 400.
 */
const salesDataset = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', Amount: 100, OrderDate: '2024-01-15', ShipDate: '2024-02-10' },
      { OrderID: 'O2', CustomerID: 'C1', Amount: 250, OrderDate: '2024-02-20', ShipDate: '2024-03-05' },
      { OrderID: 'O3', CustomerID: 'C2', Amount: 75, OrderDate: '2024-03-05', ShipDate: '2024-03-20' },
      { OrderID: 'O4', CustomerID: 'C3', Amount: 400, OrderDate: '2024-03-28', ShipDate: '2024-04-10' },
    ],
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'OrderDate', type: 'date' },
      { name: 'ShipDate', type: 'date' },
    ],
    { id: 'ds-sales', name: 'Sales' }
  );

const customersDataset = (): Dataset =>
  makeDataset(
    [
      { CustomerID: 'C1', Name: 'Ama', Region: 'Greater Accra' },
      { CustomerID: 'C2', Name: 'Kofi', Region: 'Ashanti' },
      { CustomerID: 'C3', Name: 'Yaa', Region: 'Greater Accra' },
    ],
    [
      { name: 'CustomerID', type: 'string' },
      { name: 'Name', type: 'string' },
      { name: 'Region', type: 'string' },
    ],
    { id: 'ds-customers', name: 'Customers' }
  );

const measures: SemanticMeasure[] = [
  { name: 'Customer Revenue', expression: 'SUM(Sales[Amount])' },
];

let cached: SemanticModel | null = null;
const model = (): SemanticModel => {
  if (!cached) {
    cached = buildSemanticModel([salesDataset(), customersDataset()], { measures });
  }
  return cached;
};

const scalar = (source: string) => evaluateScalar(source, model());

const rowCount = (source: string): number => {
  const value = evaluateDax(source, model());
  if (!isTable(value)) throw new Error(`expected a table, got ${String(value)}`);
  return value.rows.length;
};

describe('dotted function names', () => {
  it('lexes a dotted name when a call follows', () => {
    // STDEV.P and friends cannot parse at all unless the tokenizer absorbs
    // the dot, and it only may when the dotted form is being called.
    expect(collectFunctionNames(parseDax('STDEV.P(Sales[Amount])'))).toEqual(['STDEV.P']);
    expect(collectFunctionNames(parseDax('PERCENTILE.INC(Sales[Amount], 0.5)'))).toEqual([
      'PERCENTILE.INC',
    ]);
    expect(collectFunctionNames(parseDax('VAR.S( Sales[Amount] )'))).toEqual(['VAR.S']);
  });

  it('still rejects a dotted column reference', () => {
    // A column reference is never followed by a call, so the helpful error
    // survives the change.
    expect(() => parseDax('Sales.Amount')).toThrow(/not Table\.Column/);
    expect(() => parseDax('Sales.Amount + 1')).toThrow(/not Table\.Column/);
  });
});

describe('statistical aggregation', () => {
  // Amounts are 75, 100, 250, 400. Mean 206.25, sum of squared deviations
  // 67968.75, worked out by hand rather than captured from the engine.
  it('finds the median by interpolation, as PERCENTILE.INC does', () => {
    expect(scalar('MEDIAN(Sales[Amount])')).toBe(175);
  });

  it('computes inclusive percentiles', () => {
    expect(scalar('PERCENTILE.INC(Sales[Amount], 0)')).toBe(75);
    expect(scalar('PERCENTILE.INC(Sales[Amount], 1)')).toBe(400);
    expect(scalar('PERCENTILE.INC(Sales[Amount], 0.25)')).toBe(93.75);
    expect(scalar('PERCENTILE.INC(Sales[Amount], 0.5)')).toBe(175);
  });

  it('rejects a percentile outside 0 to 1', () => {
    expect(() => scalar('PERCENTILE.INC(Sales[Amount], 1.5)')).toThrow(/from 0 to 1/);
  });

  it('divides by n for population and n-1 for sample', () => {
    expect(scalar('VAR.P(Sales[Amount])')).toBeCloseTo(16992.1875, 6);
    expect(scalar('VAR.S(Sales[Amount])')).toBeCloseTo(22656.25, 6);
    expect(scalar('STDEV.P(Sales[Amount])')).toBeCloseTo(130.3541, 3);
    expect(scalar('STDEV.S(Sales[Amount])')).toBeCloseTo(150.5199, 3);
  });

  it('returns BLANK for a sample of one, which has no spread to estimate', () => {
    expect(scalar('CALCULATE(VAR.S(Sales[Amount]), Sales[OrderID] = "O1")')).toBeNull();
    expect(scalar('CALCULATE(STDEV.S(Sales[Amount]), Sales[OrderID] = "O1")')).toBeNull();
    // The population forms are defined for one value: it has no deviation.
    expect(scalar('CALCULATE(VAR.P(Sales[Amount]), Sales[OrderID] = "O1")')).toBe(0);
  });

  it('respects filter context like any other aggregation', () => {
    expect(scalar('CALCULATE(MEDIAN(Sales[Amount]), Sales[Amount] > 80)')).toBe(250);
  });
});

describe('CONCATENATEX', () => {
  it('joins an expression across rows', () => {
    expect(scalar('CONCATENATEX(Customers, Customers[Name], ", ")')).toBe('Ama, Kofi, Yaa');
  });

  it('defaults to no delimiter and skips blanks', () => {
    expect(scalar('CONCATENATEX(Customers, Customers[Name])')).toBe('AmaKofiYaa');
  });

  it('returns BLANK when there is nothing to join', () => {
    expect(
      scalar('CALCULATE(CONCATENATEX(Customers, Customers[Name], ", "), Customers[CustomerID] = "C9")')
    ).toBeNull();
  });
});

describe('RANKX', () => {
  it('ranks highest first by default', () => {
    // C3 has 400, C1 350, C2 75.
    const rank = (customer: string) =>
      scalar(
        `CALCULATE(RANKX(ALL(Customers), [Customer Revenue]), Customers[CustomerID] = "${customer}")`
      );
    expect(rank('C3')).toBe(1);
    expect(rank('C1')).toBe(2);
    expect(rank('C2')).toBe(3);
  });

  it('ranks lowest first when told to', () => {
    // DAX also writes this with an empty slot - RANKX(t, e, , ASC) - which
    // this parser rejects rather than guess at. See the note below.
    expect(
      scalar(
        'CALCULATE(RANKX(ALL(Customers), [Customer Revenue], [Customer Revenue], ASC), ' +
          'Customers[CustomerID] = "C2")'
      )
    ).toBe(1);
  });

  it('rejects the empty-slot form rather than guessing what was meant', () => {
    // A known gap: DAX allows an omitted optional argument to be left as an
    // empty slot. Accepting it would mean deciding what the missing value is,
    // so it is refused loudly until that can be checked against Power BI.
    expect(() =>
      scalar('RANKX(ALL(Customers), [Customer Revenue], , ASC)')
    ).toThrow(/Empty argument/);
  });

  it('skips ranks after a tie, and closes the gap when dense', () => {
    // Greater Accra has two customers; ranking regions puts them level.
    const skip = scalar(
      'CALCULATE(RANKX(ALL(Customers), [Customer Revenue], 75), Customers[CustomerID] = "C2")'
    );
    // Two customers earn more than 75, so a skipping rank is 3.
    expect(skip).toBe(3);
  });

  it('returns BLANK when the value being ranked is blank', () => {
    expect(
      scalar('CALCULATE(RANKX(ALL(Customers), [Customer Revenue]), Customers[CustomerID] = "C9")')
    ).toBeNull();
  });
});

describe('TOPN', () => {
  it('takes the largest rows by default', () => {
    expect(scalar('SUMX(TOPN(2, Sales, Sales[Amount]), Sales[Amount])')).toBe(650);
  });

  it('takes the smallest when asked', () => {
    expect(scalar('SUMX(TOPN(2, Sales, Sales[Amount], ASC), Sales[Amount])')).toBe(175);
  });

  it('keeps every row tied with the last one included', () => {
    // Ranking by customer gives C1 two rows tied on the same key, so asking
    // for one row returns both rather than picking arbitrarily.
    expect(rowCount('TOPN(1, Sales, Sales[CustomerID], ASC)')).toBe(2);
  });

  it('returns nothing for a non-positive count', () => {
    expect(rowCount('TOPN(0, Sales, Sales[Amount])')).toBe(0);
  });
});

describe('LOOKUPVALUE and SELECTEDVALUE', () => {
  it('looks a value up by key', () => {
    expect(scalar('LOOKUPVALUE(Customers[Name], Customers[CustomerID], "C2")')).toBe('Kofi');
  });

  it('returns BLANK when nothing matches', () => {
    expect(scalar('LOOKUPVALUE(Customers[Name], Customers[CustomerID], "C9")')).toBeNull();
  });

  it('refuses when the match is not unique, rather than picking one', () => {
    // Two customers are in Greater Accra with different names.
    expect(() =>
      scalar('LOOKUPVALUE(Customers[Name], Customers[Region], "Greater Accra")')
    ).toThrow(/found 2 different values/);
  });

  it('refuses a search column from another table', () => {
    expect(() =>
      scalar('LOOKUPVALUE(Customers[Name], Sales[CustomerID], "C1")')
    ).toThrow(/searches one table at a time/);
  });

  it('returns the one value in scope, or the alternative', () => {
    expect(
      scalar('CALCULATE(SELECTEDVALUE(Customers[Region]), Customers[CustomerID] = "C2")')
    ).toBe('Ashanti');
    // Two regions are in scope, so there is no single value.
    expect(scalar('SELECTEDVALUE(Customers[Region])')).toBeNull();
    expect(scalar('SELECTEDVALUE(Customers[Region], "several")')).toBe('several');
  });
});

describe('CALCULATETABLE and RELATEDTABLE', () => {
  it('filters a table expression', () => {
    expect(scalar('COUNTROWS(CALCULATETABLE(Sales, Sales[Amount] > 100))')).toBe(2);
    expect(scalar('SUMX(CALCULATETABLE(Sales, Sales[Amount] > 100), Sales[Amount])')).toBe(650);
  });

  it('reaches the many side from a row on the one side', () => {
    // C1 has two orders, C2 and C3 one each.
    expect(scalar('SUMX(Customers, COUNTROWS(RELATEDTABLE(Sales)))')).toBe(4);
    expect(
      scalar('CALCULATE(SUMX(Customers, COUNTROWS(RELATEDTABLE(Sales))), Customers[CustomerID] = "C1")')
    ).toBe(2);
  });

  it('refuses RELATEDTABLE with no row to work from', () => {
    expect(() => scalar('COUNTROWS(RELATEDTABLE(Sales))')).toThrow(/needs a row to work from/);
  });
});

describe('ALLSELECTED', () => {
  /** An external filter, standing in for what a user picked in a report. */
  const externalRegion = () =>
    withColumnFilter(emptyFilterContext(), 'Customers', 'Region', new Set(['greater accra']));

  const underSelection = (source: string) =>
    evaluateScalar(source, model(), { filter: externalRegion() });

  it('restores what the caller asked for, not everything', () => {
    // Greater Accra is C1 and C3: 350 + 400.
    expect(underSelection('SUM(Sales[Amount])')).toBe(750);
    expect(underSelection('CALCULATE(SUM(Sales[Amount]), Customers[CustomerID] = "C1")')).toBe(350);

    // ALLSELECTED drops the measure's own filter but keeps the selection.
    expect(
      underSelection(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), ALLSELECTED(Customers)), Customers[CustomerID] = "C1")'
      )
    ).toBe(750);

    // ALL drops the selection too, which is the difference between them.
    expect(
      underSelection(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), ALL(Customers)), Customers[CustomerID] = "C1")'
      )
    ).toBe(825);
  });
});

describe('USERELATIONSHIP', () => {
  it('creates a second, inactive date relationship for ShipDate', () => {
    const built = model();
    const dateLinks = built.relationships.filter(r => r.to.table === 'Date');
    expect(dateLinks).toHaveLength(2);
    expect(dateLinks.filter(r => r.isActive)).toHaveLength(1);
  });

  it('reports by order date by default', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 3)')).toBe(475);
    // Nothing was ordered in April.
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 4)')).toBeNull();
  });

  it('reports by ship date when the other relationship is activated', () => {
    // O4 shipped in April, so the same filter now finds 400.
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), Date[Month] = 4, USERELATIONSHIP(Sales[ShipDate], Date[Date]))'
      )
    ).toBe(400);
    // March shipments are O2 and O3.
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), Date[Month] = 3, USERELATIONSHIP(Sales[ShipDate], Date[Date]))'
      )
    ).toBe(325);
  });

  it('only swaps for the calculation it is given to', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 4)')).toBeNull();
  });

  it('refuses a pair of columns with no relationship between them', () => {
    expect(() =>
      scalar('CALCULATE(SUM(Sales[Amount]), USERELATIONSHIP(Sales[Amount], Customers[Name]))')
    ).toThrow(/no relationship between/);
  });

  it('refuses to be used outside CALCULATE', () => {
    expect(() => scalar('USERELATIONSHIP(Sales[ShipDate], Date[Date])')).toThrow(
      /only works as a CALCULATE filter/
    );
  });
});

describe('FORMAT', () => {
  it('formats numbers from a pattern', () => {
    expect(scalar('FORMAT(1234.5, "#,##0.00")')).toBe('1,234.50');
    expect(scalar('FORMAT(1234.4, "0")')).toBe('1234');
    expect(scalar('FORMAT(0.1234, "0.0%")')).toBe('12.3%');
    expect(scalar('FORMAT(-1234.5, "#,##0.00")')).toBe('-1,234.50');
  });

  it('keeps literal text around the pattern', () => {
    // This is what replaces the "Currency" named format.
    expect(scalar('FORMAT(1234.5, "GHS #,##0.00")')).toBe('GHS 1,234.50');
  });

  it('formats dates from a pattern', () => {
    expect(scalar('FORMAT("2024-03-15", "yyyy-mm-dd")')).toBe('2024-03-15');
    expect(scalar('FORMAT("2024-03-15", "mmm yyyy")')).toBe('Mar 2024');
    expect(scalar('FORMAT("2024-03-15", "mmmm")')).toBe('March');
    expect(scalar('FORMAT("2024-03-15", "Long Date")')).toBe('Friday, 15 March 2024');
  });

  it('accepts the named numeric formats', () => {
    expect(scalar('FORMAT(1234.5, "Standard")')).toBe('1,234.50');
    expect(scalar('FORMAT(1234.5, "Fixed")')).toBe('1234.50');
  });

  it('refuses Currency rather than guessing a symbol', () => {
    // The model carries no currency, and the wrong symbol is worse than an
    // error on a figure someone might screenshot.
    expect(() => scalar('FORMAT(1234, "Currency")')).toThrow(/does not support "Currency"/);
  });

  it('refuses a pattern it does not understand', () => {
    expect(() => scalar('FORMAT(1234, "wat")')).toThrow(/does not understand the pattern/);
  });

  it('passes BLANK through', () => {
    expect(scalar('FORMAT(BLANK(), "0.00")')).toBeNull();
  });
});

describe('date functions', () => {
  it('counts interval boundaries, not elapsed time', () => {
    // One day apart, but a year boundary lies between them.
    expect(scalar('DATEDIFF("2024-12-31", "2025-01-01", YEAR)')).toBe(1);
    expect(scalar('DATEDIFF("2024-01-15", "2024-03-15", MONTH)')).toBe(2);
    expect(scalar('DATEDIFF("2024-01-15", "2024-04-15", QUARTER)')).toBe(1);
    expect(scalar('DATEDIFF("2024-01-01", "2024-01-31", DAY)')).toBe(30);
    expect(scalar('DATEDIFF("2024-01-01", "2024-01-08", WEEK)')).toBe(1);
  });

  it('rejects an interval it does not know', () => {
    expect(() => scalar('DATEDIFF("2024-01-01", "2024-02-01", FORTNIGHT)')).toThrow(
      /not an interval/
    );
  });

  it('adds months with the day clamped', () => {
    expect(scalar('EDATE("2024-01-31", 1)')).toBe('2024-02-29');
    expect(scalar('EDATE("2024-03-15", -1)')).toBe('2024-02-15');
  });

  it('finds the end of a month, offset or not', () => {
    expect(scalar('EOMONTH("2024-01-15", 0)')).toBe('2024-01-31');
    expect(scalar('EOMONTH("2024-01-15", 1)')).toBe('2024-02-29');
    expect(scalar('EOMONTH("2023-01-15", 1)')).toBe('2023-02-28');
  });

  it('numbers weeks by the requested convention', () => {
    // 1 January 2024 is a Monday.
    expect(scalar('WEEKNUM("2024-01-01", 1)')).toBe(1);
    expect(scalar('WEEKNUM("2024-01-07", 1)')).toBe(2); // Sunday opens a new week
    expect(scalar('WEEKNUM("2024-01-07", 2)')).toBe(1); // Monday-start, still week 1
    expect(scalar('WEEKNUM("2025-12-29", 21)')).toBe(1); // ISO: week 1 of 2026
  });

  it('refuses a week numbering system it does not implement', () => {
    expect(() => scalar('WEEKNUM("2024-01-01", 17)')).toThrow(/Supported return types/);
  });
});

describe('period edges and the NEXT family', () => {
  it('finds the edges of the period in scope', () => {
    expect(scalar('CALCULATE(STARTOFMONTH(Date[Date]), Date[Month] = 3)')).toBe('2024-03-01');
    expect(scalar('CALCULATE(ENDOFMONTH(Date[Date]), Date[Month] = 3)')).toBe('2024-03-31');
    expect(scalar('CALCULATE(STARTOFQUARTER(Date[Date]), Date[Month] = 3)')).toBe('2024-01-01');
    expect(scalar('CALCULATE(ENDOFQUARTER(Date[Date]), Date[Month] = 3)')).toBe('2024-03-31');
    expect(scalar('CALCULATE(STARTOFYEAR(Date[Date]), Date[Month] = 3)')).toBe('2024-01-01');
    expect(scalar('CALCULATE(ENDOFYEAR(Date[Date]), Date[Month] = 3)')).toBe('2024-12-31');
  });

  it('steps to the neighbouring period', () => {
    expect(rowCount('CALCULATE(NEXTMONTH(Date[Date]), Date[Month] = 3)')).toBe(30); // April
    expect(rowCount('CALCULATE(NEXTQUARTER(Date[Date]), Date[Month] = 3)')).toBe(91); // Q2 2024
  });

  it('steps a single day, in both directions', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(FIRSTDATE(Date[Date]), PREVIOUSDAY(Date[Date])), Date[Date] = "2024-03-15")'
      )
    ).toBe('2024-03-14');
    expect(
      scalar(
        'CALCULATE(CALCULATE(FIRSTDATE(Date[Date]), NEXTDAY(Date[Date])), Date[Date] = "2024-03-15")'
      )
    ).toBe('2024-03-16');
  });

  it('crosses a year boundary to reach the next period', () => {
    expect(rowCount('CALCULATE(NEXTMONTH(Date[Date]), Date[Month] = 12)')).toBe(0);
    // The calendar stops at the end of 2024, so January 2025 has no rows -
    // an empty result rather than a wrong one.
  });
});
