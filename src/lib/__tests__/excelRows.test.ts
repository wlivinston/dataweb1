import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  sheetToObjects,
  cellOrBlank,
  cellValue,
  excelDateText,
  EXCEL_READ_OPTIONS,
  BLANK_CELL,
} from '../excelRows';
import { detectDataTypeFromValues } from '../dataUtils';

/**
 * Excel import, checked through a real workbook.
 *
 * The bug this file exists for shipped for months and no test could have
 * caught it, because every fixture in the repo was hand-written and nobody
 * writes a zero into a hand-written fixture. So these tests do not hand the
 * parser an array of arrays pretending to be a sheet. They build a workbook,
 * write it to bytes with xlsx, read the bytes back, and parse that - the same
 * journey a file dragged onto the upload panel takes.
 *
 * Writing and re-reading matters: xlsx stores a zero as a numeric cell with
 * `v: 0`, and a zero that survives `aoa_to_sheet` in memory could still be
 * lost on the way through the file format. The round trip is the only version
 * of this test that proves what a user's spreadsheet does.
 */

/**
 * A worksheet as it comes back out of a written-then-read .xlsx file.
 *
 * Read with the application's own options, so a test cannot pass against
 * settings the upload path does not actually use.
 */
const roundTrip = (grid: unknown[][]): XLSX.WorkSheet => {
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const reread = XLSX.read(bytes, EXCEL_READ_OPTIONS);
  return reread.Sheets[reread.SheetNames[0]];
};

/**
 * A sheet whose date cells are stored the way Excel stores them: a number
 * carrying a date format, not a JS Date handed to aoa_to_sheet.
 *
 * This distinction is the whole point. `aoa_to_sheet` with a Date writes a
 * cell xlsx recognises as its own, and a test built that way agrees with
 * itself. A spreadsheet somebody typed into holds serial 45306 with a
 * `yyyy-mm-dd` format, and that is the input that was being imported as the
 * number 45306.
 */
