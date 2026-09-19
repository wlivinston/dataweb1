import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax, checkDax, formatDaxValue, describeCalculationOutcome } from '../dax/run';
import { suggestCalculations } from '../dax/suggest';
import { columnRef, tableRef } from '../dax/printer';
import { parseDax } from '../dax/parser';
import type { Dataset } from '../types';
import type { SemanticModel } from '../semantic/types';

const customers = (): Dataset =>
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

const sales = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', Amount: 100, Qty: 2, OrderDate: '2024-01-15' },
      { OrderID: 'O2', CustomerID: 'C1', Amount: 250, Qty: 5, OrderDate: '2024-02-20' },
      { OrderID: 'O3', CustomerID: 'C2', Amount: 75, Qty: 1, OrderDate: '2024-03-05' },
      { OrderID: 'O4', CustomerID: 'C3', Amount: 400, Qty: 8, OrderDate: '2024-03-28' },
    ],
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'Qty', type: 'number' },
      { name: 'OrderDate', type: 'date' },
    ],
    { id: 'ds-sales', name: 'Sales' }
  );

const model = (): SemanticModel => buildSemanticModel([sales(), customers()]);

// ============================================================
// runDax: the contract the UI relies on
// ============================================================

describe('runDax', () => {
  it('evaluates a qualified aggregation', () => {
    const result = runDax('SUM(Sales[Amount])', model());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(825);
  });

  it('never returns a value and an error together', () => {
    const cases = ['SUM(Sales[Amount])', 'SUM(Sales[Nope])', 'NOTAFUNCTION()', 'SUM('];
    for (const formula of cases) {
      const result = runDax(formula, model());
      if (result.ok) {
        expect(result).not.toHaveProperty('message');
      } else {
        expect(result).not.toHaveProperty('value');
        expect(result.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports an unknown column instead of returning null', () => {
    const result = runDax('SUM(Sales[Revenue])', model());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Revenue/);
      expect(result.issues.some(i => i.code === 'unknown_column')).toBe(true);
    }
  });

  it('catches a bad column in a branch that never runs', () => {
    // The evaluator short-circuits IF and would return 825, never touching
    // Sales[Nope]. Only the validation pass, which walks the whole tree,
    // sees it - so this is what proves validation happens before evaluation
    // rather than being a formality.
    const result = runDax('IF(TRUE, SUM(Sales[Amount]), SUM(Sales[Nope]))', model());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Nope/);
  });

  it('counts every error, not just the one evaluation would hit first', () => {
    const result = runDax('SUM(Sales[Nope]) + AVERAGE(Sales[AlsoNope])', model());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.filter(i => i.code === 'unknown_column')).toHaveLength(2);
      expect(result.message).toMatch(/1 more/);
    }
  });

  it('reports a syntax error with a caret at the right place', () => {
    const result = runDax('SUM(Sales[Amount]', model());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain('^');
      expect(result.detail).toContain('SUM(Sales[Amount]');
    }
  });

  it('suggests a near-miss for a misspelled function', () => {
    const result = runDax('SUMM(Sales[Amount])', model());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/SUM/);
  });

  it('refuses an expression returning a table', () => {
    const result = runDax('ALL(Sales)', model());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/table/i);
  });

  it('refuses a catalogued function the evaluator cannot run, by name', () => {
    const result = runDax('COUNTROWS(SUMMARIZE(Sales, Sales[CustomerID]))', model());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/SUMMARIZE/);
      expect(result.issues.some(i => i.code === 'not_implemented')).toBe(true);
    }
  });

  it('refuses an unimplemented function even in a branch that is not taken', () => {
    // The evaluator short-circuits IF, so this would return 825 and never
    // touch SUMMARIZE. That is what Power BI does, and it is stricter here on
    // purpose: in a real measure the condition depends on filter context, so
    // the unreachable branch becomes reachable in some other cell. One error
    // now beats a number in one cell and a failure in the next.
    const result = runDax(
      'IF(TRUE, SUM(Sales[Amount]), COUNTROWS(SUMMARIZE(Sales, Sales[CustomerID])))',
      model()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/SUMMARIZE/);
  });

  it('rejects an empty formula without inventing an issue for it', () => {
    for (const formula of ['', '   ', '\n\t ']) {
      const result = runDax(formula, model());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/empty/i);
        // Nothing was parsed, so there is nothing to underline and no
        // function, column or arity to complain about.
        expect(result.detail).toBeNull();
        expect(result.issues).toEqual([]);
      }
    }
  });

  it('labels a parse failure as a syntax problem, not a missing function', () => {
    const result = runDax('SUM(Sales[Amount]', model());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(i => i.code)).toEqual(['syntax']);
    }
  });

  it('distinguishes a real BLANK from a failure', () => {
    const result = runDax('CALCULATE(SUM(Sales[Amount]), Sales[CustomerID] = "nobody")', model());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
      expect(formatDaxValue(result.value)).toBe('BLANK');
    }
  });

  it('returns the normalised form of what it ran', () => {
    const result = runDax('sum(  Sales[Amount]  )', model());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalised).toBe('SUM(Sales[Amount])');
  });

  it('honours a fixed today, so results are reproducible', () => {
    const result = runDax('YEAR(TODAY())', model(), { today: new Date(Date.UTC(2019, 5, 1)) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2019);
  });

  it('evaluates across a relationship, not just within one table', () => {
    const result = runDax(
      'CALCULATE(SUM(Sales[Amount]), Customers[Region] = "Greater Accra")',
      model()
    );
    expect(result.ok).toBe(true);
    // C1 (100 + 250) and C3 (400) are in Greater Accra; C2's 75 is not.
    if (result.ok) expect(result.value).toBe(750);
  });
});

