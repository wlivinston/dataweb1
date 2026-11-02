import { describe, it, expect } from 'vitest';
import { makeDataset, seededRandom } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { diagramRelationships, lookupJoin } from '../semantic/diagramRelationships';
import { detectSchema } from '../smartDataConnector';
import type { Dataset } from '../types';

/**
 * The relationship diagram, and the joins the chart pipeline makes from it.
 *
 * Shaped like a real upload (practice_workbook.xlsx): participants, their
 * sessions, a department lookup - and score columns whose values (30, 45, 60,
 * 90) also appear in sessions.minutes, which the detector proposed as a link.
 */

const random = seededRandom(7);
const pick = <T,>(values: T[]): T => values[Math.floor(random() * values.length)];
const durations = [30, 45, 60, 90];

const participantRows = Array.from({ length: 40 }, (_, i) => ({
  participant_id: `P${String(i + 1).padStart(4, '0')}`,
  department_id: pick(['D01', 'D02', 'D03', 'D04']),
  age: 20 + Math.floor(random() * 40),
  // Scores that collide with session lengths.
  followup_score: pick([...durations, 55, 70, 85]),
}));

const sessionRows = participantRows.flatMap((p, i) =>
  [1, 2].map(n => ({
    session_id: `S${i}${n}`,
    participant_id: p.participant_id,
    session_number: n,
    minutes: pick(durations),
  }))
);

const participants = makeDataset(
  participantRows,
  [
    { name: 'participant_id', type: 'string' },
    { name: 'department_id', type: 'string' },
    { name: 'age', type: 'number' },
    { name: 'followup_score', type: 'number' },
  ],
  { id: 'ds-participants', name: 'participants' }
);
const sessions = makeDataset(
  sessionRows,
  [
    { name: 'session_id', type: 'string' },
    { name: 'participant_id', type: 'string' },
    { name: 'session_number', type: 'number' },
    { name: 'minutes', type: 'number' },
  ],
  { id: 'ds-sessions', name: 'sessions' }
);
const departments = makeDataset(
  ['D01', 'D02', 'D03', 'D04'].map((id, i) => ({ department_id: id, department_name: `Dept ${i}` })),
  [{ name: 'department_id', type: 'string' }, { name: 'department_name', type: 'string' }],
  { id: 'ds-departments', name: 'departments' }
);
const inventory = makeDataset(
  Array.from({ length: 12 }, (_, i) => ({ cart: `Cart ${i}`, days_held: 10 + i })),
  [{ name: 'cart', type: 'string' }, { name: 'days_held', type: 'number' }],
  { id: 'ds-inventory', name: 'inventory' }
);

const all: Dataset[] = [inventory, participants, departments, sessions];
const describeLink = (r: { fromDataset: string; fromColumn: string; toDataset: string; toColumn: string }) =>
  `${r.fromDataset}.${r.fromColumn} -> ${r.toDataset}.${r.toColumn}`;

describe('the links the diagram draws', () => {
  const links = diagramRelationships(buildSemanticModel(all)).map(describeLink);

  it('are the key links, and only those', () => {
    expect(links.sort()).toEqual([
      'ds-participants.department_id -> ds-departments.department_id',
      'ds-sessions.participant_id -> ds-participants.participant_id',
    ]);
  });

  it('do not include two measure columns that merely share values', () => {
    // The detector's raw list does propose it - which is what the diagram
    // used to draw, and the pipeline used to join on.
    const raw = detectSchema(all).relationships.map(describeLink);
    const bogus = raw.filter(link => /followup_score|minutes|age/.test(link));
    expect(bogus.length).toBeGreaterThan(0);
    expect(links.filter(link => /followup_score|minutes|age/.test(link))).toEqual([]);
  });

  it('leave a dataset that shares no key with the others unlinked', () => {
    expect(links.filter(link => link.includes('ds-inventory'))).toEqual([]);
  });

  it('mark the many side as the fact and the lookup as the dimension', () => {
    const department = diagramRelationships(buildSemanticModel(all))
      .find(r => r.toDataset === 'ds-departments');
    expect(department).toMatchObject({ type: 'one-to-many', isDimensionTable: true });
  });
});

describe('joining for the charts', () => {
  it('never repeats a row: a lookup, not a fan-out', () => {
    // Joining participants onto sessions' rows the wrong way round is the
    // case that used to repeat each participant once per session.
    const joined = lookupJoin(participants.data, sessions.data, {
      fromColumn: 'participant_id', toColumn: 'participant_id', type: 'one-to-many',
    });
    expect(joined).toHaveLength(participants.data.length);
    const total = (rows: Record<string, unknown>[]) => rows.reduce((s, r) => s + (r.age as number), 0);
    expect(total(joined)).toBe(total(participants.data));
    // Each participant has two sessions: which one would be copied is a
    // guess, so neither is.
    expect(joined.every(row => row.session_id === undefined)).toBe(true);
  });

  it('copies the one-side columns onto each row, matching keys as the model does', () => {
    const joined = lookupJoin(
      [{ department_id: ' d01 ', score: 1 }, { department_id: 'D09', score: 2 }],
      departments.data,
      { fromColumn: 'department_id', toColumn: 'department_id', type: 'one-to-many' }
    );
    expect(joined[0]).toMatchObject({ department_name: 'Dept 0', score: 1, department_id: ' d01 ' });
    expect(joined[1]).toEqual({ department_id: 'D09', score: 2 });
  });

  it('adds nothing across a many-to-many link, even where a key happens to match once', () => {
    const rows = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }];
    expect(lookupJoin(rows, [{ k: 'a', x: 1 }, { k: 'a', x: 2 }, { k: 'b', x: 3 }], {
      fromColumn: 'k', toColumn: 'k', type: 'many-to-many',
    })).toEqual(rows);
  });
});