const excelStoredDates = (serials: Array<[number, string]>): XLSX.WorkSheet => {
  const sheet: XLSX.WorkSheet = {
    '!ref': `A1:A${serials.length + 1}`,
    A1: { t: 's', v: 'When' },
  };
  serials.forEach(([serial, format], index) => {
    sheet[`A${index + 2}`] = { t: 'n', v: serial, z: format };
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const reread = XLSX.read(bytes, EXCEL_READ_OPTIONS);
  return reread.Sheets[reread.SheetNames[0]];
};

const parse = (grid: unknown[][]) => sheetToObjects(roundTrip(grid));

describe('cellOrBlank', () => {
  it('keeps the three falsy values a spreadsheet can legitimately hold', () => {
    // The whole bug, in one assertion. `0 || ''` is `''`.
    expect(cellOrBlank(0)).toBe(0);
    expect(cellOrBlank(false)).toBe(false);
    expect(cellOrBlank('')).toBe('');
  });

  it('treats only an absent cell as blank', () => {
    expect(cellOrBlank(undefined)).toBe(BLANK_CELL);
    expect(cellOrBlank(null)).toBe(BLANK_CELL);
  });

  it('passes ordinary values through untouched', () => {
    expect(cellOrBlank(42)).toBe(42);
    expect(cellOrBlank(-1)).toBe(-1);
    expect(cellOrBlank('Accra')).toBe('Accra');
    expect(cellOrBlank(true)).toBe(true);
  });
});

describe('Excel import keeps zeros', () => {
  it('reads a zero as 0, not as a blank', () => {
    const rows = parse([
      ['Region', 'Units'],
      ['Accra', 10],
      ['Kumasi', 0],
      ['Tamale', 5],
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ Region: 'Kumasi', Units: 0 });
    // Not "", not absent, and still a number - so SUM does not concatenate.
    expect(rows[1].Units).toBe(0);
    expect(typeof rows[1].Units).toBe('number');
  });

  it('keeps a zero out of the missing-value count', () => {
    // How the bug surfaced to a user: a column of real figures reported as
    // partly empty, and every statistic computed over the wrong row count.
    const rows = parse([
      ['Units'],
      [10],
      [0],
      [0],
      [5],
    ]);

    const blanks = rows.filter(row => row.Units === BLANK_CELL).length;
    expect(blanks, 'a zero is being counted as a missing value').toBe(0);

    const values = rows.map(row => Number(row.Units));
    expect(values).toEqual([10, 0, 0, 5]);
    // The two figures the old behaviour got wrong, stated explicitly: with
    // zeros dropped the mean was 7.5 over two rows and the minimum was 5.
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBe(3.75);
    expect(Math.min(...values)).toBe(0);
  });

  it('keeps a zero that is the only value in its column', () => {
    // The degenerate case, where the old behaviour made a numeric column
    // disappear entirely and the column was typed as text instead.
    const rows = parse([
      ['Returns'],
      [0],
      [0],
    ]);
    expect(rows.map(row => row.Returns)).toEqual([0, 0]);
  });

  it('keeps a false, so a flag column does not lose its off rows', () => {
    const rows = parse([
      ['Customer', 'Active'],
      ['Ama', true],
      ['Kwesi', false],
    ]);
    expect(rows[1].Active).toBe(false);
    expect(rows.filter(row => row.Active === false)).toHaveLength(1);
  });

  it('still reads a genuinely empty cell as blank', () => {
    // The behaviour the `|| ''` was there for, which has to survive the fix.
    const rows = parse([
      ['Region', 'Units', 'Note'],
      ['Accra', 10, 'ok'],
      ['Kumasi', 0, ''],
    ]);
    expect(rows[1].Note).toBe(BLANK_CELL);
    expect(rows[1].Units).toBe(0);
  });

  it('pads a row that is shorter than the header row', () => {
    // xlsx leaves holes rather than padding, and a trailing empty cell is the
    // most common shape of real spreadsheet there is. Every row must still
    // carry every key, or downstream column access is undefined.
    const rows = parse([
      ['A', 'B', 'C'],
      [1, 2, 3],
      [1],
    ]);
    expect(Object.keys(rows[1]).sort()).toEqual(['A', 'B', 'C']);
    expect(rows[1]).toEqual({ A: 1, B: BLANK_CELL, C: BLANK_CELL });
  });

  it('returns no rows for an empty sheet or a header-only sheet', () => {
    expect(sheetToObjects(XLSX.utils.aoa_to_sheet([]))).toEqual([]);
    expect(parse([['A', 'B']])).toEqual([]);
  });

  it('reads negative and decimal figures unchanged', () => {
    const rows = parse([
      ['Amount'],
      [-250.5],
      [0],
      [0.25],
    ]);
    expect(rows.map(row => row.Amount)).toEqual([-250.5, 0, 0.25]);
  });
});

describe('Excel import keeps dates as dates', () => {
  it('reads a date cell as YYYY-MM-DD, not as its storage serial', () => {
    // Serial 45306 is 2024-01-15. The old read imported the number.
    const rows = sheetToObjects(excelStoredDates([[45306, 'yyyy-mm-dd']]));
    expect(rows[0].When).toBe('2024-01-15');
    expect(rows[0].When, 'the date is arriving as its Excel serial').not.toBe(45306);
  });

  it('keeps the time when the cell carries one', () => {
    // 45306.5 is midday. Truncating to the date would silently merge every
    // timestamp in a day, which is worse than showing the time.
    const rows = sheetToObjects(excelStoredDates([[45306.5, 'yyyy-mm-dd hh:mm']]));
    expect(rows[0].When).toBe('2024-01-15 12:00:00');
  });

  it('gives a date column a shape the type detector reads as a date', () => {
    // The reason the Date is written out as text at all. `cellDates: true`
    // alone leaves a Date object, and Number(date) is its epoch milliseconds,
    // so detection types the column as a number and the date is still lost -
    // just one layer further in.
    const rows = sheetToObjects(
      excelStoredDates([
        [45306, 'yyyy-mm-dd'],
        [45307, 'yyyy-mm-dd'],
        [45308, 'yyyy-mm-dd'],
      ])
    );
    const values = rows.map(row => row.When);
    expect(values).toEqual(['2024-01-15', '2024-01-16', '2024-01-17']);
    expect(detectDataTypeFromValues(values)).toBe('date');
    expect(detectDataTypeFromValues([45306, 45307, 45308])).toBe('number');
  });

  it('uses local calendar components, so the day cannot slip', () => {
    // xlsx builds a date-only cell at LOCAL midnight. Reading UTC components
    // would report the previous day for any timezone east of Greenwich, and
    // the test would still pass in Accra.
    const date = new Date(2024, 0, 15, 0, 0, 0);
    expect(excelDateText(date)).toBe('2024-01-15');
    expect(excelDateText(new Date(2024, 11, 31, 23, 59, 59))).toBe('2024-12-31 23:59:59');
  });

  it('reads an unparseable date cell as blank rather than as "Invalid Date"', () => {
    expect(excelDateText(new Date(NaN))).toBe(BLANK_CELL);
    expect(cellValue(new Date(NaN))).toBe(BLANK_CELL);
  });

  it('leaves a genuine number alone', () => {
    // The fix must not turn every number into a date.
    const rows = parse([['Amount'], [45306], [0]]);
    expect(rows.map(row => row.Amount)).toEqual([45306, 0]);
  });
});

describe('workbook read options', () => {
  it('asks for dates and for the VBA part', () => {
    // bookVBA is a security option: assertWorkbookHasNoMacros tests
    // workbook.vbaraw, which xlsx only fills in when asked to keep the VBA
    // part. Without it that check can never fire, and the buffer scan that
    // usually catches a macro first only reads the leading and trailing 2MB.
    expect(EXCEL_READ_OPTIONS.cellDates).toBe(true);
    expect(EXCEL_READ_OPTIONS.bookVBA).toBe(true);
    expect(EXCEL_READ_OPTIONS.type).toBe('array');
  });
});

describe('the old expression, kept as evidence', () => {
  it('shows what `row[index] || \'\'` did to a zero', () => {
    // Not a test of the fix - a test that the bug was real, so nobody has to
    // take this file's word for it or reintroduce the bug to find out.
    const cell: unknown = 0;
    expect(cell || '').toBe('');
    expect(cellOrBlank(cell)).toBe(0);

    const flag: unknown = false;
    expect(flag || '').toBe('');
    expect(cellOrBlank(flag)).toBe(false);
  });
});
