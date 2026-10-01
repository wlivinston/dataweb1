import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { buildCrossTableScript } from './fixtures/powerbi/script';
import {
  CROSSTABLE_CASES,
  pendingCrossTableCount,
} from './fixtures/powerbi/crosstable-expected';
import { FIXTURE_DIR, loadOrders, loadCustomers } from './fixtures/powerbi/load';
import { propagationPath, filterReaches } from '../semantic/propagation';

/**
 * Figures that cross a relationship, checked against Power BI.
 *
 * Nothing on this sheet has a Power BI answer yet. That is deliberate and it
 * is stated rather than hidden: the engine answers below are asserted as
 * HAND-COMPUTED values - every one of them can be checked against the data
 * in crosstable-expected.ts with no engine involved - and the Power BI
 * column stays null until somebody runs crosstable-script.dax and reads it
 * off. Filling `expected` with whatever this engine returns would turn the
 * sheet from a test into a mirror.
 *
 * So this file does two separate jobs, and keeps them separate:
 *
 *   1. The engine is right about arithmetic a person can do on paper. These
 *      run now.
 *   2. The engine agrees with Power BI. These skip until answered.
 */

const model = buildSemanticModel([loadOrders(), loadCustomers()]);

const answerFor = (dax: string): string => {
  const result = runDax(dax, model);
  if (!result.ok) return `ERROR: ${result.message}`;
  return result.value === null ? 'BLANK' : String(result.value);
};

/** The items of a flattened table, as a set, for order-free comparison. */
const items = (text: string): string => text.trim().split('>').sort().join('>');

const agrees = (engine: string, expected: number | string, unordered = false): boolean => {
  if (typeof expected === 'number') {
    const parsed = Number(engine.replace(/,/g, ''));
    if (Number.isNaN(parsed)) return false;
    return Math.abs(parsed - expected) <= Math.max(Math.abs(expected) * 1e-6, 1e-6);
  }
  if (unordered) return items(engine) === items(expected);
  return engine.trim() === expected.trim();
};

describe('the two-table fixture', () => {
  it('joins Orders to Customers on CustomerID, one way', () => {
    // Everything on this sheet depends on this relationship existing and
    // pointing the way it points. Asserted rather than assumed, because a
    // model without it answers every case with the grand total and every
    // answer still looks like a number.
    const join = model.relationships.find(
      relationship =>
        relationship.from.table === 'Orders' && relationship.to.table === 'Customers'
    );
    expect(join, 'Orders -> Customers was not detected').toBeDefined();
    expect(join!.from.column).toBe('CustomerID');
    expect(join!.to.column).toBe('CustomerID');
    expect(join!.isActive).toBe(true);
    expect(join!.crossFilter, 'a bidirectional join would change half this sheet').toBe(
      'single'
    );
    expect(join!.integrity, 'some order points at a customer that does not exist').toBe(1);
  });

  it('carries a filter from Customers into Orders, and not back', () => {
    expect(filterReaches(model, 'Customers', 'Orders')).toBe(true);
    expect(
      filterReaches(model, 'Orders', 'Customers'),
      'a filter on the fact must not narrow the dimension'
    ).toBe(false);

    const path = propagationPath(model, 'Customers', 'Orders');
    expect(path!.tables).toEqual(['Customers', 'Orders']);
    expect(path!.usesBidirectional).toBe(false);
  });
});

