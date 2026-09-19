import { describe, it, expect } from 'vitest';
import { evaluateDax, evaluateScalar } from '../dax/evaluate';
import { buildSemanticModel } from '../semantic/model';
import { makeDataset } from './fixtures';
import { isTable, type DaxValue } from '../dax/value';
import { DaxError } from '../dax/errors';
import type { SemanticMeasure, SemanticModel } from '../semantic/types';
import type { Dataset } from '../types';

/**
 * Sales, hand-computable throughout.
 *
 *   O1  C1  100  2024-01-15  note "ok"
 *   O2  C1  250  2024-02-20  note blank
 *   O3  C2   75  2024-03-05  note "late"
 *   O4  C3  400  2024-03-28  note blank
 *
 *   total 825   |  Jan 100  Feb 250  Mar 475
 *
 * Customers: C1 and C3 are in Greater Accra, C2 in Ashanti.
 * So Greater Accra is 100 + 250 + 400 = 750 and Ashanti is 75.
 */
const salesDataset = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', Amount: 100, OrderDate: '2024-01-15', Note: 'ok' },
      { OrderID: 'O2', CustomerID: 'C1', Amount: 250, OrderDate: '2024-02-20', Note: null },
      { OrderID: 'O3', CustomerID: 'C2', Amount: 75, OrderDate: '2024-03-05', Note: 'late' },
      { OrderID: 'O4', CustomerID: 'C3', Amount: 400, OrderDate: '2024-03-28', Note: null },
    ],
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'OrderDate', type: 'date' },
      { name: 'Note', type: 'string' },
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
  { name: 'Total Revenue', expression: 'SUM(Sales[Amount])' },
  { name: 'Order Count', expression: 'COUNTROWS(Sales)' },
  { name: 'Average Order', expression: 'DIVIDE([Total Revenue], [Order Count])' },
  { name: 'Self Referential', expression: '[Self Referential] + 1' },
];

let cached: SemanticModel | null = null;
const model = (): SemanticModel => {
  if (!cached) {
    cached = buildSemanticModel([salesDataset(), customersDataset()], { measures });
  }
  return cached;
};

const evaluate = (source: string): DaxValue => evaluateDax(source, model());
const scalar = (source: string) => evaluateScalar(source, model());

describe('the model this engine is built on', () => {
  it('has the relationship and calendar the tests rely on', () => {
    const built = model();
    expect(built.dateTableName).toBe('Date');
    expect(
      built.relationships.some(
        r => r.from.table === 'Sales' && r.to.table === 'Customers' && r.isActive
      )
    ).toBe(true);
  });
});

describe('aggregation', () => {
  it('sums a column', () => {
    expect(scalar('SUM(Sales[Amount])')).toBe(825);
  });

  it('averages, counts and finds extremes', () => {
    expect(scalar('AVERAGE(Sales[Amount])')).toBe(206.25);
    expect(scalar('MIN(Sales[Amount])')).toBe(75);
    expect(scalar('MAX(Sales[Amount])')).toBe(400);
    expect(scalar('COUNTROWS(Sales)')).toBe(4);
  });

  it('separates COUNT from COUNTA, as DAX does', () => {
    // COUNT is numeric-only; Note holds text, so it counts nothing.
    expect(scalar('COUNT(Sales[Note])')).toBeNull();
    expect(scalar('COUNTA(Sales[Note])')).toBe(2);
    expect(scalar('COUNTBLANK(Sales[Note])')).toBe(2);
  });

  it('counts BLANK as one of the distinct values', () => {
    // "ok", "late" and the blank make three.
    expect(scalar('DISTINCTCOUNT(Sales[Note])')).toBe(3);
    expect(scalar('DISTINCTCOUNT(Sales[CustomerID])')).toBe(3);
  });

  it('returns BLANK rather than zero when nothing is in scope', () => {
    // "No sales" and "sales of zero" are different answers.
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 10000)')).toBeNull();
    expect(scalar('CALCULATE(COUNTROWS(Sales), Sales[Amount] > 10000)')).toBeNull();
  });
});

