import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { buildFilterScript } from './fixtures/powerbi/script';
import { FILTER_CASES, pendingFilterCount } from './fixtures/powerbi/filter-expected';
import { FIXTURE_DIR, loadCsvDataset } from './fixtures/powerbi/load';

/**
 * Filtered questions, checked against Power BI.
 *
 * The compiler turns "total Amount for North" into a CALCULATE. The
 * arithmetic inside was verified long ago; what is new is the predicate and,
 * for a grouped question, WHERE the predicate sits. Cases 7 and 8 are the
 * same question compiled both ways - inside the per-group CALCULATE and
 * around the whole grouping - because both return the same rows in the same
 * order and differ only in the numbers, which is the hardest kind of wrong
 * to see on a screen.
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

describe('filter parity fixture', () => {
  it('leads with a canary that fails loudly if the table is empty', () => {
    expect(FILTER_CASES[0].id).toContain('canary');
    expect(answerFor(FILTER_CASES[0].dax)).toBe('18');
  });

  it('has no duplicate case ids', () => {
    const ids = FILTER_CASES.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the table on the first line, before any comment', () => {
    // Power BI reads everything before the first `=` as the table name, so a
    // comment header above the assignment becomes part of the name.
    const script = buildFilterScript();
    expect(script.slice(0, script.indexOf('=')).trim()).toBe('FilterResults');
  });

  it('keeps the generated script in step with the cases', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'filter-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildFilterScript());
  });

  it('runs every case through this engine without erroring', () => {
    // A case this engine cannot even run would come back from Power BI as a
    // number with nothing to compare it against.
    for (const entry of FILTER_CASES) {
      expect(answerFor(entry.dax), `${entry.id}: ${entry.dax}`).not.toContain('ERROR:');
    }
  });

  it('asks the placement question with two cases that can actually disagree', () => {
    // If these two were equal here, the sheet could not tell the placements
    // apart and case 8 would be wasted space.
    const inside = FILTER_CASES.find(entry => entry.id.includes('INSIDE'));
    const outside = FILTER_CASES.find(entry => entry.id.includes('OUTSIDE'));
    expect(inside, 'the INSIDE case is missing').toBeTruthy();
    expect(outside, 'the OUTSIDE case is missing').toBeTruthy();
    expect(inside!.dax).not.toBe(outside!.dax);
  });
});

describe('filter parity with Power BI', () => {
  for (const entry of FILTER_CASES) {
    const runner = entry.expected === null ? it.skip : it;

    runner(`${entry.id}`, () => {
      const engine = answerFor(entry.dax);
      expect(
        engine,
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(String(entry.expected));
    });
  }

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingFilterCount();
    if (pending > 0) {
      console.log(
        `\n  Filter parity: ${FILTER_CASES.length - pending} of ${FILTER_CASES.length} ` +
          `answered, ${pending} pending Power BI.\n`
      );
    }
    expect(pending).toBeLessThanOrEqual(FILTER_CASES.length);
  });
});
