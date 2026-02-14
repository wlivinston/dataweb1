import { ColumnInfo } from './types';
import { FinanceColumnMapping } from './financeTypes';

export type FinancialDatasetFormat = 'long' | 'wide' | 'unknown';

export type CanonicalTransactionType = 'Income' | 'Expense';

export interface CanonicalTransaction {
  Date: string;
  Account: string;
  Category: string;
  Type: CanonicalTransactionType;
  Debit: number;
  Credit: number;
  Description: string;
  SourceColumn: string;
  SourceRow: number;
  SourceSheet?: string;
  SourceAssetID?: string;
  Flags?: string[];
}

export interface FinancialDatasetFormatDetection {
  format: FinancialDatasetFormat;
  confidence: number;
  reasons: string[];
  suggestedDateColumn?: string;
  suggestedIncomeColumns: string[];
  suggestedExpenseColumns: string[];
  metrics: {
    rowCount: number;
    columnCount: number;
    numericColumnRatio: number;
    dateColumnCount: number;
    repeatedDateRows: number;
    hasAmountDebitCreditColumns: boolean;
    hasTypeIncomeExpenseSignal: boolean;
    categoryLikeNumericColumns: number;
    oneRowPerPeriodSignal: boolean;
  };
}

export interface WideConversionConfig {
  dateColumn: string;
  incomeColumns: string[];
  expenseColumns: string[];
  accountMappings: Record<string, string>;
  categoryMappings: Record<string, string>;
  defaultDescription?: string;
}

export interface FinanceImportTransformationResult {
  transactions: CanonicalTransaction[];
  auditLog: string[];
  warnings: string[];
}

export interface CanonicalValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedRowCount: number;
}

const DATE_NAME_HINTS = [/date/i, /period/i, /month/i, /year/i, /posting.?date/i, /transaction.?date/i];
const LONG_AMOUNT_HINTS = [/amount/i, /debit/i, /credit/i];
const TYPE_HINTS = [/^type$/i, /income.?expense/i, /entry.?type/i, /transaction.?type/i];

const INCOME_COLUMN_HINTS = [
  'income',
  'revenue',
  'sales',
  'fee',
  'commission',
  'subscription',
  'interest',
  'dividend',
  'gain',
];

const EXPENSE_COLUMN_HINTS = [
  'expense',
  'cost',
  'rent',
  'utilities',
  'salary',
  'wage',
  'payroll',
  'tax',
  'marketing',
  'insurance',
  'supplies',
  'maintenance',
  'repairs',
  'cogs',
  'depreciation',
  'amortization',
  'interest expense',
];

const FINANCIAL_CATEGORY_HINTS = [
  ...INCOME_COLUMN_HINTS,
  ...EXPENSE_COLUMN_HINTS,
  'asset',
  'liability',
  'equity',
  'cash',
  'bank',
  'loan',
  'accounts receivable',
  'accounts payable',
  'inventory',
  'utilities',
];

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNumericValue(value: any): number | null {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isParenthesizedNegative = raw.startsWith('(') && raw.endsWith(')');
  const normalized = raw
    .replace(/[,$€£?\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.-]/g, '');

  if (!normalized || normalized === '-' || normalized === '.') return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  if (isParenthesizedNegative && parsed > 0) {
    return -parsed;
  }

  return parsed;
}

function parseDateValue(value: any): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    // Excel serial date conversion (epoch 1899-12-30)
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10);
}

function isLikelyNumericColumn(data: Record<string, any>[], column: string, declaredType?: string): boolean {
  if (declaredType === 'number') return true;

  const sample = data
    .slice(0, 80)
    .map(row => row[column])
    .filter(value => value != null && value !== '');

  if (sample.length === 0) return false;

  const numericCount = sample.filter(value => parseNumericValue(value) != null).length;
  return numericCount / sample.length >= 0.7;
}