describe('CALCULATE', () => {
  it('actually applies its filter to COUNTROWS', () => {
    // The bug that motivated this engine: the old implementation matched the
    // substring COUNTROWS and returned dataset.rowCount, ignoring the filter
    // entirely and reporting 4 here.
    expect(scalar('CALCULATE(COUNTROWS(Sales), Sales[Amount] > 100)')).toBe(2);
    expect(scalar('COUNTROWS(Sales)')).toBe(4);
  });

  it('filters a sum by a column on the same table', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 100)')).toBe(650);
  });

  it('accepts an IN list as a filter', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Sales[OrderID] IN {"O1", "O3"})')).toBe(175);
  });

  it('replaces an outer filter on the same column rather than narrowing it', () => {
    // The defining CALCULATE behaviour. Intersecting would give 400; DAX
    // replaces, so the inner filter alone decides.
    expect(
      scalar('CALCULATE(CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 50), Sales[Amount] > 300)')
    ).toBe(825);
  });

  it('combines filters on different columns', () => {
    expect(
      scalar(
        'CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 50, Sales[OrderID] IN {"O1", "O2"})'
      )
    ).toBe(350);
  });

  it('takes a FILTER expression as a filter argument', () => {
    expect(
      scalar('CALCULATE(SUM(Sales[Amount]), FILTER(Sales, Sales[Amount] >= 250))')
    ).toBe(650);
  });

  it('removes filters with ALL', () => {
    expect(
      scalar('CALCULATE(CALCULATE(SUM(Sales[Amount]), ALL(Sales)), Sales[Amount] > 300)')
    ).toBe(825);
  });

  it('removes a filter from one column only', () => {
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), ALL(Sales[Amount])), Sales[Amount] > 300)'
      )
    ).toBe(825);
  });

  it('keeps the named columns with ALLEXCEPT and drops the rest', () => {
    // Region survives, so only Greater Accra rows count; the Name filter is
    // dropped, so Ama's row is joined by Yaa's.
    expect(
      scalar(
        'CALCULATE(CALCULATE(SUM(Sales[Amount]), ALLEXCEPT(Customers, Customers[Region])), ' +
          'Customers[Region] = "Greater Accra", Customers[Name] = "Ama")'
      )
    ).toBe(750);
  });

  it('means the same thing whether ALLEXCEPT is a modifier or a table', () => {
    // The two paths share one implementation, so they cannot disagree.
    expect(scalar('COUNTROWS(ALLEXCEPT(Customers, Customers[Region]))')).toBe(3);
  });

  it('refuses a filter it cannot apply instead of ignoring it', () => {
    // A silently dropped filter is the worst failure available here: the
    // number still arrives, and it is the unfiltered one.
    expect(() => scalar('CALCULATE(SUM(Sales[Amount]), 1 + 1)')).toThrow(
      /filter is not supported/
    );
  });
});

describe('relationships', () => {
  it('propagates a filter from the dimension into the fact table', () => {
    expect(
      scalar('CALCULATE(SUM(Sales[Amount]), Customers[Region] = "Greater Accra")')
    ).toBe(750);
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Customers[Region] = "Ashanti")')).toBe(75);
  });

  it('propagates to a row count as well as a sum', () => {
    expect(
      scalar('CALCULATE(COUNTROWS(Sales), Customers[Region] = "Greater Accra")')
    ).toBe(3);
  });

  it('does not propagate back from the fact table by default', () => {
    // Single-direction cross-filtering: filtering Sales leaves Customers whole.
    expect(scalar('CALCULATE(COUNTROWS(Customers), Sales[Amount] > 300)')).toBe(3);
  });

  it('reads across a relationship with RELATED', () => {
    expect(
      scalar('SUMX(FILTER(Sales, RELATED(Customers[Region]) = "Ashanti"), Sales[Amount])')
    ).toBe(75);
  });

  it('matches keys case-insensitively, as Power BI does', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Customers[Region] = "GREATER ACCRA")')).toBe(
      750
    );
  });
});

