import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { buildGroupingScript } from './fixtures/powerbi/script';
import { GROUPING_CASES, pendingGroupingCount } from './fixtures/powerbi/grouping-expected';
import { FIXTURE_DIR, loadCsvDataset } from './fixtures/powerbi/load';

/**
 * Grouping, checked against Power BI.
 *
 * Same arrangement as the other two sheets: the numbers come from outside
 * my own reading, and an unanswered case is skipped rather than failing.
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
  return engine.trim().toUpperCase().startsWith(expected.trim().toUpperCase());
};

describe('grouping parity fixture', () => {
  it('reads the Sales fixture the first parity round used', () => {
    const sales = model.tables.find(table => table.name === 'Sales')!;
    expect(sales.rows).toHaveLength(18);
    // The two blanks the sheet exists to probe.
    expect(sales.rows.some(row => row.Region === null)).toBe(true);
    expect(sales.rows.some(row => row.Amount === null)).toBe(true);
  });

  it('leads with a canary that fails loudly if the table is empty', () => {
    // An empty source table answers BLANK to everything, which reads as
    // fourteen answers and is fourteen non-answers. The canary has to be
    // first so it is the first thing anyone looks at.
    const first = GROUPING_CASES[0];
    expect(first.id).toContain('canary');
    expect(first.dax).toBe('COUNTROWS(Sales)');
    expect(answerFor(first.dax)).toBe('18');
  });

  it('has no duplicate case ids', () => {
    const ids = GROUPING_CASES.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the table on the first line, before any comment', () => {
    const script = buildGroupingScript();
    expect(script.slice(0, script.indexOf('=')).trim()).toBe('GroupingResults');
  });

  it('keeps the generated script in step with the cases', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'grouping-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildGroupingScript());
  });

  it('embeds each scriptable case exactly as the comparison runs it', () => {
    const script = buildGroupingScript();
    for (const entry of GROUPING_CASES.filter(c => c.compileError !== true)) {
      expect(script, entry.id).toContain(entry.dax);
    }
  });

  it('keeps a compile-time refusal out of the script entirely', () => {
    // IFERROR only contains runtime errors. One binding error inside the
    // UNION stops the table being created at all, so the other fourteen
    // cases come back with nothing - which is exactly what happened.
    const script = buildGroupingScript();
    const excluded = GROUPING_CASES.filter(entry => entry.compileError === true);
    expect(excluded.length).toBeGreaterThan(0);
    for (const entry of excluded) {
      expect(script, entry.id).not.toContain(entry.dax);
      // Excluded, but still answered - the refusal is the finding.
      expect(entry.expected, entry.id).not.toBeNull();
    }
  });
});

describe('grouping parity with Power BI', () => {
  for (const entry of GROUPING_CASES) {
    const runner = entry.expected === null ? it.skip : it;
    runner(`${entry.id} - ${entry.probes.slice(0, 60)}...`, () => {
      const engine = answerFor(entry.engineDax ?? entry.dax);
      expect(
        agrees(engine, entry.expected!),
        `${entry.id}\n  dax: ${entry.dax}\n  probes: ${entry.probes}\n` +
          `  Power BI:    ${entry.expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingGroupingCount();
    if (pending > 0) {
      console.log(
        `\n  Grouping parity: ${GROUPING_CASES.length - pending} of ` +
          `${GROUPING_CASES.length} answered, ${pending} pending.\n`
      );
    }
    expect(pending).toBeLessThanOrEqual(GROUPING_CASES.length);
  });
});