function isLikelyDateColumn(data: Record<string, any>[], column: string, declaredType?: string): boolean {
  if (declaredType === 'date') return true;
  if (DATE_NAME_HINTS.some(pattern => pattern.test(column))) return true;

  const sample = data
    .slice(0, 80)
    .map(row => row[column])
    .filter(value => value != null && value !== '');

  if (sample.length === 0) return false;

  const dateCount = sample.filter(value => parseDateValue(value) != null).length;
  return dateCount / sample.length >= 0.7;
}

function scoreCategoryLikeColumn(column: string): boolean {
  const normalized = normalizeName(column);
  return FINANCIAL_CATEGORY_HINTS.some(keyword => normalized.includes(keyword));
}

function inferTypeFromTypeField(rawType: any): CanonicalTransactionType | null {
  if (rawType == null || rawType === '') return null;

  const typeText = normalizeName(String(rawType));
  if (['income', 'revenue', 'credit', 'cr', 'sales'].includes(typeText)) {
    return 'Income';
  }
  if (['expense', 'debit', 'dr', 'cost'].includes(typeText)) {
    return 'Expense';
  }

  if (typeText.includes('income') || typeText.includes('revenue') || typeText.includes('credit')) {
    return 'Income';
  }
  if (typeText.includes('expense') || typeText.includes('debit') || typeText.includes('cost')) {
    return 'Expense';
  }

  return null;
}

function inferColumnIntent(column: string): 'income' | 'expense' | 'unknown' {
  const normalized = normalizeName(column);

  if (INCOME_COLUMN_HINTS.some(keyword => normalized.includes(keyword))) {
    return 'income';
  }

  if (EXPENSE_COLUMN_HINTS.some(keyword => normalized.includes(keyword))) {
    return 'expense';
  }

  return 'unknown';
}

function getColumnNames(columns: ColumnInfo[], data: Record<string, any>[]): string[] {
  if (columns.length > 0) return columns.map(column => column.name);
  if (data.length === 0) return [];
  return Object.keys(data[0]);
}

function sortCanonicalTransactions(rows: CanonicalTransaction[]): CanonicalTransaction[] {
  return [...rows].sort((a, b) => {
    if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
    if (a.SourceColumn !== b.SourceColumn) return a.SourceColumn.localeCompare(b.SourceColumn);
    if (a.Account !== b.Account) return a.Account.localeCompare(b.Account);
    if (a.Type !== b.Type) return a.Type.localeCompare(b.Type);
    return a.SourceRow - b.SourceRow;
  });
}