describe('the generated calendar', () => {
  it('filters the fact table through the date relationship', () => {
    // Nothing in Sales says "March"; this only works because the model
    // generated a calendar and joined OrderDate to it.
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 3)')).toBe(475);
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 1)')).toBe(100);
  });

  it('filters by quarter', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Quarter] = 1)')).toBe(825);
  });

  it('returns BLANK for a period with no sales', () => {
    expect(scalar('CALCULATE(SUM(Sales[Amount]), Date[Month] = 7)')).toBeNull();
  });
});

describe('iterators and row context', () => {
  it('evaluates an expression row by row', () => {
    expect(scalar('SUMX(Sales, Sales[Amount] * 2)')).toBe(1650);
  });

  it('applies context transition inside an iterator', () => {
    // Each row's CALCULATE sees only that row, so this totals 825. Without
    // context transition every row would return the grand total: 3300.
    expect(scalar('SUMX(Sales, CALCULATE(SUM(Sales[Amount])))')).toBe(825);
  });

  it('filters rows with FILTER', () => {
    expect(scalar('COUNTROWS(FILTER(Sales, Sales[Amount] > 100))')).toBe(2);
    expect(scalar('SUMX(FILTER(Sales, Sales[Amount] > 100), Sales[Amount])')).toBe(650);
  });

  it('supports the other iterators', () => {
    expect(scalar('AVERAGEX(Sales, Sales[Amount])')).toBe(206.25);
    expect(scalar('MINX(Sales, Sales[Amount] * 2)')).toBe(150);
    expect(scalar('MAXX(Sales, Sales[Amount] * 2)')).toBe(800);
    expect(scalar('COUNTX(Sales, Sales[Amount])')).toBe(4);
  });

  it('refuses a bare column reference with no row to read from', () => {
    expect(() => scalar('Sales[Amount] * 2')).toThrow(/needs a row to read from/);
  });
});

describe('blank semantics', () => {
  it('treats BLANK as equal to zero and to empty text, as DAX does', () => {
    // Surprising, and reproduced deliberately: a user comparing our answer
    // against Power BI must not find a difference.
    expect(scalar('IF(BLANK() = 0, "yes", "no")')).toBe('yes');
    expect(scalar('IF(BLANK() = "", "yes", "no")')).toBe('yes');
  });

  it('coerces BLANK to zero in arithmetic', () => {
    expect(scalar('BLANK() + 5')).toBe(5);
    expect(scalar('BLANK() & "x"')).toBe('x');
  });

  it('reports blankness', () => {
    expect(scalar('ISBLANK(BLANK())')).toBe(true);
    expect(scalar('ISBLANK(0)')).toBe(false);
  });

  it('returns BLANK from DIVIDE by zero, but Infinity from the operator', () => {
    expect(scalar('DIVIDE(1, 0)')).toBeNull();
    expect(scalar('DIVIDE(1, 0, -1)')).toBe(-1);
    expect(scalar('1 / 0')).toBe(Infinity);
  });

  it('skips blanks with COALESCE', () => {
    expect(scalar('COALESCE(BLANK(), BLANK(), 7)')).toBe(7);
    expect(scalar('COALESCE(BLANK())')).toBeNull();
  });
});

