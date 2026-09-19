import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSemanticModel } from '../semantic/model';
import { runDax, formatDaxValue } from '../dax/run';
import { PARITY_CASES, pendingCount, type ParityCase } from './fixtures/powerbi/expected';
import type { ColumnInfo, Dataset } from '../types';

/**
 * Parity against Power BI.
 *
 * These are the cases where my reading of DAX is a judgement call rather
 * than a derivation - leap days, month-end clamping, fiscal year ends,
 * blank comparison - chosen so that different readings give different
 * numbers. No property test reaches them: a reading that is wrong in the
 * same direction everywhere satisfies every law.
 *
 * A case with `expected: null` is skipped, so this file is useful the
 * moment a single number is filled in rather than needing all of them.
 */

const FIXTURE_DIR = join(__dirname, 'fixtures', 'powerbi');

/** Parse the fixture CSV the way the upload pipeline would. */
const loadFixture = (): Dataset => {
  const text = readFileSync(join(FIXTURE_DIR, 'sales.csv'), 'utf8').trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const names = header.split(',');

  const rows = lines.map(line => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    names.forEach((name, index) => {
      const cell = cells[index] ?? '';
      if (cell === '') {
        row[name] = null;
      } else if (name === 'Amount') {
        row[name] = Number(cell);
      } else {
        row[name] = cell;
      }
    });
    return row;
  });

  const types: Record<string, ColumnInfo['type']> = {
    OrderID: 'string',
    Date: 'date',
    Region: 'string',
    Product: 'string',
    Amount: 'number',
  };

  const columns: ColumnInfo[] = names.map(name => {
    const values = rows.map(row => row[name]);
    const present = values.filter(v => v !== null && v !== undefined && v !== '');
    return {
      name,
      type: types[name],
      sampleValues: present.slice(0, 5),
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map(v => String(v))).size,
    };
  });

  return {
    id: 'ds-powerbi-parity',
    name: 'Sales',
    description: 'Power BI parity fixture',
    columns,
    rowCount: rows.length,
    dataTypes: Object.fromEntries(names.map(n => [n, types[n]])) as Dataset['dataTypes'],
    data: rows,
  };
};

const model = buildSemanticModel([loadFixture()]);

/** How this engine answers a case, in the same vocabulary as the sheet. */
const engineAnswer = (entry: ParityCase): string => {
  const outcome = runDax(entry.engineDax ?? entry.dax, model);
  if (!outcome.ok) return `ERROR: ${outcome.message}`;
  return outcome.value === null ? 'BLANK' : formatDaxValue(outcome.value);
};

/** Compare loosely enough that 447.06 and 447.0588 agree. */
const agrees = (engine: string, expected: number | string): boolean => {
  if (typeof expected === 'number') {
    const parsed = Number(engine.replace(/,/g, ''));
    if (Number.isNaN(parsed)) return false;
    const tolerance = Math.max(Math.abs(expected) * 1e-6, 1e-6);
    return Math.abs(parsed - expected) <= tolerance;
  }
  return engine.trim().toUpperCase().startsWith(expected.trim().toUpperCase());
};

// ============================================================
// The fixture and the sheet have to be sound first
// ============================================================

describe('parity fixture', () => {
  it('loads the calendar the time-intelligence cases need', () => {
    expect(model.dateTableName).toBeTruthy();
    const joined = model.relationships.some(
      r => r.isActive && r.to.table === model.dateTableName && r.from.table === 'Sales'
    );
    expect(joined).toBe(true);
  });

  it('keeps the blank Region and the blank Amount that the blank cases probe', () => {
    const sales = model.tables.find(t => t.name === 'Sales')!;
    expect(sales.rows.some(row => row.Region === null)).toBe(true);
    expect(sales.rows.some(row => row.Amount === null)).toBe(true);
  });

  it('gives every case a unique id and a non-empty expression', () => {
    const ids = PARITY_CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of PARITY_CASES) {
      expect(entry.dax.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.probes.trim().length, entry.id).toBeGreaterThan(0);
    }
  });

  it('can evaluate every case, so no answer is wasted on an expression I cannot run', () => {
    // If this fails, the sheet is asking for a number against something this
    // engine refuses - which would waste the effort of reading it off.
    const broken = PARITY_CASES.filter(entry => !entry.engineRefuses)
      .map(entry => ({ id: entry.id, answer: engineAnswer(entry) }))
      .filter(entry => entry.answer.startsWith('ERROR'))
      .map(entry => `${entry.id}: ${entry.answer}`);

    expect(broken).toEqual([]);
  });
});

// ============================================================
// The comparison itself
// ============================================================

describe('parity with Power BI', () => {
  for (const entry of PARITY_CASES) {
    const runner = entry.expected === null ? it.skip : it;
    runner(`${entry.id} - ${entry.probes}`, () => {
      const engine = engineAnswer(entry);
      expect(
        agrees(engine, entry.expected!),
        `${entry.id}\n  expression: ${entry.engineDax ?? entry.dax}\n` +
          `  Power BI:   ${entry.expected}\n  this engine: ${engine}`
      ).toBe(true);
    });
  }

  it('marks a deliberate refusal as one, so the guard above stays meaningful', () => {
    // A case flagged engineRefuses must actually refuse. If the engine
    // starts answering it, the flag is stale and the sheet is now asking a
    // question that has quietly changed.
    for (const entry of PARITY_CASES.filter(c => c.engineRefuses)) {
      expect(engineAnswer(entry), entry.id).toMatch(/^ERROR/);
    }
  });

  it('reports how much of the sheet is still unanswered', () => {
    const pending = pendingCount();
    const total = PARITY_CASES.length;
    if (pending > 0) {
      console.log(
        `\n  Power BI parity: ${total - pending} of ${total} answered, ${pending} pending.` +
          `\n  Fill in expected values in src/lib/__tests__/fixtures/powerbi/expected.ts` +
          `\n  See that folder's README.md for how.\n`
      );
    }
    // Never fails. An unanswered sheet is a known gap, not a broken build -
    // the CI gate is not the right place to nag about it.
    expect(pending).toBeLessThanOrEqual(total);
  });
});