export function detectFinancialDatasetFormat(
  columns: ColumnInfo[],
  data: Record<string, any>[]
): FinancialDatasetFormatDetection {
  const columnNames = getColumnNames(columns, data);
  const numericColumns = columnNames.filter(name => {
    const declaredType = columns.find(column => column.name === name)?.type;
    return isLikelyNumericColumn(data, name, declaredType);
  });

  const dateColumns = columnNames.filter(name => {
    const declaredType = columns.find(column => column.name === name)?.type;
    return isLikelyDateColumn(data, name, declaredType);
  });

  const hasAmountDebitCreditColumns = columnNames.some(name =>
    LONG_AMOUNT_HINTS.some(pattern => pattern.test(name))
  );

  const typeColumn = columnNames.find(name => TYPE_HINTS.some(pattern => pattern.test(name)));
  const typeSample = typeColumn
    ? data
        .slice(0, 100)
        .map(row => row[typeColumn])
        .filter(value => value != null && value !== '')
    : [];

  const hasTypeIncomeExpenseSignal = typeSample.some(value => {
    const parsedType = inferTypeFromTypeField(value);
    return parsedType === 'Income' || parsedType === 'Expense';
  });

  let repeatedDateRows = 0;
  for (const dateColumn of dateColumns) {
    const parsedDates = data
      .map(row => parseDateValue(row[dateColumn]))
      .filter((value): value is string => value != null);

    if (parsedDates.length <= 1) continue;

    const uniqueDates = new Set(parsedDates);
    const duplicates = parsedDates.length - uniqueDates.size;
    if (duplicates > repeatedDateRows) {
      repeatedDateRows = duplicates;
    }
  }

  const nonDateNumericColumns = numericColumns.filter(name => !dateColumns.includes(name));
  const categoryLikeNumericColumns = nonDateNumericColumns.filter(scoreCategoryLikeColumn).length;
  const numericColumnRatio = columnNames.length > 0 ? numericColumns.length / columnNames.length : 0;

  let oneRowPerPeriodSignal = false;
  if (dateColumns.length > 0) {
    const parsedDates = data
      .map(row => parseDateValue(row[dateColumns[0]]))
      .filter((value): value is string => value != null);

    if (parsedDates.length > 0) {
      const uniqueRatio = new Set(parsedDates).size / parsedDates.length;
      oneRowPerPeriodSignal = uniqueRatio >= 0.9;
    }
  }

  const reasons: string[] = [];
  let longScore = 0;
  let wideScore = 0;

  if (hasAmountDebitCreditColumns) {
    longScore += 4;
    reasons.push('Detected Amount/Debit/Credit style transaction columns.');
  }

  if (hasTypeIncomeExpenseSignal) {
    longScore += 3;
    reasons.push('Detected Type values that look like Income/Expense labels.');
  }

  if (repeatedDateRows > 0) {
    longScore += 2;
    reasons.push('Detected repeated dates across multiple rows (transaction-level pattern).');
  }

  if (dateColumns.length === 1 && nonDateNumericColumns.length >= 2) {
    wideScore += 3;
    reasons.push('Detected one date column with multiple numeric measure columns.');
  }

  if (numericColumnRatio > 0.6) {
    wideScore += 3;
    reasons.push('More than 60% of columns are numeric.');
  }

  if (categoryLikeNumericColumns > 0) {
    wideScore += 2;
    reasons.push('Numeric column names resemble financial categories.');
  }

  if (oneRowPerPeriodSignal) {
    wideScore += 2;
    reasons.push('Rows appear to represent one row per period.');
  }

  let format: FinancialDatasetFormat = 'unknown';
  if (longScore === 0 && wideScore === 0) {
    format = 'unknown';
  } else if (wideScore > longScore + 1) {
    format = 'wide';
  } else {
    format = 'long';
  }

  const maxScore = 10;
  const winningScore = format === 'wide' ? wideScore : longScore;
  const confidence = Math.max(0.5, Math.min(0.99, winningScore / maxScore));

  const suggestedIncomeColumns = nonDateNumericColumns.filter(column => inferColumnIntent(column) === 'income');
  const suggestedExpenseColumns = nonDateNumericColumns.filter(column => inferColumnIntent(column) === 'expense');

  return {
    format,
    confidence,
    reasons,
    suggestedDateColumn: dateColumns[0],
    suggestedIncomeColumns,
    suggestedExpenseColumns,
    metrics: {
      rowCount: data.length,
      columnCount: columnNames.length,
      numericColumnRatio,
      dateColumnCount: dateColumns.length,
      repeatedDateRows,
      hasAmountDebitCreditColumns,
      hasTypeIncomeExpenseSignal,
      categoryLikeNumericColumns,
      oneRowPerPeriodSignal,
    },
  };
}

