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

/** The items of a flattened table, as a set, for order-free comparison. */
const items = (text: string): string => text.trim().split('>').sort().join('>');

const agrees = (
  engine: string,
  expected: number | string,
  unordered = false
): boolean => {
  if (typeof expected === 'number') {
    const parsed = Number(engine.replace(/,/g, ''));
    if (Number.isNaN(parsed)) return false;
    return Math.abs(parsed - expected) <= Math.max(Math.abs(expected) * 1e-6, 1e-6);
  }
  // Compared as a set where DAX does not define the order, so a difference
  // that is not a defect does not read as one - but still exact within
  // each item, because a flattened row differing by one character is a
  // different row.
  if (unordered) return items(engine) === items(expected);
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

    if (entry.divergence) {
      const pinned = entry.divergence;
      runner(`${entry.id} - KNOWN DIVERGENCE, pinned`, () => {
        // Not a claim of agreement. This asserts the disagreement is still
        // exactly what was recorded, so neither side can drift without
        // someone noticing - and so a green suite is not a false all-clear.
        const engine = answerFor(entry.engineDax ?? entry.dax);
        expect(engine, `${entry.id}: this engine moved.\n  ${pinned.note}`).toBe(
          pinned.engine
        );
        expect(
          agrees(engine, entry.expected!, entry.unorderedText === true),
          `${entry.id} now AGREES with Power BI - unpin it.\n  ${pinned.note}`
        ).toBe(false);
      });
      continue;
    }

    runner(`${entry.id}`, () => {
      const engine = answerFor(entry.engineDax ?? entry.dax);
      expect(
        agrees(engine, entry.expected!, entry.unorderedText === true),
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('reports every divergence still open, so none goes quiet', () => {
    const open = TABLE_CASES.filter(entry => entry.divergence);
    if (open.length > 0) {
      console.log(
        `\n  ${open.length} pinned divergence${open.length === 1 ? '' : 's'}: ` +
          `${open.map(entry => entry.id).join(', ')}\n  ${open[0].divergence!.note}\n`
      );
    }
    expect(open.every(entry => entry.divergence!.note.length > 0)).toBe(true);
  });

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