describe('crossing the join, checked by hand', () => {
  // Orders  C1 100+200+400 = 700, C2 300+600 = 900, C3 500. Total 2100.
  // Customers  C1 Ghana Retail 1000, C2 Kenya Retail 2000,
  //            C3 Ghana Wholesale 0, C4 Kenya Wholesale 500, no orders.

  it('adds two customers together to make a country', () => {
    // Ghana is C1 and C3: 700 + 500. The figure a half-working join gets
    // wrong, because one customer alone is also a plausible number.
    expect(answerFor('CALCULATE(SUM(Orders[Revenue]), Customers[Country] = "Ghana")')).toBe(
      '1200'
    );
    expect(answerFor('CALCULATE(SUM(Orders[Revenue]), Customers[Country] = "Kenya")')).toBe(
      '900'
    );
    expect(answerFor('SUM(Orders[Revenue])')).toBe('2100');
  });

  it('breaks revenue down by a column of the other table', () => {
    const breakdown = answerFor(
      'CONCATENATEX(ADDCOLUMNS(VALUES(Customers[Country]), "T", ' +
        'CALCULATE(SUM(Orders[Revenue]))), Customers[Country] & "=" & [T], ">")'
    );
    expect(items(breakdown)).toBe(items('Ghana=1200>Kenya=900'));
  });

  it('keeps a customer who bought nothing as a group with a blank', () => {
    // The distinction between "bought nothing" and "does not exist". Four
    // groups, one of them empty - not three groups.
    expect(
      answerFor(
        'COUNTROWS(ADDCOLUMNS(VALUES(Customers[Name]), "T", ' +
          'CALCULATE(SUM(Orders[Revenue]))))'
      )
    ).toBe('4');

    const named = answerFor(
      'CONCATENATEX(ADDCOLUMNS(VALUES(Customers[Name]), "T", ' +
        'CALCULATE(SUM(Orders[Revenue]))), Customers[Name] & "=" & ' +
        'IF(ISBLANK([T]), "(blank)", [T]), ">")'
    );
    expect(items(named)).toBe(items('Ama=700>Kofi=900>Yaa=500>Kwame=(blank)'));
  });

  it('accounts for every order in the breakdown', () => {
    // Summing the rows over the groups returns the table's own row count only
    // when every row reaches a group. This is the figure the NLQ layer
    // reports to the reader when it falls short.
    expect(answerFor('SUMX(VALUES(Customers[Country]), CALCULATE(COUNTROWS(Orders)))')).toBe(
      answerFor('COUNTROWS(Orders)')
    );
    expect(answerFor('COUNTROWS(Orders)')).toBe('6');
  });

  it('gives every group the same figure when asked the wrong way round', () => {
    // The evidence the refusal rests on, asserted so it cannot quietly stop
    // being true. Credit limit is on the one side and ProductID on the many
    // side, so no filter travels and all three products show 3500 - a table
    // that looks like a breakdown and carries no information at all.
    const wrongWay = answerFor(
      'CONCATENATEX(ADDCOLUMNS(VALUES(Orders[ProductID]), "T", ' +
        'CALCULATE(SUM(Customers[CreditLimit]))), Orders[ProductID] & "=" & [T], ">")'
    );
    expect(items(wrongWay)).toBe(items('P1=3500>P2=3500>P3=3500'));

    // Stated again without depending on the string: three distinct products,
    // one distinct figure between them.
    expect(answerFor('COUNTROWS(VALUES(Orders[ProductID]))')).toBe('3');
    expect(answerFor('SUM(Customers[CreditLimit])')).toBe('3500');
  });

  it('leaves the dimension whole when the fact is filtered', () => {
    // Two orders exceed 400, belonging to C2 (limit 2000) and C3 (limit 0).
    // A single-direction relationship does not carry the filter back, so the
    // answer is the whole 3500 rather than 2000. If this ever returns 2000
    // the join has become bidirectional, the wrong-way grouping above starts
    // meaning something, and the refusal built on it needs revisiting.
    expect(answerFor('CALCULATE(SUM(Customers[CreditLimit]), Orders[Revenue] > 400)')).toBe(
      '3500'
    );
    expect(answerFor('CALCULATE(COUNTROWS(Customers), Orders[Revenue] > 400)')).toBe('4');
  });

  it('reads a zero credit limit as zero', () => {
    expect(answerFor('MIN(Customers[CreditLimit])')).toBe('0');
  });
});

describe('cross-table parity fixture', () => {
  it('leads with a canary that fails loudly if the join is missing', () => {
    const first = CROSSTABLE_CASES[0];
    expect(first.id).toContain('canary');
    // 1200 with the join, 2100 without - and 2100 is a perfectly plausible
    // number, which is exactly why the canary is here.
    expect(answerFor(first.dax)).toBe('1200');
  });

  it('has no duplicate case ids', () => {
    const ids = CROSSTABLE_CASES.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks every text-returning case, so none is pushed through FORMAT', () => {
    for (const entry of CROSSTABLE_CASES) {
      const answer = answerFor(entry.dax);
      const isText = Number.isNaN(Number(answer));
      expect(entry.returnsText === true, `${entry.id} answers "${answer}"`).toBe(isText);
    }
  });

  it('gives every case an answer, so none is a question the engine refuses', () => {
    for (const entry of CROSSTABLE_CASES) {
      expect(answerFor(entry.dax), `${entry.id}`).not.toContain('ERROR:');
    }
  });

  it('gives every case an answer that could distinguish a wrong reading', () => {
    // A case answering the same thing as its neighbour proves nothing.
    const answers = CROSSTABLE_CASES.map(entry => answerFor(entry.dax));
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('names the table on the first line, before any comment', () => {
    const script = buildCrossTableScript();
    expect(script.slice(0, script.indexOf('=')).trim()).toBe('CrossTableResults');
  });

  it('tells the reader the join is required', () => {
    // The one instruction that cannot be left out: a model without the
    // relationship answers every case and answers them all wrongly.
    const script = buildCrossTableScript();
    expect(script).toContain('customers.csv');
    expect(script).toContain('CustomerID');
  });

  it('keeps the generated script in step with the cases', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'crosstable-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildCrossTableScript());
  });
});

describe('cross-table parity with Power BI', () => {
  for (const entry of CROSSTABLE_CASES) {
    const runner = entry.expected === null ? it.skip : it;

    runner(`${entry.id}`, () => {
      const engine = answerFor(entry.engineDax ?? entry.dax);
      expect(
        agrees(engine, entry.expected!, entry.unorderedText === true),
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingCrossTableCount();
    if (pending > 0) {
      console.log(
        `\n  Cross-table parity: ${CROSSTABLE_CASES.length - pending} of ` +
          `${CROSSTABLE_CASES.length} answered, ${pending} pending.\n` +
          '  Run crosstable-script.dax in Power BI against orders.csv joined\n' +
          '  to customers.csv. Until then the cross-table grouping this sheet\n' +
          '  covers is verified by hand-computation only, NOT against Power BI.\n'
      );
    }
    expect(pending).toBeLessThanOrEqual(CROSSTABLE_CASES.length);
  });
});
