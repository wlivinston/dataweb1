import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  planHeaders,
  describeHeaderChanges,
  readSheet,
  EXCEL_READ_OPTIONS,
} from '../excelRows';

/**
 * Header rows that real spreadsheets have, and the import did not survive.
 *
 * Two defects, and the second is much worse than it looks.
 *
 * A BLANK HEADING produced a column keyed by the empty string: present in the
 * dataset, impossible to name in a DAX expression, nameless in every list the
 * UI draws.
 *
 * A REPEATED HEADING LOST A COLUMN. A row object is keyed by header, so a
 * second `Amount` overwrites the first - and every figure computed from the
 * lost column silently became the surviving column's figure. The CSV path
 * wrote "Some columns may be overwritten" to the console and then overwrote
 * them. Nobody has the console open.
 *
 * Both are now renamed, not dropped and not refused: the data is all there
 * and only the labels were wrong. Renaming SILENTLY would be its own bug -
 * somebody goes looking for a heading that no longer exists - so every change
 * is reported back for the caller to show.
 */

const roundTrip = (grid: unknown[][]): XLSX.WorkSheet => {
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const reread = XLSX.read(bytes, EXCEL_READ_OPTIONS);
  return reread.Sheets[reread.SheetNames[0]];
};

describe('planning a header row', () => {
  it('leaves a clean header row alone', () => {
    const plan = planHeaders(['Region', 'Product', 'Amount']);
    expect(plan.names).toEqual(['Region', 'Product', 'Amount']);
    expect(plan.changes).toEqual([]);
  });

  it('names a blank heading after its position in the sheet', () => {
    // 1-based, so somebody can find the column in the spreadsheet it came
    // from. "Column 2" is the second column, not the third.
    const plan = planHeaders(['Region', '', 'Amount']);
    expect(plan.names).toEqual(['Region', 'Column 2', 'Amount']);
    expect(plan.changes).toEqual([{ from: '', to: 'Column 2', reason: 'blank' }]);
  });

  it('treats whitespace and absence as blank', () => {
    expect(planHeaders(['  ', null, undefined]).names).toEqual([
      'Column 1',
      'Column 2',
      'Column 3',
    ]);
  });

  it('trims a heading rather than keeping the spaces', () => {
    expect(planHeaders(['  Region  ']).names).toEqual(['Region']);
  });

  it('keeps BOTH columns when a heading repeats', () => {
    // The serious one. Before this, the second Amount overwrote the first and
    // one column of real data vanished with no error.
    const plan = planHeaders(['Amount', 'Region', 'Amount']);
    expect(plan.names).toEqual(['Amount', 'Region', 'Amount (2)']);
    expect(plan.changes).toEqual([
      { from: 'Amount', to: 'Amount (2)', reason: 'duplicate' },
    ]);
  });

  it('keeps counting when a heading repeats more than twice', () => {
    expect(planHeaders(['A', 'A', 'A', 'A']).names).toEqual(['A', 'A (2)', 'A (3)', 'A (4)']);
  });

  it('deduplicates case-insensitively, because the engine resolves names that way', () => {
    // findColumn in semantic/model.ts compares lowercased. Two columns
    // differing only in case would make every reference to either ambiguous,
    // and the engine refuses an ambiguous reference rather than picking one.
    const plan = planHeaders(['Amount', 'amount', 'AMOUNT']);
    expect(plan.names).toEqual(['Amount', 'amount (2)', 'AMOUNT (3)']);
    expect(new Set(plan.names.map(name => name.toLowerCase())).size).toBe(3);
  });

  it('does not let a generated name collide with a real one', () => {
    // A sheet that genuinely has a column called "Column 2" next to a blank
    // second heading. The generated name has to give way.
    const plan = planHeaders(['Column 2', '']);
    expect(plan.names[0]).toBe('Column 2');
    expect(plan.names[1]).toBe('Column 2 (2)');
    expect(new Set(plan.names).size).toBe(2);
  });

  it('always produces as many names as there were headings', () => {
    const raw = ['A', '', 'A', null, 'b', 'B'];
    expect(planHeaders(raw).names).toHaveLength(raw.length);
  });

  it('always produces names that are unique and non-empty', () => {
    const plan = planHeaders(['', '', 'x', 'X', '  ', 'x']);
    expect(plan.names.every(name => name.trim().length > 0)).toBe(true);
    expect(new Set(plan.names.map(name => name.toLowerCase())).size).toBe(plan.names.length);
  });
});

describe('telling the user what changed', () => {
  it('says nothing when nothing changed', () => {
    expect(describeHeaderChanges([])).toBe('');
  });

  it('names the columns it created', () => {
    const note = describeHeaderChanges(planHeaders(['Region', '']).changes);
    expect(note).toContain('1 unnamed column');
    expect(note).toContain('"Column 2"');
  });

  it('says plainly that nothing was dropped', () => {
    // The reassurance that matters: a user reading "repeated name" needs to
    // know their data is still there.
    const note = describeHeaderChanges(planHeaders(['Amount', 'Amount']).changes);
    expect(note).toContain('"Amount (2)"');
    expect(note).toContain('nothing was dropped');
  });

  it('covers both kinds in one sentence', () => {
    const note = describeHeaderChanges(planHeaders(['Amount', '', 'Amount']).changes);
    expect(note).toContain('unnamed column');
    expect(note).toContain('repeated name');
  });
});

describe('reading a worksheet with an awkward header row', () => {
  it('keeps every column of a sheet with a repeated heading', () => {
    // End to end through a real .xlsx. Before the fix this sheet imported as
    // two columns and the first Amount was gone.
    const { rows, changes } = readSheet(
      roundTrip([
        ['Region', 'Amount', 'Amount'],
        ['North', 10, 99],
        ['South', 20, 88],
      ])
    );

    expect(Object.keys(rows[0])).toEqual(['Region', 'Amount', 'Amount (2)']);
    expect(rows[0]).toEqual({ Region: 'North', Amount: 10, 'Amount (2)': 99 });
    expect(rows[1]).toEqual({ Region: 'South', Amount: 20, 'Amount (2)': 88 });
    expect(changes).toHaveLength(1);
  });

  it('keeps a column whose heading was left blank', () => {
    const { rows, changes } = readSheet(
      roundTrip([
        ['Region', '', 'Amount'],
        ['North', 'note', 10],
      ])
    );
    expect(rows[0]).toEqual({ Region: 'North', 'Column 2': 'note', Amount: 10 });
    expect(changes).toEqual([{ from: '', to: 'Column 2', reason: 'blank' }]);
  });

  it('reports nothing for an ordinary sheet', () => {
    const { rows, changes } = readSheet(
      roundTrip([
        ['Region', 'Amount'],
        ['North', 0],
      ])
    );
    expect(changes).toEqual([]);
    // And the zero fix still holds through the new header path.
    expect(rows[0].Amount).toBe(0);
  });
});
