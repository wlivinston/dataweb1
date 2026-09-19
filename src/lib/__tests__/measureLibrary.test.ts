import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { parseDax } from '../dax/parser';
import {
  MEASURE_LIBRARY,
  availableMeasures,
  evaluateMeasure,
  formatMeasureValue,
  runMeasureLibrary,
  asSemanticMeasures,
  toPowerBiScript,
  templatesInPack,
} from '../measures';
import type { Dataset } from '../types';
import type { SemanticModel } from '../semantic/types';

/**
 * A shop's worth of data: revenue and cost on the same grain, repeated
 * customers and orders, two years of dates.
 */
const orders = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', ProductID: 'P1', Revenue: 100, Cost: 60, Quantity: 2, OrderDate: '2023-03-15' },
      { OrderID: 'O1', CustomerID: 'C1', ProductID: 'P2', Revenue: 200, Cost: 150, Quantity: 4, OrderDate: '2023-03-15' },
      { OrderID: 'O2', CustomerID: 'C2', ProductID: 'P1', Revenue: 300, Cost: 180, Quantity: 6, OrderDate: '2023-08-20' },
      { OrderID: 'O3', CustomerID: 'C1', ProductID: 'P3', Revenue: 400, Cost: 260, Quantity: 8, OrderDate: '2024-03-15' },
      { OrderID: 'O4', CustomerID: 'C3', ProductID: 'P2', Revenue: 500, Cost: 300, Quantity: 10, OrderDate: '2024-08-20' },
      { OrderID: 'O5', CustomerID: 'C2', ProductID: 'P1', Revenue: 600, Cost: 350, Quantity: 12, OrderDate: '2024-11-01' },
    ],
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'ProductID', type: 'string' },
      { name: 'Revenue', type: 'number' },
      { name: 'Cost', type: 'number' },
      { name: 'Quantity', type: 'number' },
      { name: 'OrderDate', type: 'date' },
    ],
    { id: 'ds-orders', name: 'Orders' }
  );

const model = (): SemanticModel => buildSemanticModel([orders()]);

const find = (built: SemanticModel, templateId: string) =>
  availableMeasures(built).find(measure => measure.template.id === templateId);

const valueOf = (built: SemanticModel, templateId: string) => {
  const measure = find(built, templateId);
  expect(measure, `${templateId} did not resolve`).toBeDefined();
  const result = evaluateMeasure(measure!, built);
  expect(result.error, `${templateId}: ${result.error}`).toBeUndefined();
  return result.value;
};

// ============================================================
// The library itself has to be well-formed
// ============================================================

describe('the measure library', () => {
  it('gives every template a unique id', () => {
    const ids = MEASURE_LIBRARY.map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes DAX that parses before any binding happens', () => {
    // Placeholders stand in for column references, so substituting a
    // plausible one must leave valid DAX. A template with a syntax error
    // would otherwise only surface when someone ran it.
    for (const template of MEASURE_LIBRARY) {
      const filled = template.dax
        .replace(/\{[A-Za-z0-9_]+:table\}/g, 'T')
        .replace(/\{[A-Za-z0-9_]+:year\}/g, 'T[Year]')
        .replace(/\{[A-Za-z0-9_]+\}/g, 'T[C]');
      expect(() => parseDax(filled), `${template.id}: ${filled}`).not.toThrow();
    }
  });

  it('only references slots it declares', () => {
    for (const template of MEASURE_LIBRARY) {
      const declared = new Set([...template.slots.map(slot => slot.name), 'calendar']);
      const used = [...template.dax.matchAll(/\{([A-Za-z0-9_]+)(?::table)?\}/g)].map(m => m[1]);
      for (const name of used) {
        expect(declared.has(name), `${template.id} uses {${name}}`).toBe(true);
      }
    }
  });

  it('declares needsCalendar for every template that uses one', () => {
    for (const template of MEASURE_LIBRARY) {
      if (template.dax.includes('{calendar')) {
        expect(template.needsCalendar, `${template.id}`).toBe(true);
      }
    }
  });

  it('sorts every template into a pack that can be listed', () => {
    const packed = (['sales', 'finance', 'customer', 'inventory', 'operations'] as const).flatMap(
      pack => templatesInPack(pack)
    );
    expect(packed).toHaveLength(MEASURE_LIBRARY.length);
  });
});