describe('logic, maths and text', () => {
  it('branches', () => {
    expect(scalar('IF(SUM(Sales[Amount]) > 1000, "high", "low")')).toBe('low');
    expect(scalar('IF(1 = 2, "yes")')).toBeNull();
  });

  it('switches, including the else branch', () => {
    expect(scalar('SWITCH(2, 1, "one", 2, "two", "other")')).toBe('two');
    expect(scalar('SWITCH(9, 1, "one", 2, "two", "other")')).toBe('other');
    expect(scalar('SWITCH(9, 1, "one")')).toBeNull();
  });

  it('rounds half away from zero, not half up', () => {
    // Math.round would give -2 for -2.5, which is not what DAX reports.
    expect(scalar('ROUND(2.5, 0)')).toBe(3);
    expect(scalar('ROUND(-2.5, 0)')).toBe(-3);
    expect(scalar('ROUND(1.2345, 2)')).toBe(1.23);
  });

  it('does arithmetic', () => {
    expect(scalar('ABS(-4)')).toBe(4);
    expect(scalar('INT(4.9)')).toBe(4);
    expect(scalar('SQRT(16)')).toBe(4);
    expect(scalar('POWER(2, 10)')).toBe(1024);
    expect(scalar('MOD(10, 3)')).toBe(1);
  });

  it('handles text', () => {
    expect(scalar('UPPER("accra")')).toBe('ACCRA');
    expect(scalar('LEN("Accra")')).toBe(5);
    expect(scalar('LEFT("Accra", 2)')).toBe('Ac');
    expect(scalar('RIGHT("Accra", 3)')).toBe('cra');
    // DAX counts characters from 1, not 0.
    expect(scalar('MID("Accra", 2, 3)')).toBe('ccr');
    expect(scalar('SUBSTITUTE("Accra", "cc", "k")')).toBe('Akra');
    expect(scalar('"a" & "b"')).toBe('ab');
  });

  it('compares text case-insensitively', () => {
    expect(scalar('IF("Accra" = "ACCRA", "same", "different")')).toBe('same');
  });

  it('reads date parts', () => {
    expect(scalar('YEAR("2024-03-15")')).toBe(2024);
    expect(scalar('MONTH("2024-03-15")')).toBe(3);
    expect(scalar('DAY("2024-03-15")')).toBe(15);
    expect(scalar('QUARTER("2024-03-15")')).toBe(1);
  });

  it('uses the supplied date for TODAY, so measures are reproducible', () => {
    const today = evaluateScalar('TODAY()', model(), {
      today: new Date('2024-06-01T00:00:00Z'),
    });
    expect(today).toBe('2024-06-01');
  });
});

describe('variables and measures', () => {
  it('binds VAR and uses it in RETURN', () => {
    expect(scalar('VAR total = SUM(Sales[Amount]) RETURN total * 2')).toBe(1650);
  });

  it('lets a later VAR build on an earlier one', () => {
    expect(scalar('VAR a = 10 VAR b = a * 2 RETURN a + b')).toBe(30);
  });

  it('evaluates a measure by name', () => {
    expect(scalar('[Total Revenue]')).toBe(825);
    expect(scalar('[Order Count]')).toBe(4);
  });

  it('evaluates a measure that refers to other measures', () => {
    expect(scalar('[Average Order]')).toBe(206.25);
  });

  it('applies filter context to a referenced measure', () => {
    expect(scalar('CALCULATE([Total Revenue], Customers[Region] = "Ashanti")')).toBe(75);
  });

  it('refuses a measure that refers to itself rather than hanging', () => {
    expect(() => scalar('[Self Referential]')).toThrow(/refers to itself/);
  });

  it('refuses a measure that does not exist', () => {
    expect(() => scalar('[No Such Measure]')).toThrow(/no measure called/);
  });
});

