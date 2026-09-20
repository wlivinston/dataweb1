import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { availableMeasures, evaluateMeasure } from '../measures';
import { buildMeasureScript } from './fixtures/powerbi/script';
import { MEASURE_ANSWERS, pendingMeasureCount } from './fixtures/powerbi/measures-expected';
import { FIXTURE_DIR, loadOrders } from './fixtures/powerbi/load';
import type { ResolvedMeasure } from '../measures';

/**
 * The measure library, checked against Power BI.
 *
 * Same arrangement as the DAX parity sheet: the numbers come from outside my
 * own reading, and an unanswered entry is skipped rather than failing. That
 * sheet found two real bugs in an engine whose invariants all held, so the
 * fact that these formulas look simple is not evidence that they are right.
 */

const model = buildSemanticModel([loadOrders()]);
const measures = availableMeasures(model);

const answerFor = (measure: ResolvedMeasure): string => {
  const result = evaluateMeasure(measure, model);
  if (result.error) return `ERROR: ${result.error}`;
  return result.value === null ? 'BLANK' : String(result.value);
};

/** Loose enough that a value rounded for display still agrees. */
const agrees = (engine: string, expected: number | string): boolean => {
  if (typeof expected === 'number') {
    const parsed = Number(engine.replace(/,/g, ''));
    if (Number.isNaN(parsed)) return false;
    return Math.abs(parsed - expected) <= Math.max(Math.abs(expected) * 1e-6, 1e-6);
  }
  return engine.trim().toUpperCase().startsWith(expected.trim().toUpperCase());
};

// ============================================================
// The sheet has to be sound before the answers mean anything
// ============================================================

describe('measure parity fixture', () => {
  it('builds a model with a calendar the measures can anchor to', () => {
    expect(model.dateTableName).toBeTruthy();
    const calendar = model.tables.find(table => table.name === model.dateTableName)!;
    expect(calendar.columns.some(column => column.name === 'Year')).toBe(true);
  });

  it('resolves the whole library against the fixture', () => {
    expect(measures.length).toBe(Object.keys(MEASURE_ANSWERS).length);
  });

  it('lists an answer slot for every resolved measure, and no orphans', () => {
    // An id in one and not the other means someone is answering a question
    // that is no longer asked, or asking one nobody will answer.
    const resolved = new Set(measures.map(measure => measure.template.id));
    const listed = new Set(Object.keys(MEASURE_ANSWERS));
    expect([...resolved].filter(id => !listed.has(id))).toEqual([]);
    expect([...listed].filter(id => !resolved.has(id))).toEqual([]);
  });

  it('can evaluate every measure, so no answer is wasted', () => {
    const broken = measures
      .map(measure => ({ id: measure.template.id, answer: answerFor(measure) }))
      .filter(entry => entry.answer.startsWith('ERROR'))
      .map(entry => `${entry.id}: ${entry.answer}`);
    expect(broken).toEqual([]);
  });

  it('names the table on the first line, before any comment', () => {
    // Power BI's New Table box reads everything up to the first `=` as the
    // table name, so a comment header above the assignment silently becomes
    // part of the name. This models that reading rather than trusting DAX's,
    // because DAX accepts both and only Power BI cares.
    const script = buildMeasureScript(measures);
    expect(script.slice(0, script.indexOf('=')).trim()).toBe('MeasureResults');
  });

  it('keeps the generated script in step with the measures it claims to run', () => {
    const committed = readFileSync(join(FIXTURE_DIR, 'measures-script.dax'), 'utf8');
    expect(committed.split('\r\n').join('\n')).toBe(buildMeasureScript(measures));
  });

  it('embeds the exact DAX the library emits, not a paraphrase', () => {
    const script = buildMeasureScript(measures);
    for (const measure of measures) {
      // Multi-line measures are parenthesised to nest, so compare line by
      // line rather than as one block.
      for (const line of measure.dax.split('\n')) {
        expect(script, measure.template.id).toContain(line.trim());
      }
    }
  });

  it('parenthesises multi-line measures so they can sit inside ROW()', () => {
    const script = buildMeasureScript(measures);
    const multiline = measures.filter(measure => measure.dax.includes('\n'));
    expect(multiline.length).toBeGreaterThan(0);
    for (const measure of multiline) {
      expect(script).toContain(`(\n${measure.dax}\n    )`);
    }
  });
});

// ============================================================
// The comparison
// ============================================================

describe('measure parity with Power BI', () => {
  for (const measure of measures) {
    const expected = MEASURE_ANSWERS[measure.template.id];
    const runner = expected === null || expected === undefined ? it.skip : it;

    runner(`${measure.template.id} - ${measure.template.description}`, () => {
      const engine = answerFor(measure);
      expect(
        agrees(engine, expected!),
        `${measure.template.id}\n  dax: ${measure.dax}\n` +
          `  Power BI:    ${expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingMeasureCount();
    const total = Object.keys(MEASURE_ANSWERS).length;
    if (pending > 0) {
      console.log(
        `\n  Measure parity: ${total - pending} of ${total} answered, ${pending} pending.` +
          `\n  Fill in src/lib/__tests__/fixtures/powerbi/measures-expected.ts\n`
      );
    }
    expect(pending).toBeLessThanOrEqual(total);
  });
});
