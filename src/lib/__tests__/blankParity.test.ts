import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { fromCell } from '../dax/value';
import { buildBlankScript } from './fixtures/powerbi/script';
import { BLANK_CASES, pendingBlankCount } from './fixtures/powerbi/blank-expected';
import { FIXTURE_DIR, loadCsvDataset } from './fixtures/powerbi/load';

/**
 * What an empty cell becomes on import, checked against Power BI.
 *
 * Five of these agree. Three do not, and the disagreement is deliberate: see
 * the note at the top of blank-expected.ts. Those three are pinned rather
 * than skipped, so the divergence cannot widen or quietly disappear.
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

describe('blank parity fixture', () => {
  it('leads with a canary that fails loudly if the table is empty', () => {
    expect(BLANK_CASES[0].id).toContain('canary');
    expect(answerFor(BLANK_CASES[0].dax)).toBe('18');
  });

  it('keeps the generated script in step with the cases', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'blank-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildBlankScript());
  });

  it('is fully answered', () => {
    expect(pendingBlankCount()).toBe(0);
  });
});

describe('the deliberate divergence, stated as a rule', () => {
  it('turns an empty string into BLANK on the way in', () => {
    // The one line the whole divergence rests on. Written as its own test so
    // that changing it is a decision someone takes, not a side effect.
    expect(fromCell('')).toBeNull();
    expect(fromCell('   ')).toBeNull();
    expect(fromCell(null)).toBeNull();
    expect(fromCell('North')).toBe('North');
  });

  it('leaves everything the two engines agree on alone', () => {
    // These are the reasons the divergence is narrow rather than pervasive.
    // If any of them starts failing, it has stopped being narrow.
    expect(answerFor('COUNTROWS(FILTER(Sales, Sales[Region] = ""))')).toBe('1');
    expect(answerFor('DISTINCTCOUNT(Sales[Region])')).toBe('3');
    expect(answerFor('COUNTBLANK(Sales[Amount])')).toBe('1');
    expect(answerFor('CALCULATE(SUM(Sales[Amount]), Sales[Region] <> "North")')).toBe('4000');
  });
});

describe('blank parity with Power BI', () => {
  for (const entry of BLANK_CASES) {
    if (entry.divergence) {
      const pinned = entry.divergence;
      it(`${entry.id} - DELIBERATE DIVERGENCE, pinned`, () => {
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

    it(`${entry.id}`, () => {
      const engine = answerFor(entry.dax);
      expect(
        engine,
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(String(entry.expected));
    });
  }

  it('counts the divergences, so the number cannot creep', () => {
    // Three, and only three. A fourth means the divergence has spread
    // somewhere nobody argued for.
    expect(BLANK_CASES.filter(entry => entry.divergence).length).toBe(3);
  });
});