export function createDefaultWideConversionConfig(
  detection: FinancialDatasetFormatDetection,
  columns: ColumnInfo[]
): WideConversionConfig {
  const columnNames = columns.map(column => column.name);
  const fallbackDate =
    detection.suggestedDateColumn ||
    columnNames.find(name => DATE_NAME_HINTS.some(pattern => pattern.test(name))) ||
    columnNames[0] ||
    '';

  const uniqueIncomeColumns = [...new Set(detection.suggestedIncomeColumns)];
  const uniqueExpenseColumns = [...new Set(detection.suggestedExpenseColumns)];

  const allSelected = [...uniqueIncomeColumns, ...uniqueExpenseColumns];
  const accountMappings: Record<string, string> = {};
  const categoryMappings: Record<string, string> = {};

  for (const column of allSelected) {
    accountMappings[column] = column;
    categoryMappings[column] = column;
  }

  return {
    dateColumn: fallbackDate,
    incomeColumns: uniqueIncomeColumns,
    expenseColumns: uniqueExpenseColumns,
    accountMappings,
    categoryMappings,
    defaultDescription: 'Converted from wide-format dataset',
  };
}

export function transformLongDatasetToCanonical(
  data: Record<string, any>[],
  mapping: FinanceColumnMapping
): FinanceImportTransformationResult {
  const auditLog: string[] = [];
  const warnings: string[] = [];
  const transactions: CanonicalTransaction[] = [];

  auditLog.push('Transformation layer: started LONG -> canonical conversion.');

  const mappedColumns = new Set(
    [
      mapping.date,
      mapping.account,
      mapping.category,
      mapping.type,
      mapping.debit,
      mapping.credit,
      mapping.amount,
      mapping.description,
    ].filter(Boolean) as string[]
  );

  if (data.length > 0) {
    const allColumns = Object.keys(data[0]);
    const unmappedColumns = allColumns.filter(column => !mappedColumns.has(column));
    if (unmappedColumns.length > 0) {
      auditLog.push(`Transformation layer: unmapped columns retained for traceability -> ${unmappedColumns.join(', ')}.`);
    }
  }

  for (let index = 0; index < data.length; index++) {
    const row = data[index];
    const flags: string[] = [];

    const rawDate = mapping.date ? row[mapping.date] : row.Date;
    const parsedDate = parseDateValue(rawDate) || String(rawDate ?? '').trim();

    const account =
      (mapping.account ? String(row[mapping.account] ?? '').trim() : '') ||
      (mapping.category ? String(row[mapping.category] ?? '').trim() : '') ||
      'Unmapped Account';

    const category =
      (mapping.category ? String(row[mapping.category] ?? '').trim() : '') ||
      account;

    const description =
      (mapping.description ? String(row[mapping.description] ?? '').trim() : '') ||
      `Imported transaction from source row ${index + 1}`;

    if (mapping.debit || mapping.credit) {
      const rawDebit = mapping.debit ? parseNumericValue(row[mapping.debit]) : null;
      const rawCredit = mapping.credit ? parseNumericValue(row[mapping.credit]) : null;

      if ((rawDebit == null || rawDebit === 0) && (rawCredit == null || rawCredit === 0)) {
        continue;
      }

      let debit = rawDebit ?? 0;
      let credit = rawCredit ?? 0;

      if (debit < 0) {
        debit = Math.abs(debit);
        flags.push('negative_value_normalized');
      }

      if (credit < 0) {
        credit = Math.abs(credit);
        flags.push('negative_value_normalized');
      }

      const type: CanonicalTransactionType = credit > 0 ? 'Income' : 'Expense';

      const sourceColumn =
        debit > 0 && credit > 0
          ? `${mapping.debit || 'debit'}|${mapping.credit || 'credit'}`
          : credit > 0
            ? mapping.credit || 'Credit'
            : mapping.debit || 'Debit';

      transactions.push({
        Date: parsedDate,
        Account: account,
        Category: category,
        Type: type,
        Debit: debit,
        Credit: credit,
        Description: description,
        SourceColumn: sourceColumn,
        SourceRow: index,
        Flags: flags.length > 0 ? flags : undefined,
      });

      continue;
    }

    if (mapping.amount) {
      const rawAmount = parseNumericValue(row[mapping.amount]);
      if (rawAmount == null || rawAmount === 0) continue;

      const typeFromField = mapping.type ? inferTypeFromTypeField(row[mapping.type]) : null;
      const type: CanonicalTransactionType = typeFromField || (rawAmount >= 0 ? 'Income' : 'Expense');

      if (rawAmount < 0) {
        flags.push('negative_value_normalized');
      }

      const normalizedAmount = Math.abs(rawAmount);
      const debit = type === 'Expense' ? normalizedAmount : 0;
      const credit = type === 'Income' ? normalizedAmount : 0;

      transactions.push({
        Date: parsedDate,
        Account: account,
        Category: category,
        Type: type,
        Debit: debit,
        Credit: credit,
        Description: description,
        SourceColumn: mapping.amount,
        SourceRow: index,
        Flags: flags.length > 0 ? flags : undefined,
      });
    }
  }

  const normalizedRows = transactions.filter(tx => tx.Flags?.includes('negative_value_normalized')).length;
  if (normalizedRows > 0) {
    warnings.push(`${normalizedRows} rows had negative values normalized to positive amounts.`);
    auditLog.push(`Transformation layer: normalized negative values on ${normalizedRows} rows.`);
  }

  auditLog.push(`Transformation layer: produced ${transactions.length} canonical transactions from LONG data.`);

  return {
    transactions: sortCanonicalTransactions(transactions),
    auditLog,
    warnings,
  };
}

