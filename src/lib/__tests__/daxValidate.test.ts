import { describe, it, expect } from 'vitest';
import { parseDax } from '../dax/parser';
import { validateDax, isValid, type DaxIssue } from '../dax/validate';
import {
  allFunctions,
  formatSignature,
  lookupFunction,
  maxArity,
  minArity,
  suggestFunctionNames,
} from '../dax/registry';
import { buildSemanticModel } from '../semantic/model';
import { makeDataset } from './fixtures';
import type { SemanticMeasure } from '../semantic/types';
import type { Dataset } from '../types';

const salesDataset = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', Amount: 100, Qty: 2, OrderDate: '2024-01-15' },
      { OrderID: 'O2', CustomerID: 'C2', Amount: 250, Qty: 5, OrderDate: '2024-02-20' },
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

const customersDataset = (): Dataset =>
  makeDataset(
    [
      { CustomerID: 'C1', Region: 'Greater Accra' },
      { CustomerID: 'C2', Region: 'Ashanti' },
    ],
    [
      { name: 'CustomerID', type: 'string' },
      { name: 'Region', type: 'string' },
    ],
    { id: 'ds-customers', name: 'Customers' }
  );

const measures: SemanticMeasure[] = [
  { name: 'Total Revenue', expression: 'SUM(Sales[Amount])' },
];

const model = () =>
  buildSemanticModel([salesDataset(), customersDataset()], { measures });

const check = (source: string, options = {}): DaxIssue[] =>
  validateDax(parseDax(source), model(), options);

describe('registry', () => {
  it('computes arity from the signature', () => {
    const divide = lookupFunction('DIVIDE')!;
    expect(minArity(divide)).toBe(2);
    expect(maxArity(divide)).toBe(3);

    const calculate = lookupFunction('CALCULATE')!;
    expect(minArity(calculate)).toBe(1);
    expect(maxArity(calculate)).toBe(Infinity);
  });

  it('looks functions up case-insensitively', () => {
    expect(lookupFunction('sum')?.name).toBe('SUM');
    expect(lookupFunction('SuMx')?.name).toBe('SUMX');
  });

  it('renders a signature the way documentation would', () => {
    expect(formatSignature(lookupFunction('DIVIDE')!)).toBe(
      'DIVIDE(numerator, denominator, [alternateResult])'
    );
    expect(formatSignature(lookupFunction('CALCULATE')!)).toBe(
      'CALCULATE(expression, [filter], ...)'
    );
  });

  it('suggests near misses but not distant ones', () => {
    expect(suggestFunctionNames('SUMM')).toContain('SUM');
    expect(suggestFunctionNames('AVERGE')).toContain('AVERAGE');
    expect(suggestFunctionNames('QQQQZZZZ')).toEqual([]);
  });

  it('reports nothing as implemented until the evaluator exists', () => {
    // Guards against the registry quietly overstating what the product can
    // actually calculate.
    expect(allFunctions().every(f => !f.implemented)).toBe(true);
  });

  it('gives every function a description and a unique name', () => {
    const names = allFunctions().map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const signature of allFunctions()) {
      expect(signature.description.length, signature.name).toBeGreaterThan(10);
    }
  });

  it('never marks a required parameter after an optional one', () => {
    // A signature like f(a, [b], c) cannot be satisfied by any argument count,
    // so minArity would be a lie.
    for (const signature of allFunctions()) {
      const firstOptional = signature.parameters.findIndex(p => p.optional);
      if (firstOptional === -1) continue;
      const after = signature.parameters.slice(firstOptional);
      expect(after.every(p => p.optional), signature.name).toBe(true);
    }
  });
});

