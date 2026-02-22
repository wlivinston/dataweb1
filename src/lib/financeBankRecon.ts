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

const DATE_MATCH_TOLERANCE_BUSINESS_DAYS = 2;
const REFERENCE_MATCH_TOLERANCE_DAYS = 10;
const AMOUNT_EXACT_TOLERANCE_CENTS = 1;
const AMOUNT_NEAR_TOLERANCE_PCT = 0.05;
const DATE_NEAR_TOLERANCE_DAYS = 7;
const NARRATIVE_NEAR_MATCH_MIN_SCORE = 0.2;

const BANK_ACCOUNT_NAME_REGEX =
  /(cash|bank|checking|cheque|current account|savings|petty cash|cash equivalents?)/i;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
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

function toAmountCents(value: number): number {
  return Math.round(value * 100);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function businessDayDiff(left: string, right: string): number {
  const l = parseIsoDate(left);
  const r = parseIsoDate(right);
  if (!l || !r) return Number.POSITIVE_INFINITY;

  let start = l;
  let end = r;
  if (start.getTime() > end.getTime()) {
    start = r;
    end = l;
  }

  const cursor = new Date(start.getTime());
  let businessDays = 0;

  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
  }

  return businessDays;
}

function normalizeReference(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
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
  const normalized = String(value || '').toUpperCase();
  const tokens = normalized.match(/\b[A-Z0-9-]{4,}\b/g) || [];
  const filtered = tokens
    .map(token => normalizeReference(token))
    .filter(token => token.length >= 4 && /\d/.test(token));
  return new Set(filtered);
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

function inferDirectionFromTypeField(value: unknown): 'debit' | 'credit' | null {
  if (value == null || value === '') return null;

  const text = normalizeText(String(value));
  if (!text) return null;

  const hasDebitSignal =
    /\bdr\b/.test(text) ||
    /\bdebit\b/.test(text) ||
    /\bwithdraw/.test(text) ||
    /\bpayment\b/.test(text) ||
    /\bcharge\b/.test(text) ||
    /\bfee\b/.test(text) ||
    /\bmoney out\b/.test(text) ||
    /\boutflow\b/.test(text);

  const hasCreditSignal =
    /\bcr\b/.test(text) ||
    /\bcredit\b/.test(text) ||
    /\bdeposit\b/.test(text) ||
    /\breceipt\b/.test(text) ||
    /\bincome\b/.test(text) ||
    /\binterest\b/.test(text) ||
    /\bmoney in\b/.test(text) ||
    /\binflow\b/.test(text);

  if (hasDebitSignal === hasCreditSignal) return null;
  return hasDebitSignal ? 'debit' : 'credit';
}

function getBankRowSignedAmount(row: BankStatementRow): number {
  if (row.credit > 0) return row.credit;
  if (row.debit > 0) return -row.debit;
  return 0;
}

function getBankRowDirection(row: BankStatementRow): 'in' | 'out' | null {
  if (row.credit > 0 && row.debit <= 0) return 'in';
  if (row.debit > 0 && row.credit <= 0) return 'out';
  if (row.credit > 0 && row.debit > 0) {
    return row.credit >= row.debit ? 'in' : 'out';
  }
  return null;
}

function getBookDirection(tx: ClassifiedTransaction): 'in' | 'out' {
  return tx.type === 'debit' ? 'in' : 'out';
}

function buildMatchKey(reference: string, amountCents: number, direction: 'in' | 'out'): string {
  return `${reference}|${amountCents}|${direction}`;
}

function isOpeningBalanceText(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  return (
    /opening balance/.test(text) ||
    /beginning balance/.test(text) ||
    /brought forward/.test(text) ||
    /\bb f\b/.test(text) ||
    /opening bal/.test(text) ||
    /opening equity/.test(text)
  );
}

function isOpeningBankRow(row: BankStatementRow): boolean {
  if (row.isOpeningBalance) return true;
  return isOpeningBalanceText(`${row.description || ''} ${row.reference || ''}`);
}

function isOpeningBookTransaction(tx: ClassifiedTransaction): boolean {
  return isOpeningBalanceText(`${tx.account || ''} ${tx.description || ''} ${tx.reference || ''}`);
}

function isWithinDateRange(date: string, startDate: string, endDate: string): boolean {
  if (!date || !startDate || !endDate) return false;
  return date >= startDate && date <= endDate;
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
  let bestBalanceColumn: string | undefined;
  let bestBalanceScore = Number.NEGATIVE_INFINITY;

  for (const original of columns) {
    const header = normalizeText(original);

    if (!mapping.date && /(date|txn date|transaction date|value date|posting date|entry date)/.test(header)) {
      mapping.date = original;
    }
    if (
      !mapping.reference &&
      /(reference|journal ?ref|ref ?no|voucher ?no|document ?no|txn ?id|transaction ?id|trace|utr|cheque ?no|check ?no)/.test(
        header,
      )
    ) {
      mapping.reference = original;
    }
    if (
      !mapping.description &&
      /(description|narration|details|memo|remarks|particulars|narrative)/.test(header)
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
    if (
      !mapping.type &&
      /(transaction ?type|txn ?type|entry ?type|dr ?cr|debit ?credit|direction|money in out|in out|flow ?type)/.test(
        header,
      )
    ) {
      mapping.type = original;
    }

    if (/(balance|running balance|closing balance|available balance|ledger balance|ending balance|final balance)/.test(header)) {
      let score = 0;
      if (/\bbalance\b/.test(header)) score += 5;
      if (/(running|closing|ending|final|ledger|available|current)/.test(header)) score += 30;
      if (/(opening|beginning|start|brought forward|\bb f\b)/.test(header)) score -= 20;

      if (score > bestBalanceScore) {
        bestBalanceScore = score;
        bestBalanceColumn = original;
      }
    }
  }

  if (bestBalanceColumn) {
    mapping.balance = bestBalanceColumn;
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
  let ambiguousDirectionRows = 0;

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
    const reference = normalizeReference(
      mapping.reference ? row[mapping.reference] : undefined,
    );

    let debit = 0;
    let credit = 0;
    const directionFromType = mapping.type ? inferDirectionFromTypeField(row[mapping.type]) : null;

    if (hasDirectionalAmounts) {
      const rawDebit = mapping.debit ? parseAmount(row[mapping.debit]) : null;
      const rawCredit = mapping.credit ? parseAmount(row[mapping.credit]) : null;

      debit = rawDebit == null ? 0 : Math.abs(rawDebit);
      credit = rawCredit == null ? 0 : Math.abs(rawCredit);
    }

    if (debit === 0 && credit === 0 && hasNetAmount && mapping.amount) {
      const rawAmount = parseAmount(row[mapping.amount]);
      if (rawAmount != null) {
        const absAmount = Math.abs(rawAmount);

        if (directionFromType === 'debit') {
          debit = absAmount;
        } else if (directionFromType === 'credit') {
          credit = absAmount;
        } else if (!mapping.type) {
          if (rawAmount < 0) {
            debit = absAmount;
          } else if (rawAmount > 0) {
            credit = rawAmount;
          }
        } else if (rawAmount < 0) {
          // Negative signed amount still provides direction even if type text is unclear.
          debit = absAmount;
        } else if (rawAmount > 0) {
          // Ambiguous positive amount with unknown transaction type: drop row to prevent sign inversion.
          ambiguousDirectionRows += 1;
          continue;
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
      reference: reference || undefined,
      debit,
      credit,
      balance: balanceRaw == null ? undefined : balanceRaw,
      isOpeningBalance: isOpeningBalanceText(`${description} ${reference}`),
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
  if (ambiguousDirectionRows > 0) {
    warnings.push(
      `${ambiguousDirectionRows} statement row(s) had positive Amount values but transaction direction could not be inferred from "${mapping.type}".`,
    );
  }
  if (rows.length === 0) {
    warnings.push('No valid bank statement rows were parsed. Review mapping and date format.');
  }

  return {
    rows,
    droppedRowCount: unparseableDateRows + zeroAmountRows + ambiguousDirectionRows,
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
  const sortedBankRows = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));
  const bankRowsWithoutOpening = sortedBankRows.filter(row => !isOpeningBankRow(row));
  const bankRowsForWindowSeed = bankRowsWithoutOpening.length > 0 ? bankRowsWithoutOpening : sortedBankRows;

  let statementStartDate =
    options?.statementStartDate ||
    (bankRowsForWindowSeed.length > 0 ? bankRowsForWindowSeed[0].date : '');
  let statementEndDate =
    options?.statementEndDate ||
    (bankRowsForWindowSeed.length > 0
      ? bankRowsForWindowSeed[bankRowsForWindowSeed.length - 1].date
      : '');

  if (statementStartDate && statementEndDate && statementStartDate > statementEndDate) {
    const swapped = statementStartDate;
    statementStartDate = statementEndDate;
    statementEndDate = swapped;
  }

  const statementDate =
    options?.statementDate ||
    statementEndDate ||
    (bankRows.length > 0
      ? bankRows.reduce((latest, row) => (row.date > latest ? row.date : latest), bankRows[0].date)
      : new Date().toISOString().slice(0, 10));

  const bankRowsForClosing = sortedBankRows.filter(row => {
    if (isOpeningBankRow(row)) return false;
    if (statementEndDate && row.date > statementEndDate) return false;
    return true;
  });

  const lastWithBalance = [...sortedBankRows]
    .filter(row => !statementEndDate || row.date <= statementEndDate)
    .reverse()
    .find(row => row.balance != null);

  const bankClosingBalance =
    lastWithBalance?.balance ??
    roundMoney(bankRowsForClosing.reduce((sum, row) => sum + getBankRowSignedAmount(row), 0));

  const bookTransactionsForClosing = scopedBookTransactions.filter(tx => {
    if (!statementEndDate) return true;
    if (!tx.date) return true;
    return tx.date <= statementEndDate;
  });

  const bookClosingBalance = roundMoney(
    bookTransactionsForClosing.reduce(
      (sum, tx) => (tx.type === 'debit' ? sum + Math.abs(tx.amount) : sum - Math.abs(tx.amount)),
      0,
    ),
  );

  const bankMatchingPool = bankRowsForWindowSeed.filter(row => {
    if (!statementStartDate || !statementEndDate) return true;
    return isWithinDateRange(row.date, statementStartDate, statementEndDate);
  });

  const bookRowsInWindow = bookTransactionsForClosing.filter(tx => {
    if (!statementStartDate || !statementEndDate) return true;
    if (!tx.date) return false;
    return isWithinDateRange(tx.date, statementStartDate, statementEndDate);
  });
  const bookMatchingPool = bookRowsInWindow.filter(tx => !isOpeningBookTransaction(tx));

  const bankOpeningExcludedCount = sortedBankRows.length - bankRowsWithoutOpening.length;
  const bankOutOfWindowCount = bankRowsForWindowSeed.length - bankMatchingPool.length;
  const bookOutOfWindowCount = bookTransactionsForClosing.length - bookRowsInWindow.length;
  const bookOpeningExcludedCount = bookRowsInWindow.length - bookMatchingPool.length;

  const matchedBankIds = new Set<string>();
  const matchedBookIndexes = new Set<number>();
  const matchedItems: ReconciliationMatch[] = [];
  const amountMismatches: ReconciliationMatch[] = [];

  let referenceMatchedCount = 0;
  let exactAmountDateMatchedCount = 0;

  const bookReferenceMatchIndex = new Map<string, number[]>();
  for (let index = 0; index < bookMatchingPool.length; index++) {
    const book = bookMatchingPool[index];
    const reference = normalizeReference(book.reference);
    const direction = getBookDirection(book);
    const amountCents = toAmountCents(Math.abs(book.amount));

    if (!reference || amountCents <= 0) continue;

    const key = buildMatchKey(reference, amountCents, direction);
    const list = bookReferenceMatchIndex.get(key) || [];
    list.push(index);
    bookReferenceMatchIndex.set(key, list);
  }

  const hasExplicitReferenceConflict = (bankRow: BankStatementRow, book: ClassifiedTransaction): boolean => {
    const bankRef = normalizeReference(bankRow.reference);
    const bookRef = normalizeReference(book.reference);
    return bankRef.length > 0 && bookRef.length > 0 && bankRef !== bookRef;
  };

  // Pass 0: explicit reference + amount + cash direction (reference-first).
  for (const bankRow of bankMatchingPool) {
    if (matchedBankIds.has(bankRow.id)) continue;

    const bankDirection = getBankRowDirection(bankRow);
    if (!bankDirection) continue;

    const bankAmount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    const bankAmountCents = toAmountCents(bankAmount);
    const bankReference = normalizeReference(bankRow.reference);
    if (!bankReference || bankAmountCents <= 0) continue;

    const matchKey = buildMatchKey(bankReference, bankAmountCents, bankDirection);
    const candidateIndexes = bookReferenceMatchIndex.get(matchKey) || [];
    if (candidateIndexes.length === 0) continue;

    let selectedIndex = -1;
    let smallestDayDiff = Number.POSITIVE_INFINITY;

    for (const index of candidateIndexes) {
      if (matchedBookIndexes.has(index)) continue;
      const book = bookMatchingPool[index];
      const dayDiff = dateDiffDays(bankRow.date, book.date);
      if (dayDiff > REFERENCE_MATCH_TOLERANCE_DAYS) continue;
      if (dayDiff < smallestDayDiff) {
        smallestDayDiff = dayDiff;
        selectedIndex = index;
      }
    }

    if (selectedIndex < 0) continue;

    matchedBankIds.add(bankRow.id);
    matchedBookIndexes.add(selectedIndex);
    referenceMatchedCount += 1;
    matchedItems.push({
      bankRow,
      bookTransaction: bookMatchingPool[selectedIndex],
      type: 'matched',
      amount: roundMoney(bankAmount),
      variance: 0,
    });
  }

  // Pass 1: fallback when exact reference match is unavailable.
  // Uses amount + direction + +/-2 business days.
  for (const bankRow of bankMatchingPool) {
    if (matchedBankIds.has(bankRow.id)) continue;

    const bankDirection = getBankRowDirection(bankRow);
    if (!bankDirection) continue;

    const bankAmount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    const bankAmountCents = toAmountCents(bankAmount);
    if (bankAmountCents <= 0) continue;

    for (let index = 0; index < bookMatchingPool.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = bookMatchingPool[index];

      if (getBookDirection(book) !== bankDirection) continue;
      if (hasExplicitReferenceConflict(bankRow, book)) continue;

      const bookAmountCents = toAmountCents(Math.abs(book.amount));
      if (Math.abs(bankAmountCents - bookAmountCents) > AMOUNT_EXACT_TOLERANCE_CENTS) continue;
      if (businessDayDiff(bankRow.date, book.date) > DATE_MATCH_TOLERANCE_BUSINESS_DAYS) continue;

      matchedBankIds.add(bankRow.id);
      matchedBookIndexes.add(index);
      exactAmountDateMatchedCount += 1;
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

  // Pass 2: near amount + direction + date window + narrative/reference similarity.
  for (const bankRow of bankMatchingPool) {
    if (matchedBankIds.has(bankRow.id)) continue;

    const bankDirection = getBankRowDirection(bankRow);
    if (!bankDirection) continue;

    const bankAmount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    if (bankAmount <= 0) continue;

    for (let index = 0; index < bookMatchingPool.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = bookMatchingPool[index];

      if (getBookDirection(book) !== bankDirection) continue;
      if (hasExplicitReferenceConflict(bankRow, book)) continue;

      const bookAmount = Math.abs(book.amount);
      if (bookAmount <= 0) continue;

      const percentDiff = Math.abs(bankAmount - bookAmount) / bankAmount;
      if (percentDiff > AMOUNT_NEAR_TOLERANCE_PCT) continue;
      if (dateDiffDays(bankRow.date, book.date) > DATE_NEAR_TOLERANCE_DAYS) continue;

      const bankText = `${bankRow.description || ''} ${bankRow.reference || ''}`.trim();
      const bookText = `${book.description || ''} ${book.reference || ''} ${book.account || ''}`.trim();
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

  const bankOnlyItems: ReconciliationMatch[] = bankMatchingPool
    .filter(row => !matchedBankIds.has(row.id) && (row.debit > 0 || row.credit > 0))
    .map(row => ({
      bankRow: row,
      type: 'bank_only' as BankReconItemType,
      amount: roundMoney(row.debit > 0 ? row.debit : row.credit),
      variance: roundMoney(row.debit > 0 ? row.debit : row.credit),
    }));

  const bookOnlyItems: ReconciliationMatch[] = bookMatchingPool
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

  if (statementStartDate && statementEndDate) {
    notes.push(`Statement window applied: ${statementStartDate} to ${statementEndDate}.`);
  }
  if (bankOpeningExcludedCount > 0) {
    notes.push(
      `${bankOpeningExcludedCount} bank opening-balance row(s) were excluded from transaction matching.`,
    );
  }
  if (bookOpeningExcludedCount > 0) {
    notes.push(
      `${bookOpeningExcludedCount} book opening-balance row(s) were excluded from transaction matching.`,
    );
  }
  if (bookOutOfWindowCount > 0 || bankOutOfWindowCount > 0) {
    notes.push(
      `Out-of-period rows excluded from matching: bank ${Math.max(bankOutOfWindowCount, 0)}, book ${Math.max(bookOutOfWindowCount, 0)}.`,
    );
  }
  if (referenceMatchedCount > 0) {
    notes.push(`${referenceMatchedCount} transaction(s) matched on exact Reference + Amount + Direction.`);
  }
  if (exactAmountDateMatchedCount > 0) {
    notes.push(
      `${exactAmountDateMatchedCount} transaction(s) matched on Amount + Direction + ${DATE_MATCH_TOLERANCE_BUSINESS_DAYS} business-day tolerance.`,
    );
  }
  if (amountMismatches.length > 0) {
    notes.push(
      `${amountMismatches.length} near-match item(s) were flagged as amount mismatches and require manual review.`,
    );
  }
  if (scope.accountsUsed.length === 0) {
    notes.push('No scoped book cash/bank accounts were available; reconciliation confidence is low.');
  }
  if (bookMatchingPool.length === 0) {
    if (scopedBookTransactions.length === 0) {
      notes.push(
        'Book matching pool is empty: no scoped cash/bank transactions were found. Verify book upload and account scope.',
      );
    } else if (bookRowsInWindow.length === 0 && statementStartDate && statementEndDate) {
      notes.push(
        `Book matching pool is empty within statement window (${statementStartDate} to ${statementEndDate}). Check statement period alignment.`,
      );
    } else if (bookOpeningExcludedCount > 0 && bookOpeningExcludedCount === bookRowsInWindow.length) {
      notes.push(
        'Book matching pool is empty because all in-window book rows were classified as opening balances. Review opening labels/flags.',
      );
    } else {
      notes.push(
        'Book matching pool is empty. Ensure Date, Account, Debit/Credit (or Amount+Type), and Reference (JournalRef) are mapped on the book dataset.',
      );
    }
  }

  const bankRefCount = bankMatchingPool.filter(row => normalizeReference(row.reference).length > 0).length;
  const bookRefCount = bookMatchingPool.filter(tx => normalizeReference(tx.reference).length > 0).length;
  const bankReferenceCoveragePct =
    bankMatchingPool.length > 0 ? roundPercent((bankRefCount / bankMatchingPool.length) * 100) : 0;
  const bookReferenceCoveragePct =
    bookMatchingPool.length > 0 ? roundPercent((bookRefCount / bookMatchingPool.length) * 100) : 0;
  if (bankRefCount > 0 && bookRefCount === 0) {
    notes.push('Bank references were detected, but book references are missing. Map JournalRef/Reference for higher match accuracy.');
  }

  if (matchedItems.length === 0 && bankMatchingPool.length > 0 && bookMatchingPool.length > 0) {
    notes.push('No exact matches were found. Verify reference mapping, account scope, and statement period.');
  }
  if (difference >= 1) {
    notes.push(
      `Adjusted balances still differ by ${difference.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`,
    );
  }

  let reliabilityScore = 100;
  if (bankReferenceCoveragePct < 80) reliabilityScore -= 10;
  if (bankReferenceCoveragePct < 60) reliabilityScore -= 15;
  if (bookReferenceCoveragePct < 80) reliabilityScore -= 10;
  if (bookReferenceCoveragePct < 60) reliabilityScore -= 15;
  if (bankOpeningExcludedCount > 0) reliabilityScore -= 5;
  if (bookOpeningExcludedCount > 0) reliabilityScore -= 5;
  if (bankOutOfWindowCount + bookOutOfWindowCount > 0) reliabilityScore -= 10;
  if (matchedItems.length === 0 && bankMatchingPool.length > 0 && bookMatchingPool.length > 0) reliabilityScore -= 25;
  if (referenceMatchedCount === 0 && bankRefCount > 0 && bookRefCount > 0) reliabilityScore -= 10;
  if (amountMismatches.length > 0) reliabilityScore -= Math.min(15, amountMismatches.length * 2);
  if (difference >= 1) reliabilityScore -= 10;
  reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));

  const verdict: 'high' | 'medium' | 'low' =
    reliabilityScore >= 80 ? 'high' : reliabilityScore >= 55 ? 'medium' : 'low';

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
    quality: {
      bankRowsTotal: sortedBankRows.length,
      bankRowsMatchingPool: bankMatchingPool.length,
      bookRowsTotal: scopedBookTransactions.length,
      bookRowsMatchingPool: bookMatchingPool.length,
      bankReferenceCoveragePct,
      bookReferenceCoveragePct,
      bankOpeningExcluded: Math.max(bankOpeningExcludedCount, 0),
      bookOpeningExcluded: Math.max(bookOpeningExcludedCount, 0),
      bankOutOfWindowExcluded: Math.max(bankOutOfWindowCount, 0),
      bookOutOfWindowExcluded: Math.max(bookOutOfWindowCount, 0),
      matchedByReference: referenceMatchedCount,
      matchedByAmountDateFallback: exactAmountDateMatchedCount,
      nearMatchesFlagged: amountMismatches.length,
      reliabilityScore,
      verdict,
    },
    notes,
  };
}