export function transformWideDatasetToCanonical(
  data: Record<string, any>[],
  config: WideConversionConfig
): FinanceImportTransformationResult {
  const auditLog: string[] = [];
  const warnings: string[] = [];
  const transactions: CanonicalTransaction[] = [];

  auditLog.push('Transformation layer: started WIDE -> canonical conversion.');
  auditLog.push(
    `Transformation layer: using date column "${config.dateColumn}", income columns [${config.incomeColumns.join(', ')}], expense columns [${config.expenseColumns.join(', ')}].`
  );

  const selectedColumns = new Set([config.dateColumn, ...config.incomeColumns, ...config.expenseColumns]);
  if (data.length > 0) {
    const allColumns = Object.keys(data[0]);
    const ignoredColumns = allColumns.filter(column => !selectedColumns.has(column));
    if (ignoredColumns.length > 0) {
      auditLog.push(`Transformation layer: columns not selected for conversion -> ${ignoredColumns.join(', ')}.`);
    }
  }

  const duplicateSelections = config.incomeColumns.filter(column => config.expenseColumns.includes(column));
  if (duplicateSelections.length > 0) {
    warnings.push(`Columns selected as both income and expense: ${duplicateSelections.join(', ')}.`);
  }

  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    const parsedDate = parseDateValue(row[config.dateColumn]) || String(row[config.dateColumn] ?? '').trim();

    for (const sourceColumn of config.incomeColumns) {
      const rawAmount = parseNumericValue(row[sourceColumn]);
      if (rawAmount == null || rawAmount === 0) continue;

      const flags: string[] = [];
      if (rawAmount < 0) {
        flags.push('negative_value_normalized');
      }

      const normalizedAmount = Math.abs(rawAmount);

      transactions.push({
        Date: parsedDate,
        Account: config.accountMappings[sourceColumn]?.trim() || sourceColumn,
        Category: config.categoryMappings[sourceColumn]?.trim() || sourceColumn,
        Type: 'Income',
        Debit: 0,
        Credit: normalizedAmount,
        Description: config.defaultDescription?.trim() || `Converted from ${sourceColumn}`,
        SourceColumn: sourceColumn,
        SourceRow: rowIndex,
        Flags: flags.length > 0 ? flags : undefined,
      });
    }

    for (const sourceColumn of config.expenseColumns) {
      const rawAmount = parseNumericValue(row[sourceColumn]);
      if (rawAmount == null || rawAmount === 0) continue;

      const flags: string[] = [];
      if (rawAmount < 0) {
        flags.push('negative_value_normalized');
      }

      const normalizedAmount = Math.abs(rawAmount);

      transactions.push({
        Date: parsedDate,
        Account: config.accountMappings[sourceColumn]?.trim() || sourceColumn,
        Category: config.categoryMappings[sourceColumn]?.trim() || sourceColumn,
        Type: 'Expense',
        Debit: normalizedAmount,
        Credit: 0,
        Description: config.defaultDescription?.trim() || `Converted from ${sourceColumn}`,
        SourceColumn: sourceColumn,
        SourceRow: rowIndex,
        Flags: flags.length > 0 ? flags : undefined,
      });
    }
  }

  const normalizedRows = transactions.filter(tx => tx.Flags?.includes('negative_value_normalized')).length;
  if (normalizedRows > 0) {
    warnings.push(`${normalizedRows} wide-format values were negative and normalized.`);
    auditLog.push(`Transformation layer: normalized negative values on ${normalizedRows} generated rows.`);
  }

  auditLog.push(`Transformation layer: produced ${transactions.length} canonical transactions from WIDE data.`);

  return {
    transactions: sortCanonicalTransactions(transactions),
    auditLog,
    warnings,
  };
}

