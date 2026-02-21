// Bank Reconciliation Engine
// Matches bank statement rows against scoped book cash/bank transactions
// and produces a reconciliation statement with caveats.

import { v4 as uuidv4 } from 'uuid';
import {
  BankReconciliation,
  BankReconciliationOptions,
  BankReconItemType,
  BankStatementColumnMapping,
  BankStatementDateFormat,
  BankStatementRow,
  ClassifiedTransaction,
  ParsedBankStatementResult,
  ReconciliationMatch,
} from './financeTypes';

const DATE_MATCH_TOLERANCE_DAYS = 3;
const AMOUNT_EXACT_TOLERANCE = 0.01;
const AMOUNT_NEAR_TOLERANCE_PCT = 0.05;
const DATE_NEAR_TOLERANCE_DAYS = 7;
const NARRATIVE_NEAR_MATCH_MIN_SCORE = 0.2;

const BANK_ACCOUNT_NAME_REGEX =
  /(cash|bank|checking|cheque|current account|savings|petty cash|cash equivalents?)/i;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const parenthesized = raw.startsWith('(') && raw.endsWith(')');
  const cleaned = raw
    .replace(/[,\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.-]/g, '');

  if (!cleaned || cleaned === '-' || cleaned === '.') return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  if (parenthesized && parsed > 0) return -parsed;
  return parsed;
}

function toIsoDate(yearRaw: number, monthRaw: number, dayRaw: number): string {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';

  // Guard against invalid calendar rollovers (e.g., 2026-02-31).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function normalizeTwoDigitYear(yearRaw: number): number {
  if (yearRaw >= 100) return yearRaw;
  // Industry convention for modern operational statements.
  return 2000 + yearRaw;
}

function parseDelimitedDate(value: string, format: BankStatementDateFormat): string {
  const parts = value.split(/[\/\-.]/).map(part => part.trim());
  if (parts.length !== 3) return '';

  const [aRaw, bRaw, cRaw] = parts;
  const a = Number(aRaw);
  const b = Number(bRaw);
  const c = Number(cRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return '';

  if (aRaw.length === 4) {
    // YYYY-MM-DD style.
    return toIsoDate(a, b, c);
  }

  if (format === 'ymd') {
    return '';
  }

  const year = cRaw.length <= 2 ? normalizeTwoDigitYear(c) : c;

  if (format === 'mdy') {
    return toIsoDate(year, a, b);
  }
  if (format === 'dmy') {
    return toIsoDate(year, b, a);
  }

  // auto: only accept unambiguous day/month ordering.
  if (a > 12 && b <= 12) {
    return toIsoDate(year, b, a); // DMY
  }
  if (b > 12 && a <= 12) {
    return toIsoDate(year, a, b); // MDY
  }

  // Ambiguous numeric date (e.g., 01/02/2026): reject in auto mode.
  return '';
}

function parseStatementDate(value: unknown, format: BankStatementDateFormat): string {
  if (value == null || value === '') return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 10000 && value < 60000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }

  const text = String(value).trim();
  if (!text) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(text)) {
    return parseDelimitedDate(text, 'ymd');
  }

  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(text)) {
    return parseDelimitedDate(text, format);
  }

  // Textual month formats (e.g., "Jan 31, 2026").
  const fallback = Date.parse(text);
  if (!Number.isNaN(fallback)) {
    return new Date(fallback).toISOString().slice(0, 10);
  }

  return '';
}

function dateDiffDays(left: string, right: string): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const l = Date.parse(left);
  const r = Date.parse(right);
  if (Number.isNaN(l) || Number.isNaN(r)) return Number.POSITIVE_INFINITY;
  return Math.abs(l - r) / (1000 * 60 * 60 * 24);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNarrative(value: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'from', 'to', 'with', 'bank', 'payment', 'deposit']);
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !stopWords.has(token));
}

function extractReferenceTokens(value: string): Set<string> {
  const matches = value.match(/\b\d{4,}\b/g) || [];
  return new Set(matches);
}

function narrativeSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeNarrative(left));
  const rightTokens = new Set(tokenizeNarrative(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  if (unionSize === 0) return 0;
  return overlap / unionSize;
}

function hasReferenceOverlap(left: string, right: string): boolean {
  const leftRefs = extractReferenceTokens(left);
  const rightRefs = extractReferenceTokens(right);
  if (leftRefs.size === 0 || rightRefs.size === 0) return false;

  for (const ref of leftRefs) {
    if (rightRefs.has(ref)) return true;
  }
  return false;
}

function getBankRowSignedAmount(row: BankStatementRow): number {
  if (row.credit > 0) return row.credit;
  if (row.debit > 0) return -row.debit;
  return 0;
}

function inferBookAccountScope(
  transactions: ClassifiedTransaction[],
  requestedScope: 'auto' | string,
): { scoped: ClassifiedTransaction[]; accountsUsed: string[]; notes: string[] } {
  const notes: string[] = [];

  if (requestedScope !== 'auto') {
    const scoped = transactions.filter(
      tx => tx.account.toLowerCase().trim() === requestedScope.toLowerCase().trim(),
    );
    if (scoped.length === 0) {
      notes.push(`Selected book account "${requestedScope}" had no transactions in the imported period.`);
      return { scoped: [], accountsUsed: [], notes };
    }
    return { scoped, accountsUsed: [requestedScope], notes };
  }

  const accountMatches = transactions.filter(tx => BANK_ACCOUNT_NAME_REGEX.test(tx.account));
  if (accountMatches.length > 0) {
    const accountsUsed = [...new Set(accountMatches.map(tx => tx.account))].sort((a, b) => a.localeCompare(b));
    notes.push(`Auto scope selected ${accountsUsed.length} cash/bank-like account(s).`);
    return { scoped: accountMatches, accountsUsed, notes };
  }

  const operatingCashMatches = transactions.filter(tx => tx.category === 'operating_cash');
  if (operatingCashMatches.length > 0) {
    const accountsUsed = [...new Set(operatingCashMatches.map(tx => tx.account))].sort((a, b) =>
      a.localeCompare(b),
    );
    notes.push('Auto scope fallback: using operating_cash category because no explicit bank/cash account names were detected.');
    return { scoped: operatingCashMatches, accountsUsed, notes };
  }

  notes.push('No book cash/bank transactions were detected for reconciliation scope.');
  return { scoped: [], accountsUsed: [], notes };
}

export function detectBankStatementColumns(columns: string[]): BankStatementColumnMapping {
  const mapping: BankStatementColumnMapping = {};

  for (const original of columns) {
    const header = normalizeText(original);

    if (!mapping.date && /(date|txn date|transaction date|value date|posting date|entry date)/.test(header)) {
      mapping.date = original;
    }
    if (
      !mapping.description &&
      /(description|narration|details|memo|reference|remarks|particulars|narrative)/.test(header)
    ) {
      mapping.description = original;
    }
    if (!mapping.debit && /(debit|withdrawal|payment|money out|dr|charges?)/.test(header)) {
      mapping.debit = original;
    }
    if (!mapping.credit && /(credit|deposit|receipt|money in|cr|income)/.test(header)) {
      mapping.credit = original;
    }
    if (!mapping.amount && /(amount|net amount|transaction amount|signed amount)/.test(header)) {
      mapping.amount = original;
    }
    if (!mapping.balance && /(balance|running balance|closing balance|available balance|ledger balance)/.test(header)) {
      mapping.balance = original;
    }
  }

  return mapping;
}

export function parseBankStatement(
  rawData: Record<string, unknown>[],
  mapping: BankStatementColumnMapping,
  options?: { dateFormat?: BankStatementDateFormat },
): ParsedBankStatementResult {
  const dateFormat = options?.dateFormat || 'auto';
  const rows: BankStatementRow[] = [];
  const warnings: string[] = [];

  let unparseableDateRows = 0;
  let zeroAmountRows = 0;

  if (!mapping.date) {
    return {
      rows: [],
      droppedRowCount: rawData.length,
      unparseableDateRows: rawData.length,
      zeroAmountRows: 0,
      warnings: ['Date column is required for bank reconciliation.'],
    };
  }

  const hasDirectionalAmounts = Boolean(mapping.debit || mapping.credit);
  const hasNetAmount = Boolean(mapping.amount);
  if (!hasDirectionalAmounts && !hasNetAmount) {
    warnings.push('Map either Debit/Credit columns or a signed Amount column before reconciliation.');
  }

  for (let index = 0; index < rawData.length; index++) {
    const row = rawData[index];
    const date = parseStatementDate(row[mapping.date], dateFormat);
    if (!date) {
      unparseableDateRows += 1;
      continue;
    }

    const description = String(mapping.description ? row[mapping.description] ?? '' : '').trim();

    let debit = 0;
    let credit = 0;

    if (hasDirectionalAmounts) {
      const rawDebit = mapping.debit ? parseAmount(row[mapping.debit]) : null;
      const rawCredit = mapping.credit ? parseAmount(row[mapping.credit]) : null;

      debit = rawDebit == null ? 0 : Math.abs(rawDebit);
      credit = rawCredit == null ? 0 : Math.abs(rawCredit);
    }

    if (debit === 0 && credit === 0 && hasNetAmount && mapping.amount) {
      const rawAmount = parseAmount(row[mapping.amount]);
      if (rawAmount != null) {
        if (rawAmount < 0) {
          debit = Math.abs(rawAmount);
        } else if (rawAmount > 0) {
          credit = rawAmount;
        }
      }
    }

    if (debit === 0 && credit === 0) {
      zeroAmountRows += 1;
      continue;
    }

    const balanceRaw = mapping.balance ? parseAmount(row[mapping.balance]) : null;
    rows.push({
      id: uuidv4(),
      date,
      description,
      debit,
      credit,
      balance: balanceRaw == null ? undefined : balanceRaw,
      rawRow: index + 2, // header row + 1-based data row
    });
  }

  if (unparseableDateRows > 0) {
    warnings.push(
      `${unparseableDateRows} statement row(s) were dropped because date was invalid or ambiguous for date format "${dateFormat.toUpperCase()}".`,
    );
  }
  if (zeroAmountRows > 0) {
    warnings.push(`${zeroAmountRows} statement row(s) were dropped because both debit and credit were zero.`);
  }
  if (rows.length === 0) {
    warnings.push('No valid bank statement rows were parsed. Review mapping and date format.');
  }

  return {
    rows,
    droppedRowCount: unparseableDateRows + zeroAmountRows,
    unparseableDateRows,
    zeroAmountRows,
    warnings,
  };
}

export function reconcileBank(
  bankRows: BankStatementRow[],
  bookTransactions: ClassifiedTransaction[],
  options?: BankReconciliationOptions,
): BankReconciliation {
  const requestedScope = options?.bookAccountScope || 'auto';
  const scope = inferBookAccountScope(bookTransactions, requestedScope);
  const scopedBookTransactions = scope.scoped;
  const notes = [...scope.notes];

  const statementDate =
    options?.statementDate ||
    (bankRows.length > 0
      ? bankRows.reduce((latest, row) => (row.date > latest ? row.date : latest), bankRows[0].date)
      : new Date().toISOString().slice(0, 10));

  const sortedBankRows = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));
  const lastWithBalance = [...sortedBankRows].reverse().find(row => row.balance != null);
  const bankClosingBalance =
    lastWithBalance?.balance ??
    roundMoney(sortedBankRows.reduce((sum, row) => sum + getBankRowSignedAmount(row), 0));

  const bookClosingBalance = roundMoney(
    scopedBookTransactions.reduce((sum, tx) => (tx.type === 'debit' ? sum + Math.abs(tx.amount) : sum - Math.abs(tx.amount)), 0),
  );

  const matchedBankIds = new Set<string>();
  const matchedBookIndexes = new Set<number>();
  const matchedItems: ReconciliationMatch[] = [];
  const amountMismatches: ReconciliationMatch[] = [];

  // Pass 1: exact amount + same transaction direction + close date.
  for (const bankRow of sortedBankRows) {
    const bankAmount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    if (bankAmount <= 0) continue;

    const expectedBookType: 'debit' | 'credit' = bankRow.credit > 0 ? 'debit' : 'credit';

    for (let index = 0; index < scopedBookTransactions.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = scopedBookTransactions[index];
      if (book.type !== expectedBookType) continue;

      const bookAmount = Math.abs(book.amount);
      if (Math.abs(bankAmount - bookAmount) > AMOUNT_EXACT_TOLERANCE) continue;
      if (dateDiffDays(bankRow.date, book.date) > DATE_MATCH_TOLERANCE_DAYS) continue;

      matchedBankIds.add(bankRow.id);
      matchedBookIndexes.add(index);
      matchedItems.push({
        bankRow,
        bookTransaction: book,
        type: 'matched',
        amount: roundMoney(bankAmount),
        variance: 0,
      });
      break;
    }
  }

  // Pass 2: near amount + same direction + date window + narrative similarity.
  for (const bankRow of sortedBankRows) {
    if (matchedBankIds.has(bankRow.id)) continue;
    const bankAmount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    if (bankAmount <= 0) continue;

    const expectedBookType: 'debit' | 'credit' = bankRow.credit > 0 ? 'debit' : 'credit';

    for (let index = 0; index < scopedBookTransactions.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = scopedBookTransactions[index];
      if (book.type !== expectedBookType) continue;

      const bookAmount = Math.abs(book.amount);
      if (bookAmount <= 0) continue;

      const percentDiff = Math.abs(bankAmount - bookAmount) / bankAmount;
      if (percentDiff > AMOUNT_NEAR_TOLERANCE_PCT) continue;
      if (dateDiffDays(bankRow.date, book.date) > DATE_NEAR_TOLERANCE_DAYS) continue;

      const bankText = bankRow.description || '';
      const bookText = `${book.description || ''} ${book.account || ''}`.trim();
      const similarNarrative =
        narrativeSimilarity(bankText, bookText) >= NARRATIVE_NEAR_MATCH_MIN_SCORE ||
        hasReferenceOverlap(bankText, bookText) ||
        bankText.trim() === '' ||
        bookText.trim() === '';
      if (!similarNarrative) continue;

      matchedBankIds.add(bankRow.id);
      matchedBookIndexes.add(index);
      amountMismatches.push({
        bankRow,
        bookTransaction: book,
        type: 'amount_mismatch',
        amount: roundMoney(bankAmount),
        variance: roundMoney(Math.abs(bankAmount - bookAmount)),
      });
      break;
    }
  }

  const bankOnlyItems: ReconciliationMatch[] = sortedBankRows
    .filter(row => !matchedBankIds.has(row.id) && (row.debit > 0 || row.credit > 0))
    .map(row => ({
      bankRow: row,
      type: 'bank_only' as BankReconItemType,
      amount: roundMoney(row.debit > 0 ? row.debit : row.credit),
      variance: roundMoney(row.debit > 0 ? row.debit : row.credit),
    }));

  const bookOnlyItems: ReconciliationMatch[] = scopedBookTransactions
    .filter((_, index) => !matchedBookIndexes.has(index))
    .map(book => ({
      bookTransaction: book,
      type: 'book_only' as BankReconItemType,
      amount: roundMoney(Math.abs(book.amount)),
      variance: roundMoney(Math.abs(book.amount)),
    }));

  const bankChargesUnrecorded = bankOnlyItems.filter(item => (item.bankRow?.debit || 0) > 0);
  const bankCreditsUnrecorded = bankOnlyItems.filter(item => (item.bankRow?.credit || 0) > 0);
  const outstandingCheques = bookOnlyItems.filter(item => item.bookTransaction?.type === 'credit');
  const depositsInTransit = bookOnlyItems.filter(item => item.bookTransaction?.type === 'debit');

  const depositsInTransitTotal = roundMoney(depositsInTransit.reduce((sum, item) => sum + item.amount, 0));
  const outstandingChequesTotal = roundMoney(outstandingCheques.reduce((sum, item) => sum + item.amount, 0));
  const bankChargesTotal = roundMoney(bankChargesUnrecorded.reduce((sum, item) => sum + item.amount, 0));
  const bankCreditsTotal = roundMoney(bankCreditsUnrecorded.reduce((sum, item) => sum + item.amount, 0));

  const adjustedBankBalance = roundMoney(bankClosingBalance + depositsInTransitTotal - outstandingChequesTotal);
  const adjustedBookBalance = roundMoney(bookClosingBalance + bankCreditsTotal - bankChargesTotal);
  const difference = roundMoney(Math.abs(adjustedBankBalance - adjustedBookBalance));

  if (amountMismatches.length > 0) {
    notes.push(
      `${amountMismatches.length} near-match item(s) were flagged as amount mismatches and require manual review.`,
    );
  }
  if (scope.accountsUsed.length === 0) {
    notes.push('No scoped book cash/bank accounts were available; reconciliation confidence is low.');
  }
  if (matchedItems.length === 0 && bankRows.length > 0 && scopedBookTransactions.length > 0) {
    notes.push('No exact matches were found. Verify date format, account scope, and statement period.');
  }
  if (difference >= 1) {
    notes.push(`Adjusted balances still differ by ${difference.toFixed(2)}.`);
  }

  return {
    statementDate,
    bankClosingBalance: roundMoney(bankClosingBalance),
    bookClosingBalance: roundMoney(bookClosingBalance),
    bookAccountScope: requestedScope,
    bookAccountsUsed: scope.accountsUsed,
    depositsInTransit,
    outstandingCheques,
    bankChargesUnrecorded,
    bankCreditsUnrecorded,
    amountMismatches,
    matchedItems,
    adjustedBankBalance,
    adjustedBookBalance,
    isReconciled: difference < 1 && amountMismatches.length === 0,
    difference,
    totalTransactionsMatched: matchedItems.length,
    totalTransactionsUnmatched: bankOnlyItems.length + bookOnlyItems.length + amountMismatches.length,
    notes,
  };
}
