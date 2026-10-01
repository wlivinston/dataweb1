/**
 * Generates a small Excel workbook for checking an import by hand.
 *
 *   node scripts/make-sample-workbook.mjs
 *   -> samples/dataafrik-import-check.xlsx
 *
 * Committed as a script rather than as a workbook: the .xlsx is a binary that
 * would churn in every diff, and the expected answers below are the part worth
 * reviewing. Regenerate it whenever you need it.
 *
 * The figures are chosen so every answer can be checked in your head, and so
 * that the two bugs this file was written for would both be visible:
 *
 *   - Zeros. Units and Amount each hold two genuine zeros. `row[index] || ''`
 *     turned those into blanks, which dropped them from every statistic.
 *     Before the fix: Units MIN 5, mean 12.5 over 4 rows, "2 missing".
 *     After:          Units MIN 0, mean 8.33 over 6 rows, 0 missing.
 *
 *   - Dates. The Date column is stored as Excel stores dates - a serial with a
 *     date format - which was imported as the raw number 45306 and friends.
 *     After the fix it reads as 2024-01-15.
 *
 * Expected answers, for checking against the platform:
 *
 *   Sales, 6 rows
 *     Units    10, 0, 5, 20, 0, 15   SUM 50    MIN 0   MAX 20   MEAN 8.333...
 *     Amount   1000, 0, 500, 2000, 0, 1500
 *                                    SUM 5000  MIN 0   MAX 2000 MEAN 833.333...
 *     Returns  0, 0, 2, 0, 1, 0      SUM 3     MIN 0   MAX 2    MEAN 0.5
 *     Expedited  3 true, 3 false
 *     Date     2024-01-15 .. 2024-06-22, one row per month
 *     Region   Accra 1000, Kumasi 2500, Tamale 1500   (Amount by Region)
 *     Product  Widget 1500, Gadget 3500               (Amount by Region)
 *     No missing values anywhere. Completeness is 100%.
 *
 *   Targets, 3 rows
 *     Target   1000, 2500, 0         SUM 3500  MIN 0   MAX 2500 MEAN 1166.666...
 *     Tamale's target is 0 on purpose: it is the one a blank would hide.
 *     Joins to Sales on Region.
 */

import * as XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, '..', 'samples');
const outputPath = join(outputDir, 'dataafrik-import-check.xlsx');

/** Days between 1899-12-30 (Excel's epoch) and the given date. */
const serial = (year, month, day) =>
  Math.round(Date.UTC(year, month - 1, day) / 86400000) + 25569;

const SALES = [
  { id: 1, date: serial(2024, 1, 15), region: 'Accra', product: 'Widget', units: 10, amount: 1000, returns: 0, expedited: true },
  { id: 2, date: serial(2024, 2, 20), region: 'Accra', product: 'Gadget', units: 0, amount: 0, returns: 0, expedited: false },
  { id: 3, date: serial(2024, 3, 10), region: 'Kumasi', product: 'Widget', units: 5, amount: 500, returns: 2, expedited: false },
  { id: 4, date: serial(2024, 4, 5), region: 'Kumasi', product: 'Gadget', units: 20, amount: 2000, returns: 0, expedited: true },
  { id: 5, date: serial(2024, 5, 18), region: 'Tamale', product: 'Widget', units: 0, amount: 0, returns: 1, expedited: false },
  { id: 6, date: serial(2024, 6, 22), region: 'Tamale', product: 'Gadget', units: 15, amount: 1500, returns: 0, expedited: true },
];

const TARGETS = [
  { region: 'Accra', target: 1000 },
  { region: 'Kumasi', target: 2500 },
  { region: 'Tamale', target: 0 },
];

const text = value => ({ t: 's', v: value });
const number = value => ({ t: 'n', v: value });
const bool = value => ({ t: 'b', v: value });
/** A date the way Excel stores one: a serial carrying a date number format. */
const date = value => ({ t: 'n', v: value, z: 'yyyy-mm-dd' });

/** Builds a sheet from explicit cells, so cell TYPES are what we intend. */
const sheetOf = rows => {
  const sheet = {};
  const columns = 'ABCDEFGH'.split('');
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      sheet[`${columns[columnIndex]}${rowIndex + 1}`] = cell;
    });
  });
  const width = Math.max(...rows.map(row => row.length));
  sheet['!ref'] = `A1:${columns[width - 1]}${rows.length}`;
  return sheet;
};

const sales = sheetOf([
  ['OrderID', 'Date', 'Region', 'Product', 'Units', 'Amount', 'Returns', 'Expedited'].map(text),
  ...SALES.map(row => [
    number(row.id),
    date(row.date),
    text(row.region),
    text(row.product),
    number(row.units),
    number(row.amount),
    number(row.returns),
    bool(row.expedited),
  ]),
]);

const targets = sheetOf([
  ['Region', 'Target'].map(text),
  ...TARGETS.map(row => [text(row.region), number(row.target)]),
]);

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sales, 'Sales');
XLSX.utils.book_append_sheet(book, targets, 'Targets');

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));

console.log(`Wrote ${outputPath}`);
console.log(`  Sales:   ${SALES.length} rows, ${SALES.filter(r => r.units === 0).length} zero Units, ${SALES.filter(r => r.amount === 0).length} zero Amount`);
console.log(`  Targets: ${TARGETS.length} rows, ${TARGETS.filter(r => r.target === 0).length} zero Target`);