export function validateCanonicalTransactions(transactions: CanonicalTransaction[]): CanonicalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let normalizedRowCount = 0;
  let lossRows = 0;

  if (transactions.length === 0) {
    errors.push('No transactions were generated. Check mapping/conversion selections.');
  }

  for (let index = 0; index < transactions.length; index++) {
    const row = transactions[index];
    const rowLabel = `Row ${index + 1}`;

    if (row.Flags?.includes('negative_value_normalized')) {
      normalizedRowCount += 1;
    }

    if (parseDateValue(row.Date) == null) {
      errors.push(`${rowLabel}: Date is not parseable ("${row.Date}").`);
    }

    if (!Number.isFinite(row.Debit) || !Number.isFinite(row.Credit)) {
      errors.push(`${rowLabel}: Debit/Credit must be numeric.`);
    }

    if (row.Debit < 0 || row.Credit < 0) {
      errors.push(`${rowLabel}: Debit and Credit must be non-negative.`);
    }

    if (row.Debit > 0 && row.Credit > 0) {
      errors.push(`${rowLabel}: Debit and Credit cannot both be populated.`);
    }

    if (row.Type === 'Income' && row.Debit > 0) {
      errors.push(`${rowLabel}: Income rows must only use Credit.`);
    }

    if (row.Type === 'Expense' && row.Credit > 0) {
      errors.push(`${rowLabel}: Expense rows must only use Debit.`);
    }

    if (row.Debit === 0 && row.Credit === 0) {
      warnings.push(`${rowLabel}: Both Debit and Credit are zero.`);
    }

    if (row.Debit > row.Credit) {
      lossRows += 1;
    }
  }

  if (transactions.length > 0) {
    const lossRatio = lossRows / transactions.length;
    if (lossRatio >= 0.95) {
      warnings.push('95%+ of generated rows are losses/expenses. Please confirm mapping is correct.');
    }
  }

  if (normalizedRowCount > 0) {
    warnings.push(`${normalizedRowCount} rows had negative values normalized during import.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    normalizedRowCount,
  };
}

export function canonicalToReportInput(transactions: CanonicalTransaction[]): {
  data: Record<string, any>[];
  mapping: FinanceColumnMapping;
} {
  const data = transactions.map(row => ({
    Date: row.Date,
    Account: row.Account,
    Category: row.Category,
    Type: row.Type,
    Debit: row.Debit,
    Credit: row.Credit,
    Description: row.Description,
    SourceColumn: row.SourceColumn,
    SourceSheet: row.SourceSheet || '',
    SourceAssetID: row.SourceAssetID || '',
  }));

  return {
    data,
    mapping: {
      date: 'Date',
      account: 'Account',
      category: 'Category',
      type: 'Type',
      debit: 'Debit',
      credit: 'Credit',
      description: 'Description',
    },
  };
}

