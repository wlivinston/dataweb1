import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { analyzeColumn } from '../dataUtils';
import { describeDataset } from '../statisticalDescription';

/**
 * The column profile and Data Cleaning's counts, on the faults of a real
 * upload: "NA" in a score column, " student " beside "Student", a cell of
 * spaces. The profile said 0 nulls and 4 roles where there are 3 nulls and 3
 * roles - disagreeing with the engine, Ask Data and the charts.
 */

const rows = [
  { role: 'Student', score: 48 },
  { role: ' student ', score: 'NA' },
  { role: 'Faculty', score: 56 },
  { role: '   ', score: '' },
  { role: 'Student', score: 61 },
];

describe('profile counts', () => {
  it('a non-number in a numeric column is missing, everywhere it is counted', () => {
    // Mostly numbers, as in the workbook (245 numbers, 3 "NA"), so the
    // column is typed numeric.
    const scores = [48, 'NA', 56, '', 61, 70, 72, 80, 66];
    expect(analyzeColumn('score', scores)).toMatchObject({ type: 'number', nullCount: 2 });
    const dataset = makeDataset(rows, [{ name: 'role', type: 'string' }, { name: 'score', type: 'number' }]);
    const score = describeDataset(dataset).find(s => s.columnName === 'score');
    expect([score?.nonNullCount, score?.nullCount, score?.mean]).toEqual([3, 2, 55]);
  });

  it('spelling variants are one value; spaces are blank', () => {
    expect(analyzeColumn('role', rows.map(r => r.role))).toMatchObject({ uniqueCount: 2, nullCount: 1 });
    const dataset = makeDataset(rows, [{ name: 'role', type: 'string' }, { name: 'score', type: 'number' }]);
    const role = describeDataset(dataset).find(s => s.columnName === 'role');
    expect(role).toMatchObject({ unique: 2, nullCount: 1, top: 'Student', freq: 3 });
  });
});