describe('failing loudly', () => {
  it('rejects an unknown function', () => {
    expect(() => scalar('SUMM(Sales[Amount])')).toThrow(/no DAX function called SUMM/);
  });

  it('rejects a recognised function that is not implemented, and says so', () => {
    // Catalogued on purpose: the measure can be saved and exported to Power
    // BI, and only asking for a number fails.
    expect(() => scalar('COUNTROWS(SUMMARIZE(Sales, Sales[CustomerID]))')).toThrow(
      /recognised but not implemented yet/
    );
  });

  it('rejects an unknown column with the available ones', () => {
    expect(() => scalar('SUM(Sales[Amonut])')).toThrow(/no column called "Amonut"/);
  });

  it('rejects an expression where a column reference is required', () => {
    expect(() => scalar('SUM(Sales[Amount] * 2)')).toThrow(/needs a column reference/);
  });

  it('rejects wrong arity before trying to evaluate', () => {
    expect(() => scalar('DIVIDE(1)')).toThrow(/Expected DIVIDE\(numerator, denominator/);
  });

  it('reports the position of the problem, not just the message', () => {
    const source = 'SUM(Sales[Amount]) + SUM(Sales[Bogus])';
    try {
      evaluateScalar(source, model());
      throw new Error('should have thrown');
    } catch (error) {
      const daxError = error as { position: number; length: number; format?: () => string };
      expect(source.slice(daxError.position, daxError.position + daxError.length)).toContain(
        'Bogus'
      );
    }
  });

  it('refuses to return a table where a single value is required', () => {
    expect(() => scalar('Sales')).toThrow(/has to return a single value/);
  });

  it('recovers from an error with IFERROR', () => {
    expect(scalar('IFERROR(SQRT(-1), -1)')).toBe(-1);
    expect(scalar('IFERROR(SQRT(16), -1)')).toBe(4);
  });
});

describe('table values', () => {
  it('returns the visible rows of a table', () => {
    const value = evaluate('Sales');
    expect(isTable(value)).toBe(true);
    if (isTable(value)) {
      expect(value.table).toBe('Sales');
      expect(value.rows).toHaveLength(4);
    }
  });

  it('returns every row from ALL, ignoring filters', () => {
    const value = evaluate('CALCULATE(COUNTROWS(ALL(Sales)), Sales[Amount] > 300)');
    expect(value).toBe(4);
  });
});

// ============================================================
// Computed values on the right of a CALCULATE filter
//
// The predicate reader accepted only a literal on the right, so
// CALCULATE(x, Date[Year] = YEAR(TODAY())) was disqualified as a filter and
// fell through to being evaluated as a scalar - where a bare column has no
// row to read from, and failed with an error about wrapping it in SUM.
// Every year-on-year measure is written that way. Found while building the
// Power BI parity sheet, because seven of its cases could not be run.
// ============================================================

describe('CALCULATE filters with a computed right-hand side', () => {
  // Deliberately the file's shared model, not a fresh one - it is the model
  // that carries the measures these tests compare against.
  const at = (formula: string, today?: Date) =>
    evaluateDax(formula, model(), today ? { today } : {});

  it('accepts an arithmetic expression', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 50 * 2)')).toBe(
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 100)', model())
    );
  });

  it('accepts a function call, such as DATE', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[OrderDate] = DATE(2024, 1, 15))')).toBe(
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[OrderDate] = "2024-01-15")', model())
    );
  });

  it('accepts TODAY, evaluated once against the fixed clock', () => {
    const fixed = new Date(Date.UTC(2024, 0, 15));
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[OrderDate] = TODAY())', fixed)).toBe(
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[OrderDate] = "2024-01-15")', model())
    );
  });

  it('accepts an aggregation over the outer context', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Amount] = MAX(Sales[Amount]))')).toBe(
      evaluateDax('MAX(Sales[Amount])', model())
    );
  });

  it('accepts computed values in an IN list', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Amount] IN {50 * 2, 250})')).toBe(
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[Amount] IN {100, 250})', model())
    );
  });

  it('accepts a measure on the right', () => {
    // A measure needs no row context, and comparing against one is ordinary
    // DAX. Only a bare column is excluded.
    const average = evaluateDax('[Average Order]', model()) as number;
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Amount] > [Average Order])')).toBe(
      evaluateDax(`CALCULATE(SUM(Sales[Amount]), Sales[Amount] > ${average})`, model())
    );
  });

  it('evaluates the right side with no row context, so a bare column still fails', () => {
    // Sales[CustomerID] on the right has no row to read from, so this errors
    // rather than silently resolving to some arbitrary row's value. Both
    // columns exist - an earlier version of this test named one that did
    // not, so it passed on a missing-column error and pinned nothing.
    expect(() =>
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[Note] = Sales[CustomerID])', model())
    ).toThrow();
  });

  it('resolves the right side against the iterated row, as Power BI does', () => {
    // VERIFIED against Power BI 2026-09-19, parity case
    // `filter-rhs-row-context`. Power BI returns the grand total, which is
    // only possible if the right-hand side sees the iterated row.
    //
    // This engine refused the expression until then, reading the right side
    // with no row context. The refusal was safe - loud rather than wrong -
    // but it was wrong about DAX, and it would have rejected perfectly
    // ordinary measures.
    const total = evaluateDax('SUM(Sales[Amount])', model());
    expect(
      evaluateDax(
        'SUMX(Sales, CALCULATE(SUM(Sales[Amount]), Sales[Amount] = Sales[Amount] * 1))',
        model()
      )
    ).toBe(total);
  });

  it('still has no row to read from at the top level', () => {
    // The row context only exists inside an iterator. Outside one, a bare
    // column on the right must still fail rather than pick a row.
    expect(() =>
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[Note] = Sales[CustomerID])', model())
    ).toThrow();
  });

  it('reports a table on the right as a DAX error, not a raw crash', () => {
    // Without the table check the value flows into the key scan and blows up
    // inside a string helper, surfacing as "value.trim is not a function" -
    // an engine defect leaking through where a DAX message belongs.
    let caught: unknown;
    try {
      evaluateDax('CALCULATE(SUM(Sales[Amount]), Sales[Note] = ALL(Sales))', model());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DaxError);
  });

  it('still refuses a filter it genuinely cannot express', () => {
    expect(() => evaluateDax('CALCULATE(SUM(Sales[Amount]), 1 + 1)', model())).toThrow();
  });
});