// ============================================================
// Resolution: the DAX has to actually run
// ============================================================

describe('resolving against a model', () => {
  it('produces measures that all parse, validate and evaluate', () => {
    // The check that could not exist before the engine did. A template that
    // binds to the wrong kind of column produces DAX that fails here rather
    // than a number in the UI that nobody questions.
    const built = model();
    const results = runMeasureLibrary(built);
    expect(results.length).toBeGreaterThan(0);

    const failures = results
      .filter(result => result.error)
      .map(result => `${result.measure.name}: ${result.measure.dax} -> ${result.error}`);
    expect(failures).toEqual([]);
  });

  it('gives every resolved measure a value and an interpretation, or an error', () => {
    for (const result of runMeasureLibrary(model())) {
      if (result.error) {
        expect(result.value).toBeUndefined();
        expect(result.interpretation).toBeUndefined();
      } else {
        expect(result.formatted).toBeDefined();
        expect(result.interpretation!.length).toBeGreaterThan(0);
      }
    }
  });

  it('qualifies every column reference with its table', () => {
    for (const measure of availableMeasures(model())) {
      // A bare [Column] reads as a measure reference in DAX and would
      // resolve against nothing.
      expect(measure.dax, measure.template.id).not.toMatch(/(^|[^\w'\]])\[/);
    }
  });

  it('explains which column filled each slot', () => {
    for (const measure of availableMeasures(model())) {
      for (const binding of measure.bindings) {
        expect(binding.reason).toContain(binding.column.name);
        expect(binding.reason.length).toBeGreaterThan(20);
      }
    }
  });

  it('gives every resolved measure a distinct id', () => {
    const ids = availableMeasures(model()).map(measure => measure.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is stable across calls', () => {
    const built = model();
    expect(availableMeasures(built).map(m => m.id)).toEqual(
      availableMeasures(built).map(m => m.id)
    );
  });
});

// ============================================================
// The numbers
// ============================================================

describe('the measures compute what they claim', () => {
  // Revenue 100+200+300+400+500+600 = 2100. Cost 60+150+180+260+300+350 = 1300.
  it('totals revenue', () => {
    expect(valueOf(model(), 'total-revenue')).toBe(2100);
  });

  it('counts distinct orders rather than rows', () => {
    // Five orders across six rows: O1 appears twice.
    expect(valueOf(model(), 'order-count')).toBe(5);
    expect(valueOf(model(), 'row-count')).toBe(6);
  });

  it('divides revenue by distinct orders, not by rows', () => {
    expect(valueOf(model(), 'average-order-value')).toBeCloseTo(2100 / 5, 9);
  });

  it('computes gross profit and margin from the same two columns', () => {
    expect(valueOf(model(), 'gross-profit')).toBe(2100 - 1300);
    expect(valueOf(model(), 'gross-margin-percent')).toBeCloseTo(800 / 2100, 9);
  });

  it('counts distinct customers', () => {
    expect(valueOf(model(), 'customer-count')).toBe(3);
    expect(valueOf(model(), 'revenue-per-customer')).toBeCloseTo(2100 / 3, 9);
  });

  it('computes revenue per unit rather than the average of prices', () => {
    const units = 2 + 4 + 6 + 8 + 10 + 12;
    expect(valueOf(model(), 'units-sold')).toBe(units);
    expect(valueOf(model(), 'average-unit-price')).toBeCloseTo(2100 / units, 9);
  });

  it('reports completeness as a share of rows', () => {
    expect(valueOf(model(), 'completeness-percent')).toBe(1);
  });
});

// ============================================================
// Slot binding: roles decide, names only rank
// ============================================================

describe('binding columns to slots', () => {
  it('picks the revenue column for revenue and the cost column for cost', () => {
    const built = model();
    const margin = find(built, 'gross-margin-percent')!;
    const bound = Object.fromEntries(
      margin.bindings.map(binding => [binding.slot.name, binding.column.name])
    );
    expect(bound.amount).toBe('Revenue');
    expect(bound.cost).toBe('Cost');
  });

  it('never binds two slots to the same column', () => {
    for (const measure of availableMeasures(model())) {
      const used = measure.bindings.map(binding => binding.column.name);
      expect(new Set(used).size, measure.template.id).toBe(used.length);
    }
  });

  it('refuses a measure whose required column has no candidate', () => {
    // No cost column anywhere, so margin cannot be computed - and is not
    // offered with some other numeric column standing in for cost.
    const noCost = makeDataset(
      [
        { OrderID: 'O1', Revenue: 100, OrderDate: '2024-01-01' },
        { OrderID: 'O2', Revenue: 200, OrderDate: '2024-02-01' },
      ],
      [
        { name: 'OrderID', type: 'string' },
        { name: 'Revenue', type: 'number' },
        { name: 'OrderDate', type: 'date' },
      ],
      { id: 'ds-nocost', name: 'Orders' }
    );
    const built = buildSemanticModel([noCost]);
    expect(find(built, 'gross-margin-percent')).toBeUndefined();
    expect(find(built, 'total-revenue')).toBeDefined();
  });

  it('does not offer a money measure over an identifier, however it is named', () => {
    // "Total" in the name must not promote a column the model reads as a key.
    const built = model();
    for (const measure of availableMeasures(built)) {
      for (const binding of measure.bindings) {
        if (binding.slot.name === 'amount' || binding.slot.name === 'cost') {
          expect(binding.column.role, `${measure.template.id}/${binding.column.name}`).toBe(
            'measure'
          );
        }
      }
    }
  });

  it('prefers the revenue column over the quantity column for money', () => {
    const built = model();
    expect(find(built, 'total-revenue')!.bindings[0].column.name).toBe('Revenue');
  });
});

// ============================================================
// Time intelligence, and the join it depends on
// ============================================================

describe('time-intelligence measures', () => {
  it('are offered when the table is joined to the calendar', () => {
    const built = model();
    expect(built.dateTableName).toBeTruthy();
    expect(find(built, 'revenue-ytd')).toBeDefined();
    expect(find(built, 'revenue-prior-year')).toBeDefined();
    expect(find(built, 'revenue-yoy-percent')).toBeDefined();
  });

  it('anchor their own period instead of spanning the whole history', () => {
    // The bug this replaced: an unanchored YoY compared SUM over EVERY year
    // against one year, and reported the ratio as growth. On this fixture
    // that gave 250% where the truth is (1500-600)/600 = 150%.
    const built = model();
    expect(valueOf(built, 'revenue-yoy-percent')).toBeCloseTo((1500 - 600) / 600, 9);
    expect(valueOf(built, 'revenue-prior-year')).toBe(600);
  });

  it('follow a surrounding filter rather than overriding it', () => {
    // LatestYear is read from the context around the measure, so filtering
    // to 2023 makes the comparison 2023 against 2022 - not 2024 against
    // 2023. A measure that pinned its own year would ignore the slicer and
    // quietly answer a different question.
    const built = model();
    const year = `'${built.dateTableName}'[Year]`;
    const prior = find(built, 'revenue-prior-year')!;

    const in2024 = runDax(`CALCULATE(${prior.dax}, ${year} = 2024)`, built);
    expect(in2024.ok).toBe(true);
    if (in2024.ok) expect(in2024.value).toBe(600);

    // 2022 has no rows, so the prior-year figure for 2023 is blank, not zero.
    const in2023 = runDax(`CALCULATE(${prior.dax}, ${year} = 2023)`, built);
    expect(in2023.ok).toBe(true);
    if (in2023.ok) expect(in2023.value).toBeNull();
  });

  it('accumulate year to date over the latest year in scope', () => {
    // 2024 rows only: 400 + 500 + 600.
    expect(valueOf(model(), 'revenue-ytd')).toBe(1500);
  });

  it('are withheld when the calendar carries no year column to anchor on', () => {
    const built = model();
    const stripped: SemanticModel = {
      ...built,
      tables: built.tables.map(table =>
        table.name === built.dateTableName
          ? { ...table, columns: table.columns.filter(column => column.name !== 'Year') }
          : table
      ),
    };
    expect(find(stripped, 'revenue-yoy-percent')).toBeUndefined();
    // The one that needs only the date column survives.
    expect(find(stripped, 'revenue-ytd')).toBeDefined();
  });

  it('are withheld entirely when nothing is joined to a calendar', () => {
    // A table with money but no dates. TOTALYTD over it would still return a
    // number - the grand total - labelled year to date.
    const dateless = makeDataset(
      [
        { OrderID: 'O1', Revenue: 100 },
        { OrderID: 'O2', Revenue: 200 },
      ],
      [
        { name: 'OrderID', type: 'string' },
        { name: 'Revenue', type: 'number' },
      ],
      { id: 'ds-dateless', name: 'Orders' }
    );
    const built = buildSemanticModel([dateless]);
    expect(built.dateTableName).toBeNull();
    expect(find(built, 'revenue-ytd')).toBeUndefined();
    expect(find(built, 'total-revenue')).toBeDefined();
  });
});

// ============================================================
// Formatting and interpretation
// ============================================================

describe('formatting', () => {
  it('renders a percentage as a percentage, not a fraction', () => {
    expect(formatMeasureValue(0.4235, 'percent')).toBe('42.4%');
  });

  it('never invents a currency symbol', () => {
    const rendered = formatMeasureValue(1234.5, 'currency');
    expect(rendered).not.toMatch(/[$£€₵]/);
    expect(rendered).toContain('1,234.5');
  });

  it('shows BLANK as a word rather than an empty string or a zero', () => {
    expect(formatMeasureValue(null, 'currency')).toBe('BLANK');
    expect(formatMeasureValue(0, 'currency')).not.toBe('BLANK');
  });

  it('rounds an integer measure', () => {
    expect(formatMeasureValue(5.6, 'integer')).toBe('6');
  });
});

/** A judgement the data cannot support, as opposed to merely the word. */
const VERDICT = /\b(is|looks|seems|remains|stays)\s+(healthy|poor|good|bad|excellent|weak|strong)\b/i;

describe('interpretation', () => {
  it('states what the number is made of, naming the bound column', () => {
    const built = model();
    const result = evaluateMeasure(find(built, 'gross-profit')!, built);
    expect(result.interpretation).toContain('Cost');
    expect(result.interpretation).toContain('Revenue');
  });

  it('never claims a currency', () => {
    for (const result of runMeasureLibrary(model())) {
      expect(result.interpretation ?? '').not.toMatch(/[$£€₵]|dollars|pounds|cedis|euros/i);
    }
  });

  it('says a blank is not a zero', () => {
    const built = model();
    const measure = find(built, 'total-revenue')!;
    const filtered = { ...measure, dax: `CALCULATE(${measure.dax}, Orders[CustomerID] = "nobody")` };
    const result = evaluateMeasure(filtered, built);
    expect(result.value).toBeNull();
    expect(result.interpretation).toMatch(/not the same as a total of zero/);
  });

  it('refuses to call a margin good or bad', () => {
    // A blanket verdict is wrong for somebody: 3% is fine for a wholesaler
    // and dire for a consultancy. This looks for an ASSERTION - "is healthy"
    // - rather than the word alone, because saying what a margin does NOT
    // tell you is exactly the sentence worth keeping.
    const built = model();
    const result = evaluateMeasure(find(built, 'gross-margin-percent')!, built);
    expect(result.interpretation).not.toMatch(VERDICT);
    expect(result.interpretation).toMatch(/depends/);
  });

  it('applies that restraint to every interpretation, not just the margin', () => {
    for (const result of runMeasureLibrary(model())) {
      expect(result.interpretation ?? '', result.measure.template.id).not.toMatch(VERDICT);
    }
  });
});

// ============================================================
// Export
// ============================================================

describe('export to Power BI', () => {
  it('emits the same DAX the engine ran, not a re-rendering of it', () => {
    const measures = availableMeasures(model());
    const script = toPowerBiScript(measures);
    for (const measure of measures) {
      expect(script).toContain(measure.dax);
    }
  });

  it('records which column filled each slot, so the export is auditable', () => {
    const script = toPowerBiScript(availableMeasures(model()));
    expect(script).toContain('Orders[Revenue]');
    expect(script).toMatch(/\/\/\s+amount:/);
  });

  it('says so plainly when nothing matched', () => {
    expect(toPowerBiScript([])).toMatch(/No measures matched/);
  });

  it('turns measures into model measures that can be referenced by name', () => {
    const built = model();
    const semantic = asSemanticMeasures(availableMeasures(built));
    const withMeasures = buildSemanticModel([orders()], { measures: semantic });

    const result = runDax('[Total Revenue]', withMeasures);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2100);
  });
});

// ============================================================
// Fixtures built to make the guards fire
//
// The fixture above is too well behaved: every column is unambiguous, so
// binding succeeds no matter how carelessly it is done. Removing the role
// check, the duplicate-slot check, the calendar-join check and the
// required-slot check all left that fixture passing. These do not.
// ============================================================

describe('role is a hard filter, not a preference', () => {
  /**
   * A NUMERIC key whose name is full of money words.
   *
   * It has to be numeric: the money slots also declare dataType, and a
   * string key is rejected by that before role is ever consulted. An earlier
   * version of this fixture used a string, so deleting the role check left
   * it passing and proved nothing.
   */
  const temptingKey = () =>
    buildSemanticModel([
      makeDataset(
        [
          { TotalValueNo: 5001, Revenue: 100, OrderDate: '2024-01-05' },
          { TotalValueNo: 5002, Revenue: 200, OrderDate: '2024-02-05' },
          { TotalValueNo: 5003, Revenue: 100, OrderDate: '2024-03-05' },
          { TotalValueNo: 5004, Revenue: 200, OrderDate: '2024-04-05' },
        ],
        [
          { name: 'TotalValueNo', type: 'number' },
          { name: 'Revenue', type: 'number' },
          { name: 'OrderDate', type: 'date' },
        ],
        { id: 'ds-tempting', name: 'Orders' }
      ),
    ]);

  it('reads the tempting column as a key, or the next test proves nothing', () => {
    const column = temptingKey()
      .tables.find(table => table.name === 'Orders')!
      .columns.find(candidate => candidate.name === 'TotalValueNo')!;
    expect(column.role).toBe('key');
    expect(column.dataType).toBe('number');
  });

  it('never sums an identifier, however flattering its name', () => {
    // TotalValueNo mentions "total" and "value" and out-scores Revenue on
    // name alone. It identifies a row, so it is not summable, and the role
    // says so whatever it is called.
    const built = temptingKey();
    const revenue = find(built, 'total-revenue');
    expect(revenue).toBeDefined();
    expect(revenue!.bindings[0].column.name).toBe('Revenue');
    expect(revenue!.dax).not.toContain('TotalValueNo');
  });
});

describe('a table with only one numeric column', () => {
  /** Repeated values, so the column is read as a measure rather than a key. */
  const oneMeasure = () =>
    buildSemanticModel([
      makeDataset(
        [
          { OrderID: 'O1', Value: 100, OrderDate: '2024-01-05' },
          { OrderID: 'O2', Value: 200, OrderDate: '2024-02-05' },
          { OrderID: 'O3', Value: 100, OrderDate: '2024-03-05' },
          { OrderID: 'O4', Value: 200, OrderDate: '2024-04-05' },
        ],
        [
          { name: 'OrderID', type: 'string' },
          { name: 'Value', type: 'number' },
          { name: 'OrderDate', type: 'date' },
        ],
        { id: 'ds-one', name: 'Orders' }
      ),
    ]);

  it('confirms the column really is a measure, or the rest proves nothing', () => {
    // Named "Value" rather than "Revenue" on purpose: the cost slot penalises
    // revenue-sounding names, and that penalty alone was enough to keep
    // gross margin away. With a neutral name both slots want this column and
    // only the duplicate check stands between them.
    const value = oneMeasure()
      .tables.find(table => table.name === 'Orders')!
      .columns.find(column => column.name === 'Value')!;
    expect(value.role).toBe('measure');
  });

  it('does not use the same column as both revenue and cost', () => {
    // DIVIDE(x - x, x) is zero however the data looks, and a gross margin
    // that is always exactly 0% is worse than no gross margin.
    const built = oneMeasure();
    expect(find(built, 'gross-margin-percent')).toBeUndefined();
    expect(find(built, 'gross-profit')).toBeUndefined();
    expect(find(built, 'total-revenue')).toBeDefined();
  });

  it('withholds anything needing a quantity when there is none', () => {
    const built = oneMeasure();
    expect(find(built, 'units-sold')).toBeUndefined();
    expect(find(built, 'average-unit-price')).toBeUndefined();
  });
});

describe('a table that is not joined to the calendar', () => {
  /** Orders carries dates; Budgets carries money and none. */
  const mixed = () =>
    buildSemanticModel([
      makeDataset(
        [
          { OrderID: 'O1', Revenue: 100, OrderDate: '2023-05-05' },
          { OrderID: 'O2', Revenue: 200, OrderDate: '2024-05-05' },
          { OrderID: 'O3', Revenue: 300, OrderDate: '2024-06-05' },
        ],
        [
          { name: 'OrderID', type: 'string' },
          { name: 'Revenue', type: 'number' },
          { name: 'OrderDate', type: 'date' },
        ],
        { id: 'ds-mixed-orders', name: 'Orders' }
      ),
      makeDataset(
        [
          { BudgetID: 'B1', Target: 5000 },
          { BudgetID: 'B2', Target: 7000 },
          { BudgetID: 'B3', Target: 5000 },
        ],
        [
          { name: 'BudgetID', type: 'string' },
          { name: 'Target', type: 'number' },
        ],
        { id: 'ds-mixed-budgets', name: 'Budgets' }
      ),
    ]);

  it('has a calendar, so the guard is reached rather than short-circuited', () => {
    expect(mixed().dateTableName).toBeTruthy();
  });

  it('offers time intelligence only over the joined table', () => {
    // Over Budgets, TOTALYTD still returns a number - the grand total -
    // because the calendar's filter never reaches those rows. A figure
    // labelled year to date that is really an all-time total is the worst
    // kind of wrong, so the measure is withheld rather than captioned.
    const measures = availableMeasures(mixed(), { perTemplate: 5 });
    const timed = measures.filter(measure => measure.template.needsCalendar);
    expect(timed.length).toBeGreaterThan(0);
    for (const measure of timed) {
      expect(measure.table, measure.template.id).toBe('Orders');
    }
  });

  it('still offers plain aggregations over the unjoined table', () => {
    const measures = availableMeasures(mixed(), { perTemplate: 5 });
    expect(measures.some(measure => measure.table === 'Budgets')).toBe(true);
  });
});

describe('a measure that fails to evaluate', () => {
  it('carries the reason and no narration', () => {
    // Nothing in the library fails on a sound model, so the failure path has
    // to be provoked. Narrating a number that does not exist is how a report
    // ends up confidently describing nothing.
    const built = model();
    const sound = find(built, 'total-revenue')!;
    const broken = { ...sound, dax: 'SUM(Orders[NoSuchColumn])' };

    const result = evaluateMeasure(broken, built);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/NoSuchColumn/);
    expect(result.value).toBeUndefined();
    expect(result.formatted).toBeUndefined();
    expect(result.interpretation).toBeUndefined();
  });
});

describe('a table with no identifier columns at all', () => {
  /**
   * Nothing here can fill a customer, order or product slot. That makes the
   * required-slot check load-bearing: without it the template is filled with
   * a placeholder that was never bound, and the substitution throws rather
   * than producing DAX.
   */
  const anonymous = () =>
    buildSemanticModel([
      makeDataset(
        [
          { Revenue: 100, Cost: 40, OrderDate: '2024-01-05' },
          { Revenue: 200, Cost: 80, OrderDate: '2024-02-05' },
          { Revenue: 100, Cost: 40, OrderDate: '2024-03-05' },
          { Revenue: 200, Cost: 80, OrderDate: '2024-04-05' },
        ],
        [
          { name: 'Revenue', type: 'number' },
          { name: 'Cost', type: 'number' },
          { name: 'OrderDate', type: 'date' },
        ],
        { id: 'ds-anon', name: 'Orders' }
      ),
    ]);

  it('really has no key or foreign-key column, or the rest proves nothing', () => {
    const roles = anonymous()
      .tables.find(table => table.name === 'Orders')!
      .columns.map(column => column.role);
    expect(roles).not.toContain('key');
    expect(roles).not.toContain('foreignKey');
  });

  it('resolves without throwing, and simply omits what it cannot fill', () => {
    expect(() => availableMeasures(anonymous())).not.toThrow();

    const built = anonymous();
    for (const id of ['order-count', 'customer-count', 'product-count', 'average-order-value']) {
      expect(find(built, id), id).toBeUndefined();
    }
  });

  it('still offers everything that needs only measures', () => {
    const built = anonymous();
    expect(find(built, 'total-revenue')).toBeDefined();
    expect(find(built, 'gross-margin-percent')).toBeDefined();
  });
});
