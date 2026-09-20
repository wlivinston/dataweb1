import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { buildTableScript } from './fixtures/powerbi/script';
import { TABLE_CASES, pendingTableCount } from './fixtures/powerbi/table-expected';
import { FIXTURE_DIR, loadCsvDataset } from './fixtures/powerbi/load';

/**
 * Table results, checked against Power BI.
 *
 * Each case flattens a table into one string, so which rows are present, in
 * what order, with what values, all travel in a single answer that the
 * existing one-scalar-per-row script can carry.
 */

const model = buildSemanticModel([
  loadCsvDataset('sales.csv', {
    id: 'ds-powerbi-sales',
    name: 'Sales',
    types: {
      OrderID: 'string',
      Date: 'date',
      Region: 'string',
      Product: 'string',
      Amount: 'number',
    },
  }),
]);

const answerFor = (dax: string): string => {
  const result = runDax(dax, model);
  if (!result.ok) return `ERROR: ${result.message}`;
  return result.value === null ? 'BLANK' : String(result.value);
};

const agrees = (engine: string, expected: number | string): boolean => {
  if (typeof expected === 'number') {
    const parsed = Number(engine.replace(/,/g, ''));
    if (Number.isNaN(parsed)) return false;
    return Math.abs(parsed - expected) <= Math.max(Math.abs(expected) * 1e-6, 1e-6);
  }
  // Exact for text: a flattened table differing by one character is a
  // different table, and "starts with" would hide a missing last row.
  return engine.trim() === expected.trim();
};

describe('table parity fixture', () => {
  it('leads with a canary that fails loudly if the table is empty', () => {
    const first = TABLE_CASES[0];
    expect(first.id).toContain('canary');
    expect(answerFor(first.dax)).toBe('18');
  });

  it('has no duplicate case ids', () => {
    const ids = TABLE_CASES.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks every text-returning case, so none is pushed through FORMAT', () => {
    // FORMAT on text errors, and IFERROR would turn that into "ERROR" - an
    // answer that looks like a Power BI refusal but is really a bug here.
    for (const entry of TABLE_CASES) {
      const answer = answerFor(entry.dax);
      const isText = Number.isNaN(Number(answer));
      expect(entry.returnsText === true, `${entry.id} answers "${answer}"`).toBe(isText);
    }
  });

  it('names the table on the first line, before any comment', () => {
    const script = buildTableScript();
    expect(script.slice(0, script.indexOf('=')).trim()).toBe('TableResults');
  });

  it('keeps the generated script in step with the cases', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'table-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildTableScript());
  });

  it('gives every case an answer that could distinguish a wrong reading', () => {
    // A case answering the same thing as its neighbour proves nothing. Every
    // answer here should be distinct, or the sheet is shorter than it looks.
    const answers = TABLE_CASES.map(entry => answerFor(entry.dax));
    expect(new Set(answers).size).toBe(answers.length);
  });
});

describe('table parity with Power BI', () => {
  for (const entry of TABLE_CASES) {
    const runner = entry.expected === null ? it.skip : it;
    runner(`${entry.id}`, () => {
      const engine = answerFor(entry.engineDax ?? entry.dax);
      expect(
        agrees(engine, entry.expected!),
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingTableCount();
    if (pending > 0) {
      console.log(
        `\n  Table parity: ${TABLE_CASES.length - pending} of ${TABLE_CASES.length} ` +
          `answered, ${pending} pending.\n`
      );
    }
    expect(pending).toBeLessThanOrEqual(TABLE_CASES.length);
  });
});