// ============================================================
// Blanks inside a column filter
//
// Filters are held as sets of lower-cased key strings, and a blank has no
// key - so a blank cell could never SATISFY a filter, whatever the filter
// said. CALCULATE(..., Sales[Region] <> "North") silently dropped every row
// with no region, because BLANK <> "North" is TRUE in DAX but the row had
// nothing to match on. Power BI answers 4000 on the parity fixture; this
// engine answered 3800 until 2026-09-19.
// ============================================================

describe('blanks in a column filter', () => {
  const withBlanks = () =>
    buildSemanticModel([
      makeDataset(
        [
          { OrderID: 'A', Region: 'North', Amount: 100 },
          { OrderID: 'B', Region: 'South', Amount: 200 },
          { OrderID: 'C', Region: null, Amount: 400 },
          // A region whose text is literally the sentinel's wording. If the
          // sentinel could collide with a real value, this row and row C
          // would become indistinguishable.
          { OrderID: 'D', Region: '(blank)', Amount: 800 },
        ],
        [
          { name: 'OrderID', type: 'string' },
          { name: 'Region', type: 'string' },
          { name: 'Amount', type: 'number' },
        ],
        { id: 'ds-blanks', name: 'Sales' }
      ),
    ]);

  const at = (formula: string) => evaluateDax(formula, withBlanks());

  it('includes a blank in <>, because BLANK is not the compared text', () => {
    // 200 + 400 + 800: everything that is not North, blanks included.
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] <> "North")')).toBe(1400);
  });

  it('excludes a blank from an equality against text', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North")')).toBe(100);
  });

  it('matches a blank against the empty string, as DAX does', () => {
    // BLANK = "" is TRUE, which is the same rule that makes BLANK() = 0 true.
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "")')).toBe(400);
  });

  it('does not confuse a genuine blank with a cell reading "(blank)"', () => {
    // The sentinel standing for a blank carries surrounding spaces that keyOf
    // trims away, so no real value can produce it. Without that, these two
    // rows would be the same value and both of these would return 1200.
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "(blank)")')).toBe(800);
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "")')).toBe(400);
  });

  it('keeps blanks out of a filter that names other values', () => {
    expect(at('CALCULATE(SUM(Sales[Amount]), Sales[Region] IN {"North", "South"})')).toBe(300);
  });
});