// ============================================================
// The specific failures of the implementation this replaces
// ============================================================

describe('runDax: what the substring matcher got wrong', () => {
  it('does not ignore a filter on COUNTROWS', () => {
    // `formula.includes('COUNTROWS')` returned dataset.rowCount regardless of
    // any surrounding CALCULATE, so this returned 4.
    const result = runDax(
      'CALCULATE(COUNTROWS(Sales), Sales[CustomerID] = "C1")',
      model()
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2);
  });

  it('does not treat SUMX as SUM', () => {
    // `formula.includes('SUM(')` is false for SUMX, so the old code fell
    // through every branch and returned null.
    const result = runDax('SUMX(Sales, Sales[Amount] * Sales[Qty])', model());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(100 * 2 + 250 * 5 + 75 * 1 + 400 * 8);
  });

  it('does not read a nested SUM as the whole expression', () => {
    // The old matcher extracted the first SUM(...) it saw and ignored the
    // division entirely, so this returned 825 rather than a ratio.
    const result = runDax('DIVIDE(SUM(Sales[Amount]), SUM(Sales[Qty]))', model());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeCloseTo(825 / 16, 10);
  });

  it('refuses an unqualified column rather than guessing the table', () => {
    const result = runDax('SUM(Amount)', model());
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// checkDax
// ============================================================

describe('checkDax', () => {
  it('finds problems without evaluating', () => {
    const issues = checkDax('SUM(Sales[Nope])', model());
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('is quiet about a valid expression', () => {
    expect(checkDax('SUM(Sales[Amount])', model())).toHaveLength(0);
  });

  it('treats an empty formula as nothing to say, not as an error', () => {
    expect(checkDax('', model())).toHaveLength(0);
  });
});

// ============================================================
// formatDaxValue
// ============================================================

describe('formatDaxValue', () => {
  it('shows BLANK as a word, never as 0 or an empty string', () => {
    expect(formatDaxValue(null)).toBe('BLANK');
    expect(formatDaxValue(0)).not.toBe('BLANK');
    expect(formatDaxValue('')).not.toBe('BLANK');
  });

  it('renders booleans as DAX writes them', () => {
    expect(formatDaxValue(true)).toBe('TRUE');
    expect(formatDaxValue(false)).toBe('FALSE');
  });

  it('keeps text as it is', () => {
    expect(formatDaxValue('Greater Accra')).toBe('Greater Accra');
  });
});

// ============================================================
// describeCalculationOutcome
//
// This is what the exported PDF prints. Both generators used to print
// "Not executed" for a failure, a blank and a never-run card alike, so a
// report read without the app in front of you could not tell them apart.
// ============================================================

describe('describeCalculationOutcome', () => {
  it('tells the three outcomes apart', () => {
    const failed = describeCalculationOutcome({
      error: '"Sales" has no column called "Nope".',
      evaluated: true,
    });
    const blank = describeCalculationOutcome({ result: null, evaluated: true });
    const never = describeCalculationOutcome({});

    expect(failed).toMatch(/^Failed: /);
    expect(blank).toBe('BLANK');
    expect(never).toBe('Not executed');
    expect(new Set([failed, blank, never]).size).toBe(3);
  });

  it('names the reason a calculation failed, not just that it did', () => {
    expect(
      describeCalculationOutcome({ error: 'There is no table called "Order".', evaluated: true })
    ).toContain('no table called "Order"');
  });

  it('never reports a failure as a value', () => {
    const described = describeCalculationOutcome({ error: 'boom', evaluated: true });
    expect(described).not.toBe('0');
    expect(described).not.toBe('BLANK');
  });

  it('renders a value exactly as the screen does', () => {
    expect(describeCalculationOutcome({ result: 825, evaluated: true })).toBe(
      formatDaxValue(825)
    );
  });

  it('matches what runDax produces, end to end', () => {
    const built = model();
    const outcome = runDax('SUM(Sales[Amount])', built);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(
        describeCalculationOutcome({ result: outcome.value, evaluated: true })
      ).toBe(formatDaxValue(825));
    }
  });
});

// ============================================================
// Reference building
// ============================================================

describe('columnRef / tableRef', () => {
  it('round-trips a plain name', () => {
    const node = parseDax(columnRef('Sales', 'Amount'));
    expect(node).toMatchObject({ kind: 'column', table: 'Sales', column: 'Amount' });
  });

  it('quotes a table name that is not a plain identifier', () => {
    const node = parseDax(columnRef('Q1 Sales', 'Net Amount'));
    expect(node).toMatchObject({ kind: 'column', table: 'Q1 Sales', column: 'Net Amount' });
  });

  it("escapes an apostrophe in a table name", () => {
    const node = parseDax(tableRef("Ama's Data"));
    expect(node).toMatchObject({ kind: 'table', name: "Ama's Data" });
  });

  it('escapes a closing bracket in a column name', () => {
    const node = parseDax(columnRef('Sales', 'Margin [%]'));
    expect(node).toMatchObject({ kind: 'column', column: 'Margin [%]' });
  });
});

// ============================================================
// suggestCalculations
//
// The point of this block: the formulas this generates are the ones the app
// shows by default, and the implementation it replaces produced text that was
// not DAX at all - SUM(Amount), COUNTROWS(Table). Nothing caught that, because
// the executor matched substrings and never parsed anything.
// ============================================================

describe('suggestCalculations', () => {
  it('produces formulas that all parse, validate and evaluate', () => {
    const built = model();
    const calculations = suggestCalculations(built);
    expect(calculations.length).toBeGreaterThan(0);

    const failures = calculations
      .map(calculation => ({ calculation, result: runDax(calculation.formula, built) }))
      .filter(entry => !entry.result.ok)
      .map(entry =>
        `${entry.calculation.name}: ${entry.calculation.formula} -> ${
          entry.result.ok ? '' : entry.result.message
        }`
      );

    expect(failures).toEqual([]);
  });

  it('qualifies every column reference with its table', () => {
    for (const calculation of suggestCalculations(model())) {
      // An unqualified [Column] reads as a measure in DAX and would resolve
      // against nothing. Every generated reference must name its table.
      expect(calculation.formula).not.toMatch(/(^|[^\w'\]])\[/);
    }
  });

  it('counts a key column instead of summing it', () => {
    const calculations = suggestCalculations(model());
    const orderId = calculations.filter(c => c.formula.includes('[OrderID]'));
    expect(orderId.length).toBeGreaterThan(0);
    for (const calculation of orderId) {
      expect(calculation.formula).not.toMatch(/^SUM\(/);
      expect(calculation.formula).not.toMatch(/^AVERAGE\(/);
    }
  });

  it('offers the four aggregations for a genuine measure column', () => {
    const formulas = suggestCalculations(model()).map(c => c.formula);
    expect(formulas).toContain('SUM(Sales[Amount])');
    expect(formulas).toContain('AVERAGE(Sales[Amount])');
    expect(formulas).toContain('MIN(Sales[Amount])');
    expect(formulas).toContain('MAX(Sales[Amount])');
  });

  it('counts rows per table, naming the table', () => {
    const formulas = suggestCalculations(model()).map(c => c.formula);
    expect(formulas).toContain('COUNTROWS(Sales)');
    expect(formulas).toContain('COUNTROWS(Customers)');
  });

  it('gives every calculation a distinct id', () => {
    const ids = suggestCalculations(model()).map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is stable across calls, so cards do not churn', () => {
    const built = model();
    expect(suggestCalculations(built).map(c => c.id)).toEqual(
      suggestCalculations(built).map(c => c.id)
    );
  });

  it('leaves the generated calendar out unless asked for it', () => {
    const built = model();
    expect(built.dateTableName).toBeTruthy();
    const names = suggestCalculations(built).map(c => c.formula);
    expect(names.some(f => f.includes(`COUNTROWS(${built.dateTableName})`))).toBe(false);
  });

  it('offers year to date only for a table joined to the calendar', () => {
    // Budgets has a genuine measure column but no date column, so it is not
    // joined to the generated calendar. TOTALYTD over it would still return
    // a number - the unfiltered total - because the calendar's filter never
    // reaches its rows. That is the exact failure the guard exists to stop,
    // so the fixture has to contain a table that would hit it.
    const budgets = makeDataset(
      [
        { BudgetID: 'B1', Target: 5000 },
        { BudgetID: 'B2', Target: 7000 },
      ],
      [
        { name: 'BudgetID', type: 'string' },
        { name: 'Target', type: 'number' },
      ],
      { id: 'ds-budgets', name: 'Budgets' }
    );
    const built = buildSemanticModel([sales(), budgets]);
    expect(built.dateTableName).toBeTruthy();

    const ytd = suggestCalculations(built).filter(c => c.formula.startsWith('TOTALYTD'));
    expect(ytd.length).toBeGreaterThan(0);
    for (const calculation of ytd) {
      expect(calculation.formula).toContain('Sales[');
      expect(calculation.formula).not.toContain('Budgets[');
    }
  });

  it('withholds year to date entirely when nothing is joined to a calendar', () => {
    const dateless = buildSemanticModel([customers()]);
    const formulas = suggestCalculations(dateless).map(c => c.formula);
    expect(formulas.some(f => f.startsWith('TOTALYTD'))).toBe(false);
  });

  it('skips an empty table rather than offering measures over nothing', () => {
    const empty = makeDataset([], [{ name: 'Amount', type: 'number' }], {
      id: 'ds-empty',
      name: 'Empty',
    });
    const built = buildSemanticModel([sales(), empty]);
    const formulas = suggestCalculations(built).map(c => c.formula);
    expect(formulas.some(f => f.includes('Empty'))).toBe(false);
  });

  it('can be restricted to one table', () => {
    const only = suggestCalculations(model(), { table: 'Customers' });
    expect(only.length).toBeGreaterThan(0);
    for (const calculation of only) expect(calculation.formula).toContain('Customers');
  });

  it('survives names that need quoting', () => {
    const awkward = makeDataset(
      [{ 'Net [Amount]': 10 }, { 'Net [Amount]': 20 }],
      [{ name: 'Net [Amount]', type: 'number' }],
      { id: 'ds-awkward', name: "Ama's Q1 Data" }
    );
    const built = buildSemanticModel([awkward]);
    for (const calculation of suggestCalculations(built)) {
      const result = runDax(calculation.formula, built);
      expect(result.ok, `${calculation.formula} failed`).toBe(true);
    }
  });
});

// ============================================================
// Table names that collide with function names
//
// A calendar called `Date` is the commonest table in any model, and DATE is
// also a DAX function, so bare Date[Date] reads ambiguously. Some tools
// accept it and others refuse, and a refusal in exported text surfaces as a
// broken paste rather than an error anyone can trace.
// ============================================================

describe('quoting a table named after a DAX function', () => {
  it('quotes it, so the reference cannot be read as a call', () => {
    expect(tableRef('Date')).toBe("'Date'");
    expect(columnRef('Date', 'Date')).toBe("'Date'[Date]");
  });

  it('quotes other function-named tables too, not just Date', () => {
    expect(tableRef('Calendar')).toBe("'Calendar'");
    expect(tableRef('Filter')).toBe("'Filter'");
    expect(tableRef('Union')).toBe("'Union'");
  });

  it('is case-insensitive, as DAX names are', () => {
    expect(tableRef('date')).toBe("'date'");
    expect(tableRef('DATE')).toBe("'DATE'");
  });

  it('leaves an ordinary table unquoted', () => {
    expect(tableRef('Sales')).toBe('Sales');
    expect(columnRef('Sales', 'Amount')).toBe('Sales[Amount]');
  });

  it('still round-trips through the parser', () => {
    expect(parseDax(columnRef('Date', 'Date'))).toMatchObject({
      kind: 'column',
      table: 'Date',
      column: 'Date',
    });
  });

  it('is what the generated model actually emits', () => {
    // The end-to-end check: the date table this engine builds is called
    // Date, so every measure referencing it must come out quoted.
    const built = model();
    expect(built.dateTableName).toBe('Date');
    const result = runDax(`COUNTROWS(${tableRef(built.dateTableName!)})`, built);
    expect(result.ok).toBe(true);
  });
});
