import * as XLSX from 'xlsx';

/**
 * Turning a worksheet into one object per row.
 *
 * This exists because of one character. Both Excel parsers used to build a
 * row with
 *
 *     obj[header] = row[index] || '';
 *
 * and `0 || ''` is `''`. Every genuine zero in an uploaded spreadsheet became
 * a blank cell before the engine ever saw it: a zero balance, a zero quantity,
 * a stock count of none. Nothing errored and nothing warned. The numbers just
 * came out wrong, and in the direction that is hardest to notice - averages
 * rise, because the denominator drops with the zeros; MIN reports the smallest
 * POSITIVE value; completeness reports missing data that was never missing.
 *
 * The same expression also swallowed `false`, so a boolean column of flags
 * lost exactly the rows where the flag was off.
 *
 * The replacement is deliberately narrower than `||`: only a cell that is
 * genuinely absent becomes blank. `0`, `false` and `''` are values a
 * spreadsheet can legitimately hold, and all three now reach the dataset
 * unchanged.
 */

/** What an absent cell becomes. The rest of the app reads blank as missing. */
export const BLANK_CELL = '';

/**
 * One cell, with absence distinguished from falsiness.
 *
 * `sheet_to_json` with `header: 1` leaves holes rather than padding, so a row
 * shorter than the header row - a trailing empty cell, which is extremely
 * common - reads back `undefined`. That is the only case that means "no cell
 * here", together with the `null` that `defval` can introduce.
 */
export const cellOrBlank = (raw: unknown): unknown =>
  raw === undefined || raw === null ? BLANK_CELL : raw;

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A date cell as the text the rest of the app recognises as a date.
 *
 * Found while fixing the zero bug, on the same two lines, and worse. The
 * workbook was being read WITHOUT `cellDates`, so a date typed into Excel
 * arrived here as its storage serial - `45306` for 2024-01-15 - and every
 * date column in every uploaded workbook was imported as a meaningless
 * number. No time intelligence, no year or month grouping, and a column of
 * five-digit figures where the dates should be. The Finance import in this
 * same codebase already passed `cellDates: true`, which is how the omission
 * stood out.
 *
 * `cellDates: true` alone is not enough: type detection reads a `Date` object
 * as a number too, because `Number(date)` is its epoch milliseconds. So the
 * Date is written out in the shape the CSV path already produces and
 * `detectDataType` already looks for - `YYYY-MM-DD`, extended with a time
 * only when the cell carries one, so a timestamp is not silently truncated.
 *
 * LOCAL components, not UTC. xlsx builds the Date at local midnight for a
 * date-only cell, so `getUTCDate()` reads the day before anywhere east of
 * Greenwich. Verified against a workbook holding the raw serial, which is how
 * Excel itself stores a date.
 */
export const excelDateText = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return BLANK_CELL;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const carriesTime =
    date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
  return carriesTime
    ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : day;
};

/** One cell, as the dataset should hold it. */
export const cellValue = (raw: unknown): unknown =>
  raw instanceof Date ? excelDateText(raw) : cellOrBlank(raw);

/**
 * How a workbook has to be read for anything below to be correct.
 *
 * `cellDates` is not optional: without it a date cell arrives as its storage
 * serial and there is no way to tell it from a genuine number afterwards. See
 * excelDateText above.
 *
 * `bookVBA` is a security option, not a parsing one. assertWorkbookHasNoMacros
 * tests `workbook.vbaraw`, and xlsx only populates vbaraw when asked to keep
 * the VBA part - so without this option that branch of the macro check can
 * never fire. The buffer scan in assertExcelBufferIsSafe usually catches a
 * macro first, but it only reads the leading and trailing 2MB, so for a large
 * workbook the vbaraw check is the backstop, and the backstop was off.
 */
export const EXCEL_READ_OPTIONS = {
  type: 'array',
  cellDates: true,
  bookVBA: true,
} as const;

/**
 * The header row and the data rows of a worksheet, as xlsx gives them.
 *
 * Separated from the mapping below so a caller can inspect the headers - the
 * all-sheets parser has to decide whether a sheet is worth keeping - without
 * converting twice.
 */
const splitHeaderRow = (
  worksheet: XLSX.WorkSheet
): { headers: string[]; rows: unknown[][] } => {
  const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
  if (grid.length === 0) return { headers: [], rows: [] };
  return {
    headers: (grid[0] ?? []).map(value => String(cellValue(value))),
    rows: grid.slice(1),
  };
};

/**
 * A worksheet as one object per data row, keyed by the header row.
 *
 * Returns an empty array for an empty sheet and for a sheet that is nothing
 * but a header row, so callers can treat "no rows" as one case.
 */
export const sheetToObjects = (
  worksheet: XLSX.WorkSheet
): Record<string, unknown>[] => {
  const { headers, rows } = splitHeaderRow(worksheet);
  if (headers.length === 0) return [];

  return rows.map(row => {
    const object: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      object[header] = cellValue(row?.[index]);
    });
    return object;
  });
};