describe('validateDax: function names', () => {
  it('accepts a well-formed expression', () => {
    const issues = check('SUM(Sales[Amount])');
    expect(issues).toEqual([]);
    expect(isValid(issues)).toBe(true);
  });

  it('rejects an unknown function and suggests the likely one', () => {
    const issues = check('SUMM(Sales[Amount])');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unknown_function');
    expect(issues[0].message).toMatch(/no DAX function called SUMM/);
    expect(issues[0].message).toMatch(/Did you mean .*SUM/);
  });

  it('underlines the function name, not the whole call', () => {
    // The reason the parser records nameStart and nameLength.
    const issues = check('SUMM(Sales[Amount])');
    expect(issues[0].start).toBe(0);
    expect(issues[0].length).toBe(4);
  });

  it('finds an unknown function nested deep in an expression', () => {
    const issues = check('CALCULATE(NOTAREALFUNC(Sales[Amount]), Sales[Qty] > 1)');
    expect(issues.some(i => i.code === 'unknown_function')).toBe(true);
  });

  it('does not report unimplemented functions by default', () => {
    // Recognising more than we run is deliberate: measures must be storable
    // and exportable before they are executable.
    expect(check('SUM(Sales[Amount])')).toEqual([]);
  });

  it('reports unimplemented functions when asked', () => {
    const issues = check('SUM(Sales[Amount])', { requireImplemented: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('not_implemented');
    expect(issues[0].severity).toBe('warning');
    // A warning, so the expression is still considered usable.
    expect(isValid(issues)).toBe(true);
  });
});

describe('validateDax: arity', () => {
  it('rejects too few arguments and quotes the signature', () => {
    const issues = check('DIVIDE(Sales[Amount])');
    expect(issues[0].code).toBe('arity');
    expect(issues[0].message).toMatch(/needs at least 2 arguments but was given 1/);
    expect(issues[0].message).toMatch(/DIVIDE\(numerator, denominator, \[alternateResult\]\)/);
  });

  it('rejects too many arguments', () => {
    const issues = check('SUM(Sales[Amount], Sales[Qty])');
    expect(issues.some(i => i.code === 'arity')).toBe(true);
    expect(issues[0].message).toMatch(/takes at most 1 argument but was given 2/);
  });

  it('accepts an optional argument being supplied or omitted', () => {
    expect(check('DIVIDE(Sales[Amount], Sales[Qty])')).toEqual([]);
    expect(check('DIVIDE(Sales[Amount], Sales[Qty], 0)')).toEqual([]);
  });

  it('accepts any number of filters on a variadic function', () => {
    expect(check('CALCULATE(SUM(Sales[Amount]))')).toEqual([]);
    expect(
      check('CALCULATE(SUM(Sales[Amount]), Sales[Qty] > 1, Customers[Region] = "Ashanti")')
    ).toEqual([]);
  });

  it('accepts a zero-argument function called with no arguments', () => {
    expect(check('YEAR(TODAY())')).toEqual([]);
  });

  it('counts COUNTROWS with no argument as valid', () => {
    expect(check('COUNTROWS(Sales)')).toEqual([]);
    expect(check('COUNTROWS()')).toEqual([]);
  });
});

describe('validateDax: argument types', () => {
  it('rejects an expression where a column is required, and names the iterator', () => {
    // The classic mistake. SUM cannot take an expression; SUMX can.
    const issues = check('SUM(Sales[Qty] * Sales[Amount])');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('argument_type');
    expect(issues[0].message).toMatch(/SUM expects a column reference/);
    expect(issues[0].message).toMatch(/use SUMX/);
  });

  it('accepts the iterator form of the same calculation', () => {
    expect(check('SUMX(Sales, Sales[Qty] * Sales[Amount])')).toEqual([]);
  });

  it('rejects a scalar where a table is required', () => {
    const issues = check('FILTER(Sales[Amount], Sales[Qty] > 1)');
    expect(issues[0].code).toBe('argument_type');
    expect(issues[0].message).toMatch(/expects a table/);
  });

  it('accepts a function that returns a table where a table is required', () => {
    expect(check('FILTER(ALL(Sales), Sales[Qty] > 1)')).toEqual([]);
    expect(check('COUNTROWS(FILTER(Sales, Sales[Qty] > 1))')).toEqual([]);
  });

  it('rejects a table where a single value is required', () => {
    const issues = check('CALCULATE(Sales, Sales[Qty] > 1)');
    expect(issues[0].code).toBe('argument_type');
    expect(issues[0].message).toMatch(/expects a single value/);
  });

  it('does not second-guess a variable, whose type it cannot know', () => {
    // Reporting a type error here would be a false positive on valid DAX.
    expect(check('VAR t = FILTER(Sales, Sales[Qty] > 1) RETURN COUNTROWS(t)')).toEqual([]);
  });

  it('checks the arguments of a variadic function that it does declare', () => {
    const issues = check('ALLEXCEPT(Sales[Amount], Sales[CustomerID])');
    expect(issues.some(i => i.code === 'argument_type')).toBe(true);
  });
});

describe('validateDax: model references', () => {
  it('rejects a column that does not exist and lists the real ones', () => {
    const issues = check('SUM(Sales[Amonut])');
    expect(issues[0].code).toBe('unknown_column');
    expect(issues[0].message).toMatch(/no column called "Amonut"/);
    expect(issues[0].message).toMatch(/Amount/);
  });

  it('rejects a table that does not exist', () => {
    const issues = check('SUM(Slaes[Amount])');
    expect(issues[0].code).toBe('unknown_table');
    expect(issues[0].message).toMatch(/no table called "Slaes"/);
  });

  it('explains that bare brackets mean a measure, not a column', () => {
    // The commonest way to land here is writing [Amount] for Sales[Amount].
    // DAX reads bare brackets as a measure reference, so listing the defined
    // measures would be unhelpful; naming the column is what is wanted.
    const issues = check('DISTINCTCOUNT([CustomerID])');
    const measureIssue = issues.find(i => i.code === 'unknown_measure');

    expect(measureIssue).toBeDefined();
    expect(measureIssue?.message).toMatch(/Bare brackets mean a measure/);
    expect(measureIssue?.message).toMatch(/Sales\[CustomerID\] or Customers\[CustomerID\]/);
  });

  it('accepts a measure that is defined', () => {
    expect(check('[Total Revenue] * 2')).toEqual([]);
  });

  it('rejects a measure that is not defined and lists those that are', () => {
    const issues = check('[Total Profit] * 2');
    expect(issues[0].code).toBe('unknown_measure');
    expect(issues[0].message).toMatch(/no measure called \[Total Profit\]/);
    expect(issues[0].message).toMatch(/Total Revenue/);
  });

  it('resolves names case-insensitively, as DAX does', () => {
    expect(check('sum(sales[amount])')).toEqual([]);
    expect(check('[total revenue]')).toEqual([]);
  });

  it('accepts a column on the generated date table', () => {
    expect(check('CALCULATE(SUM(Sales[Amount]), Date[FiscalYear] = 2024)')).toEqual([]);
  });

  it('underlines the offending reference, not the whole expression', () => {
    const source = 'SUM(Sales[Amount]) + SUM(Sales[Bogus])';
    const issues = check(source);
    expect(issues).toHaveLength(1);
    expect(source.slice(issues[0].start, issues[0].start + issues[0].length)).toBe(
      'Sales[Bogus]'
    );
  });
});

describe('validateDax: reporting', () => {
  it('reports every problem in one pass rather than stopping at the first', () => {
    const issues = check('SUMM(Sales[Bogus]) + DIVIDE(Sales[Amount])');
    const codes = issues.map(i => i.code).sort();
    expect(codes).toEqual(['arity', 'unknown_column', 'unknown_function']);
  });

  it('treats a model with no measures gracefully', () => {
    const bare = buildSemanticModel([salesDataset()]);
    const issues = validateDax(parseDax('[Anything]'), bare);
    expect(issues[0].message).toMatch(/No measures are defined/);
  });

  it('validates inside VAR declarations as well as the RETURN body', () => {
    const issues = check('VAR x = SUM(Sales[Bogus]) RETURN x + 1');
    expect(issues.some(i => i.code === 'unknown_column')).toBe(true);
  });

  it('validates inside an IN list', () => {
    const issues = check('Sales[Bogus] IN {"a", "b"}');
    expect(issues.some(i => i.code === 'unknown_column')).toBe(true);
  });
});
