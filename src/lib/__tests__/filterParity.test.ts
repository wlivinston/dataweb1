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

  it('keeps a placement pair whose two sides actually answer differently', () => {
    // The first pair asked the placement question against data that could not
    // answer it: both products appear in North, so the two placements agreed
    // and the pair proved nothing. Power BI said so, no test here did.
    //
    // Comparing the DAX is not enough - that is what the original test did,
    // and it passed on a vacuous pair. This compares the ANSWERS.
    const inside = FILTER_CASES.find(entry =>
      entry.id.startsWith('placement-INSIDE')
    );
    const outside = FILTER_CASES.find(entry =>
      entry.id.startsWith('placement-OUTSIDE')
    );
    expect(inside, 'the distinguishing INSIDE case is missing').toBeTruthy();
    expect(outside, 'the distinguishing OUTSIDE case is missing').toBeTruthy();
    expect(
      answerFor(inside!.dax),
      'the placement pair no longer distinguishes anything'
    ).not.toBe(answerFor(outside!.dax));
  });
});

describe('filter parity with Power BI', () => {
  for (const entry of FILTER_CASES) {
    const runner = entry.expected === null ? it.skip : it;

    if (entry.divergence) {
      const pinned = entry.divergence;
      runner(`${entry.id} - DELIBERATE DIVERGENCE, pinned`, () => {
        // Not a claim of agreement. This asserts the disagreement is still
        // exactly what was recorded, so neither side can drift unnoticed.
        const engine = answerFor(entry.dax);
        expect(engine, `${entry.id}: this engine moved.\n  ${pinned.note}`).toBe(
          pinned.engine
        );
        expect(
          engine,
          `${entry.id} now matches Power BI - unpin it.\n  ${pinned.note}`
        ).not.toBe(String(entry.expected));
      });
      continue;
    }

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
