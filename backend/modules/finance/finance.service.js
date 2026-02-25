const { randomUUID } = require('crypto');
const { ApiError } = require('../common/apiError');

const CATEGORY_VALUES = new Set([
  'revenue',
  'cost_of_goods_sold',
  'operating_expense',
  'other_income',
  'other_expense',
  'tax',
  'current_asset',
  'non_current_asset',
  'current_liability',
  'non_current_liability',
  'equity',
  'operating_cash',
  'investing_cash',
  'financing_cash',
]);

const BANK_ACCOUNT_NAME_REGEX =
  /(cash|bank|checking|cheque|current account|savings|petty cash|cash equivalents?)/i;
const DATE_MATCH_TOLERANCE_BUSINESS_DAYS = 2;
const REFERENCE_MATCH_TOLERANCE_DAYS = 10;
const AMOUNT_EXACT_TOLERANCE_CENTS = 1;
const AMOUNT_NEAR_TOLERANCE_PCT = 0.05;
const DATE_NEAR_TOLERANCE_DAYS = 7;
const NARRATIVE_NEAR_MATCH_MIN_SCORE = 0.2;
const DEFAULT_MAX_ROWS = 50000;
const CREDIT_NORMAL_CATEGORIES = new Set([
  'revenue',
  'other_income',
  'current_liability',
  'non_current_liability',
  'equity',
]);

const trimString = (value) => String(value == null ? '' : value).trim();

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const roundPercent = (value) => Math.round(Number(value || 0) * 10) / 10;
const toAmountCents = (value) => Math.round(Number(value || 0) * 100);

const normalizeHeader = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeReference = (value) =>
  trimString(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');

function parseAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = trimString(value);
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

function toIsoDate(yearRaw, monthRaw, dayRaw) {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function parseDate(value, defaultDate = '') {
  if (value == null || value === '') return defaultDate || '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 10000 && value < 60000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return defaultDate || '';
  }

  const text = trimString(value);
  if (!text) return defaultDate || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(text)) {
    const parts = text.split(/[\/\-.]/);
    return toIsoDate(parts[0], parts[1], parts[2]) || defaultDate || '';
  }
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(text)) {
    const [aRaw, bRaw, cRaw] = text.split(/[\/\-.]/).map((part) => part.trim());
    const a = Number(aRaw);
    const b = Number(bRaw);
    const c = Number(cRaw);
    const year = cRaw.length <= 2 ? 2000 + c : c;
    if (a > 12 && b <= 12) return toIsoDate(year, b, a);
    if (b > 12 && a <= 12) return toIsoDate(year, a, b);
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return defaultDate || '';
}

function normalizeCategory(categoryRaw, accountRaw = '', descriptionRaw = '', sectionRaw = '') {
  const category = normalizeHeader(categoryRaw);
  const account = normalizeHeader(accountRaw);
  const description = normalizeHeader(descriptionRaw);
  const section = normalizeHeader(sectionRaw);
  const signal = `${category} ${account} ${description} ${section}`.trim();

  const directMap = {
    revenue: 'revenue',
    income: 'revenue',
    sales: 'revenue',
    cogs: 'cost_of_goods_sold',
    'cost of goods sold': 'cost_of_goods_sold',
    'operating expense': 'operating_expense',
    opex: 'operating_expense',
    expense: 'operating_expense',
    tax: 'tax',
    'other income': 'other_income',
    'other expense': 'other_expense',
    'current asset': 'current_asset',
    'non current asset': 'non_current_asset',
    'non-current asset': 'non_current_asset',
    'fixed asset': 'non_current_asset',
    'current liability': 'current_liability',
    'non current liability': 'non_current_liability',
    'non-current liability': 'non_current_liability',
    equity: 'equity',
    'operating cash': 'operating_cash',
    'investing cash': 'investing_cash',
    'financing cash': 'financing_cash',
  };

  if (category && directMap[category]) return directMap[category];
  if (CATEGORY_VALUES.has(category)) return category;

  if (/(sales|revenue|income)/.test(signal)) return 'revenue';
  if (/(cogs|cost of goods)/.test(signal)) return 'cost_of_goods_sold';
  if (/(tax|vat|income tax|deferred tax)/.test(signal)) return 'tax';
  if (/(depreciation|salary|wage|rent|utility|marketing|expense|opex)/.test(signal)) return 'operating_expense';
  if (/(cash flow operating|operating cash)/.test(signal)) return 'operating_cash';
  if (/(cash flow investing|investing cash)/.test(signal)) return 'investing_cash';
  if (/(cash flow financing|financing cash)/.test(signal)) return 'financing_cash';
  if (/(asset|inventory|receivable|prepaid|cash|bank|goodwill|equipment|property|intangible|land)/.test(signal)) {
    if (/(equipment|property|goodwill|intangible|land|non current)/.test(signal)) {
      return 'non_current_asset';
    }
    return 'current_asset';
  }
  if (/(liability|payable|accrued|deferred|debt|loan|borrow)/.test(signal)) {
    if (/(long term|non current|mortgage|term loan)/.test(signal)) {
      return 'non_current_liability';
    }
    return 'current_liability';
  }
  if (/(equity|capital|retained earnings|owner)/.test(signal)) return 'equity';
  if (/(expenditure|expense|cost)/.test(signal)) return 'operating_expense';

  return 'operating_expense';
}

function inferTypeFromSignal(typeRaw, amountRaw) {
  const text = normalizeHeader(typeRaw);
  if (/(^|\s)(dr|debit|withdraw|payment|charge|expense|outflow)(\s|$)/.test(text)) return 'debit';
  if (/(^|\s)(cr|credit|deposit|receipt|income|inflow)(\s|$)/.test(text)) return 'credit';

  const amount = parseAmount(amountRaw);
  if (amount == null) return null;
  if (amount < 0) return 'credit';
  if (amount > 0) return 'debit';
  return null;
}

function detectBookMapping(headers) {
  const mapping = {};
  for (const original of headers) {
    const header = normalizeHeader(original);
    if (!mapping.date && /(date|transaction date|posting date|entry date|value date)/.test(header)) {
      mapping.date = original;
    }
    if (!mapping.account && /(account|account name|ledger|gl account)/.test(header)) {
      mapping.account = original;
    }
    if (!mapping.category && /(category|class|bucket)/.test(header)) {
      mapping.category = original;
    }
    if (!mapping.section && /(section|statement section)/.test(header)) {
      mapping.section = original;
    }
    if (!mapping.debit && /(^|\s)(debit|dr|money in|inflow)(\s|$)/.test(header)) {
      mapping.debit = original;
    }
    if (!mapping.credit && /(^|\s)(credit|cr|money out|outflow)(\s|$)/.test(header)) {
      mapping.credit = original;
    }
    if (!mapping.amount && /(amount|net amount|value|fy\d{2,4}\s*amount|signed amount)/.test(header)) {
      mapping.amount = original;
    }
    if (!mapping.type && /(type|debit credit|dr cr|direction)/.test(header)) {
      mapping.type = original;
    }
    if (!mapping.description && /(description|details|memo|narration|notes|particulars)/.test(header)) {
      mapping.description = original;
    }
    if (!mapping.reference && /(reference|journal ref|ref no|voucher|document|transaction id|trace|utr|check|cheque)/.test(header)) {
      mapping.reference = original;
    }
  }
  return mapping;
}

function detectBankMapping(headers) {
  const mapping = {};
  let bestBalance = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const original of headers) {
    const header = normalizeHeader(original);
    if (!mapping.date && /(date|txn date|transaction date|value date|posting date|entry date)/.test(header)) {
      mapping.date = original;
    }
    if (!mapping.reference && /(reference|journal ref|ref no|voucher|document|transaction id|trace|utr|cheque|check)/.test(header)) {
      mapping.reference = original;
    }
    if (!mapping.description && /(description|narration|details|memo|remarks|particulars|narrative)/.test(header)) {
      mapping.description = original;
    }
    if (!mapping.debit && /(^|\s)(debit|withdrawal|payment|money out|dr|charge|fee)(\s|$)/.test(header)) {
      mapping.debit = original;
    }
    if (!mapping.credit && /(^|\s)(credit|deposit|receipt|money in|cr|income|interest)(\s|$)/.test(header)) {
      mapping.credit = original;
    }
    if (!mapping.amount && /(amount|net amount|transaction amount|signed amount)/.test(header)) {
      mapping.amount = original;
    }
    if (!mapping.type && /(transaction type|txn type|entry type|dr cr|debit credit|direction|money in out|in out)/.test(header)) {
      mapping.type = original;
    }

    if (/(balance|running balance|closing balance|available balance|ledger balance|ending balance|final balance)/.test(header)) {
      let score = 0;
      if (/\bbalance\b/.test(header)) score += 5;
      if (/(running|closing|ending|final|ledger|available|current)/.test(header)) score += 30;
      if (/(opening|beginning|start|brought forward|\bb f\b)/.test(header)) score -= 20;
      if (score > bestScore) {
        bestScore = score;
        bestBalance = original;
      }
    }
  }

  if (bestBalance) mapping.balance = bestBalance;
  return mapping;
}

function enforceRowsLimit(rows, label) {
  const maxRowsRaw = Number.parseInt(process.env.FINANCE_JOB_MAX_ROWS || '', 10) || DEFAULT_MAX_ROWS;
  const maxRows = Math.max(1000, maxRowsRaw);
  if (rows.length > maxRows) {
    throw ApiError.payloadTooLarge(
      `${label} row count exceeds configured limit`,
      { received: rows.length, maxRows },
      'FINANCE_ROWS_LIMIT_EXCEEDED'
    );
  }
}

function normalizeBookTransaction(entry, index) {
  const date = parseDate(entry.date || entry.Date);
  const account = trimString(entry.account || entry.Account);
  const description = trimString(entry.description || entry.Description);
  const category = normalizeCategory(
    entry.category || entry.Category,
    account,
    description,
    entry.section || entry.Section
  );
  const rawType = trimString(entry.type || entry.Type).toLowerCase();
  const type = rawType === 'credit' ? 'credit' : 'debit';
  const amount = Math.abs(Number(entry.amount != null ? entry.amount : entry.Amount) || 0);
  const reference = normalizeReference(entry.reference || entry.Reference);

  if (!date || !account || !amount) return null;

  return {
    date,
    account,
    category,
    amount,
    description: description || undefined,
    reference: reference || undefined,
    type,
    originalRow: Number(entry.originalRow || entry.SourceRow || index + 2),
  };
}

function parseBookRows({ rows, mapping = {}, options = {} }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw ApiError.badRequest('Book rows are required', null, 'BOOK_ROWS_REQUIRED');
  }
  enforceRowsLimit(rows, 'Book');

  const headers = Object.keys(rows[0] || {});
  const auto = detectBookMapping(headers);
  const m = { ...auto, ...(mapping || {}) };
  const defaultDate = parseDate(options.defaultDate || '') || new Date().toISOString().slice(0, 10);

  const transactions = [];
  const warnings = [];
  let droppedDate = 0;
  let droppedAmount = 0;
  let droppedAccount = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] || {};
    const date = parseDate(m.date ? row[m.date] : row.date, defaultDate);
    if (!date) {
      droppedDate += 1;
      continue;
    }

    const account = trimString(m.account ? row[m.account] : row.account || row.Account);
    if (!account) {
      droppedAccount += 1;
      continue;
    }

    const description = trimString(m.description ? row[m.description] : row.description || row.Description);
    const reference = normalizeReference(m.reference ? row[m.reference] : row.reference || row.Reference);

    const rawDebit = m.debit ? parseAmount(row[m.debit]) : null;
    const rawCredit = m.credit ? parseAmount(row[m.credit]) : null;
    const rawAmount = m.amount ? parseAmount(row[m.amount]) : parseAmount(row.amount || row.Amount);
    const rawType = m.type ? row[m.type] : row.type || row.Type;

    let type = null;
    let amount = 0;

    if (rawDebit != null && Math.abs(rawDebit) > 0 && (!rawCredit || Math.abs(rawCredit) <= 0)) {
      type = 'debit';
      amount = Math.abs(rawDebit);
    } else if (rawCredit != null && Math.abs(rawCredit) > 0 && (!rawDebit || Math.abs(rawDebit) <= 0)) {
      type = 'credit';
      amount = Math.abs(rawCredit);
    } else if (rawAmount != null && Math.abs(rawAmount) > 0) {
      const inferredType = inferTypeFromSignal(rawType, rawAmount) || (rawAmount < 0 ? 'credit' : 'debit');
      type = inferredType;
      amount = Math.abs(rawAmount);
    }

    if (!type || amount <= 0) {
      droppedAmount += 1;
      continue;
    }

    const category = normalizeCategory(
      m.category ? row[m.category] : row.category || row.Category,
      account,
      description,
      m.section ? row[m.section] : row.section || row.Section
    );

    transactions.push({
      date,
      account,
      category,
      amount: roundMoney(amount),
      description: description || undefined,
      reference: reference || undefined,
      type,
      originalRow: index + 2,
    });
  }

  if (droppedDate > 0) warnings.push(`${droppedDate} row(s) were dropped due to invalid date values.`);
  if (droppedAmount > 0) warnings.push(`${droppedAmount} row(s) were dropped due to missing debit/credit/amount.`);
  if (droppedAccount > 0) warnings.push(`${droppedAccount} row(s) were dropped due to missing account name.`);
  if (transactions.length === 0) {
    warnings.push('No valid book transactions parsed. Review mapping and source data.');
  }

  const referenceCount = transactions.filter((tx) => normalizeReference(tx.reference).length > 0).length;
  const categoryCount = transactions.filter((tx) => CATEGORY_VALUES.has(tx.category)).length;
  return {
    transactions,
    warnings,
    mappingUsed: m,
    stats: {
      sourceRows: rows.length,
      parsedRows: transactions.length,
      droppedRows: rows.length - transactions.length,
      referenceCoveragePct: transactions.length ? roundPercent((referenceCount / transactions.length) * 100) : 0,
      categoryCoveragePct: transactions.length ? roundPercent((categoryCount / transactions.length) * 100) : 0,
    },
  };
}

function isOpeningBalanceText(value) {
  const text = normalizeHeader(value);
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

function parseBankRows({ rows, mapping = {}, options = {} }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw ApiError.badRequest('Bank rows are required', null, 'BANK_ROWS_REQUIRED');
  }
  enforceRowsLimit(rows, 'Bank');

  const headers = Object.keys(rows[0] || {});
  const auto = detectBankMapping(headers);
  const m = { ...auto, ...(mapping || {}) };
  if (!m.date) {
    throw ApiError.badRequest('Bank date column is required', null, 'BANK_DATE_MAPPING_REQUIRED');
  }

  const dateFallback = parseDate(options.defaultDate || '') || '';
  const bankRows = [];
  const warnings = [];
  let droppedDate = 0;
  let droppedAmount = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] || {};
    const date = parseDate(row[m.date], dateFallback);
    if (!date) {
      droppedDate += 1;
      continue;
    }

    const description = trimString(m.description ? row[m.description] : row.description || row.Description);
    const reference = normalizeReference(m.reference ? row[m.reference] : row.reference || row.Reference);

    let debit = m.debit ? Math.abs(parseAmount(row[m.debit]) || 0) : 0;
    let credit = m.credit ? Math.abs(parseAmount(row[m.credit]) || 0) : 0;
    const rawAmount = m.amount ? parseAmount(row[m.amount]) : parseAmount(row.amount || row.Amount);
    const typeSignal = m.type ? row[m.type] : row.type || row.Type;

    if (debit <= 0 && credit <= 0 && rawAmount != null && Math.abs(rawAmount) > 0) {
      const inferredType = inferTypeFromSignal(typeSignal, rawAmount);
      if (inferredType === 'credit') {
        credit = Math.abs(rawAmount);
      } else if (inferredType === 'debit') {
        debit = Math.abs(rawAmount);
      } else if (rawAmount > 0) {
        credit = rawAmount;
      } else {
        debit = Math.abs(rawAmount);
      }
    }

    if (debit <= 0 && credit <= 0) {
      droppedAmount += 1;
      continue;
    }

    const balance = m.balance ? parseAmount(row[m.balance]) : parseAmount(row.balance || row.Balance);
    bankRows.push({
      id: randomUUID(),
      date,
      description,
      reference: reference || undefined,
      debit: roundMoney(debit),
      credit: roundMoney(credit),
      balance: balance == null ? undefined : roundMoney(balance),
      isOpeningBalance: isOpeningBalanceText(`${description} ${reference}`),
      rawRow: index + 2,
    });
  }

  if (droppedDate > 0) warnings.push(`${droppedDate} row(s) were dropped due to invalid date values.`);
  if (droppedAmount > 0) warnings.push(`${droppedAmount} row(s) were dropped due to zero debit/credit amounts.`);
  if (bankRows.length === 0) warnings.push('No valid bank rows parsed. Review bank mapping.');

  const referenceCount = bankRows.filter((row) => normalizeReference(row.reference).length > 0).length;
  return {
    rows: bankRows,
    warnings,
    mappingUsed: m,
    stats: {
      sourceRows: rows.length,
      parsedRows: bankRows.length,
      droppedRows: rows.length - bankRows.length,
      referenceCoveragePct: bankRows.length ? roundPercent((referenceCount / bankRows.length) * 100) : 0,
    },
  };
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw)));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function dateDiffDays(left, right) {
  const l = Date.parse(left || '');
  const r = Date.parse(right || '');
  if (Number.isNaN(l) || Number.isNaN(r)) return Number.POSITIVE_INFINITY;
  return Math.abs(l - r) / (1000 * 60 * 60 * 24);
}

function businessDayDiff(left, right) {
  const l = parseIsoDate(left);
  const r = parseIsoDate(right);
  if (!l || !r) return Number.POSITIVE_INFINITY;
  let start = l;
  let end = r;
  if (start.getTime() > end.getTime()) {
    start = r;
    end = l;
  }
  let cursor = new Date(start.getTime());
  let businessDays = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) businessDays += 1;
  }
  return businessDays;
}

function tokenizeNarrative(value) {
  const stopWords = new Set(['the', 'and', 'for', 'from', 'to', 'with', 'bank', 'payment', 'deposit']);
  return normalizeHeader(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function narrativeSimilarity(left, right) {
  const leftTokens = new Set(tokenizeNarrative(left));
  const rightTokens = new Set(tokenizeNarrative(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (!union) return 0;
  return overlap / union;
}

function hasReferenceOverlap(left, right) {
  const extract = (value) => {
    const tokens = String(value || '').toUpperCase().match(/\b[A-Z0-9-]{4,}\b/g) || [];
    return new Set(
      tokens
        .map((token) => normalizeReference(token))
        .filter((token) => token.length >= 4 && /\d/.test(token))
    );
  };

  const leftSet = extract(left);
  const rightSet = extract(right);
  if (leftSet.size === 0 || rightSet.size === 0) return false;
  for (const token of leftSet) {
    if (rightSet.has(token)) return true;
  }
  return false;
}

function getBankDirection(row) {
  if (row.credit > 0 && row.debit <= 0) return 'in';
  if (row.debit > 0 && row.credit <= 0) return 'out';
  if (row.credit > 0 && row.debit > 0) return row.credit >= row.debit ? 'in' : 'out';
  return null;
}

function getBookDirection(tx) {
  return tx.type === 'debit' ? 'in' : 'out';
}

function buildMatchKey(reference, amountCents, direction) {
  return `${reference}|${amountCents}|${direction}`;
}

function isWithinDateRange(date, startDate, endDate) {
  if (!date || !startDate || !endDate) return false;
  return date >= startDate && date <= endDate;
}

function inferBookScope(transactions, requestedScope) {
  const notes = [];
  if (requestedScope && requestedScope !== 'auto') {
    const scoped = transactions.filter(
      (tx) => normalizeHeader(tx.account) === normalizeHeader(requestedScope)
    );
    return {
      scoped,
      accountsUsed: [...new Set(scoped.map((tx) => tx.account))],
      notes: scoped.length
        ? notes
        : [`Selected account "${requestedScope}" has no transactions in current dataset.`],
    };
  }

  const direct = transactions.filter((tx) => BANK_ACCOUNT_NAME_REGEX.test(tx.account || ''));
  if (direct.length > 0) {
    const accountsUsed = [...new Set(direct.map((tx) => tx.account))].sort((a, b) => a.localeCompare(b));
    notes.push(`Auto scope selected ${accountsUsed.length} cash/bank-like account(s).`);
    return { scoped: direct, accountsUsed, notes };
  }

  const fallback = transactions.filter(
    (tx) =>
      tx.category === 'operating_cash' ||
      (tx.category === 'current_asset' && /(cash|bank)/i.test(tx.account || tx.description || ''))
  );
  if (fallback.length > 0) {
    const accountsUsed = [...new Set(fallback.map((tx) => tx.account))].sort((a, b) => a.localeCompare(b));
    notes.push('Auto scope fallback: using operating cash signals because no explicit bank account names were detected.');
    return { scoped: fallback, accountsUsed, notes };
  }

  notes.push('No book cash/bank transactions were detected for reconciliation scope.');
  return { scoped: [], accountsUsed: [], notes };
}

function reconcileBankAndBook({ bankRows, bookTransactions, options = {} }) {
  const scope = inferBookScope(bookTransactions, options.bookAccountScope || 'auto');
  const notes = [...scope.notes];
  const sortedBankRows = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));
  const bankRowsWithoutOpening = sortedBankRows.filter((row) => !row.isOpeningBalance);
  const seedRows = bankRowsWithoutOpening.length > 0 ? bankRowsWithoutOpening : sortedBankRows;

  let statementStartDate =
    options.statementStartDate || (seedRows.length > 0 ? seedRows[0].date : '');
  let statementEndDate =
    options.statementEndDate || (seedRows.length > 0 ? seedRows[seedRows.length - 1].date : '');
  if (statementStartDate && statementEndDate && statementStartDate > statementEndDate) {
    const tmp = statementStartDate;
    statementStartDate = statementEndDate;
    statementEndDate = tmp;
  }

  const statementDate =
    options.statementDate ||
    statementEndDate ||
    (sortedBankRows.length
      ? sortedBankRows[sortedBankRows.length - 1].date
      : new Date().toISOString().slice(0, 10));

  const bankMatchingPool = seedRows.filter((row) => {
    if (!statementStartDate || !statementEndDate) return true;
    return isWithinDateRange(row.date, statementStartDate, statementEndDate);
  });

  const bookRowsUpToEnd = scope.scoped.filter((tx) => {
    if (!statementEndDate) return true;
    return tx.date <= statementEndDate;
  });
  const bookRowsInWindow = bookRowsUpToEnd.filter((tx) => {
    if (!statementStartDate || !statementEndDate) return true;
    return isWithinDateRange(tx.date, statementStartDate, statementEndDate);
  });
  const bookMatchingPool = bookRowsInWindow.filter(
    (tx) => !isOpeningBalanceText(`${tx.account} ${tx.description || ''} ${tx.reference || ''}`)
  );

  const matchedBankIds = new Set();
  const matchedBookIndexes = new Set();
  const matchedItems = [];
  const amountMismatches = [];
  let referenceMatchedCount = 0;
  let amountDateMatchedCount = 0;

  const referenceIndex = new Map();
  for (let index = 0; index < bookMatchingPool.length; index++) {
    const book = bookMatchingPool[index];
    const reference = normalizeReference(book.reference);
    const amountCents = toAmountCents(Math.abs(book.amount));
    const direction = getBookDirection(book);
    if (!reference || amountCents <= 0) continue;

    const key = buildMatchKey(reference, amountCents, direction);
    const list = referenceIndex.get(key) || [];
    list.push(index);
    referenceIndex.set(key, list);
  }

  for (const bankRow of bankMatchingPool) {
    const direction = getBankDirection(bankRow);
    const amount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    const amountCents = toAmountCents(amount);
    const reference = normalizeReference(bankRow.reference);
    if (!direction || !reference || amountCents <= 0) continue;

    const key = buildMatchKey(reference, amountCents, direction);
    const candidates = referenceIndex.get(key) || [];
    let selectedIndex = -1;
    let bestDayDiff = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
      if (matchedBookIndexes.has(index)) continue;
      const dayDiff = dateDiffDays(bankRow.date, bookMatchingPool[index].date);
      if (dayDiff > REFERENCE_MATCH_TOLERANCE_DAYS) continue;
      if (dayDiff < bestDayDiff) {
        bestDayDiff = dayDiff;
        selectedIndex = index;
      }
    }
    if (selectedIndex < 0) continue;

    matchedBankIds.add(bankRow.id);
    matchedBookIndexes.add(selectedIndex);
    referenceMatchedCount += 1;
    matchedItems.push({
      type: 'matched',
      bankRow,
      bookTransaction: bookMatchingPool[selectedIndex],
      amount: roundMoney(amount),
      variance: 0,
    });
  }

  const hasExplicitReferenceConflict = (bankRow, book) => {
    const bankRef = normalizeReference(bankRow.reference);
    const bookRef = normalizeReference(book.reference);
    return bankRef && bookRef && bankRef !== bookRef;
  };

  for (const bankRow of bankMatchingPool) {
    if (matchedBankIds.has(bankRow.id)) continue;
    const direction = getBankDirection(bankRow);
    const amount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    if (!direction || amount <= 0) continue;

    const amountCents = toAmountCents(amount);
    for (let index = 0; index < bookMatchingPool.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = bookMatchingPool[index];
      if (getBookDirection(book) !== direction) continue;
      if (hasExplicitReferenceConflict(bankRow, book)) continue;

      const bookAmountCents = toAmountCents(Math.abs(book.amount));
      if (Math.abs(bookAmountCents - amountCents) > AMOUNT_EXACT_TOLERANCE_CENTS) continue;
      if (businessDayDiff(bankRow.date, book.date) > DATE_MATCH_TOLERANCE_BUSINESS_DAYS) continue;

      matchedBankIds.add(bankRow.id);
      matchedBookIndexes.add(index);
      amountDateMatchedCount += 1;
      matchedItems.push({
        type: 'matched',
        bankRow,
        bookTransaction: book,
        amount: roundMoney(amount),
        variance: 0,
      });
      break;
    }
  }

  for (const bankRow of bankMatchingPool) {
    if (matchedBankIds.has(bankRow.id)) continue;
    const direction = getBankDirection(bankRow);
    const amount = bankRow.credit > 0 ? bankRow.credit : bankRow.debit;
    if (!direction || amount <= 0) continue;

    for (let index = 0; index < bookMatchingPool.length; index++) {
      if (matchedBookIndexes.has(index)) continue;
      const book = bookMatchingPool[index];
      if (getBookDirection(book) !== direction) continue;
      if (hasExplicitReferenceConflict(bankRow, book)) continue;

      const bookAmount = Math.abs(book.amount);
      const diffPct = amount ? Math.abs(amount - bookAmount) / amount : 1;
      if (diffPct > AMOUNT_NEAR_TOLERANCE_PCT) continue;
      if (dateDiffDays(bankRow.date, book.date) > DATE_NEAR_TOLERANCE_DAYS) continue;

      const bankText = `${bankRow.description || ''} ${bankRow.reference || ''}`.trim();
      const bookText = `${book.description || ''} ${book.reference || ''} ${book.account || ''}`.trim();
      const similar =
        narrativeSimilarity(bankText, bookText) >= NARRATIVE_NEAR_MATCH_MIN_SCORE ||
        hasReferenceOverlap(bankText, bookText) ||
        bankText === '' ||
        bookText === '';
      if (!similar) continue;

      matchedBankIds.add(bankRow.id);
      matchedBookIndexes.add(index);
      amountMismatches.push({
        type: 'amount_mismatch',
        bankRow,
        bookTransaction: book,
        amount: roundMoney(amount),
        variance: roundMoney(Math.abs(amount - bookAmount)),
      });
      break;
    }
  }

  const bankOnlyItems = bankMatchingPool
    .filter((row) => !matchedBankIds.has(row.id))
    .map((bankRow) => ({
      type: 'bank_only',
      bankRow,
      amount: roundMoney(bankRow.debit > 0 ? bankRow.debit : bankRow.credit),
      variance: roundMoney(bankRow.debit > 0 ? bankRow.debit : bankRow.credit),
    }));
  const bookOnlyItems = bookMatchingPool
    .filter((_, index) => !matchedBookIndexes.has(index))
    .map((bookTransaction) => ({
      type: 'book_only',
      bookTransaction,
      amount: roundMoney(Math.abs(bookTransaction.amount)),
      variance: roundMoney(Math.abs(bookTransaction.amount)),
    }));

  const depositsInTransit = bookOnlyItems.filter((item) => item.bookTransaction.type === 'debit');
  const outstandingCheques = bookOnlyItems.filter((item) => item.bookTransaction.type === 'credit');
  const bankChargesUnrecorded = bankOnlyItems.filter((item) => (item.bankRow.debit || 0) > 0);
  const bankCreditsUnrecorded = bankOnlyItems.filter((item) => (item.bankRow.credit || 0) > 0);

  const depositsInTransitTotal = roundMoney(depositsInTransit.reduce((sum, item) => sum + item.amount, 0));
  const outstandingChequesTotal = roundMoney(outstandingCheques.reduce((sum, item) => sum + item.amount, 0));
  const bankChargesTotal = roundMoney(bankChargesUnrecorded.reduce((sum, item) => sum + item.amount, 0));
  const bankCreditsTotal = roundMoney(bankCreditsUnrecorded.reduce((sum, item) => sum + item.amount, 0));

  const lastWithBalance = [...sortedBankRows]
    .filter((row) => (!statementEndDate ? true : row.date <= statementEndDate))
    .reverse()
    .find((row) => row.balance != null);
  const bankClosingBalance =
    lastWithBalance?.balance ??
    roundMoney(
      sortedBankRows
        .filter((row) => !row.isOpeningBalance && (!statementEndDate || row.date <= statementEndDate))
        .reduce((sum, row) => sum + (row.credit > 0 ? row.credit : -row.debit), 0)
    );
  const bookClosingBalance = roundMoney(
    bookRowsUpToEnd.reduce(
      (sum, tx) => sum + (tx.type === 'debit' ? Math.abs(tx.amount) : -Math.abs(tx.amount)),
      0
    )
  );

  const adjustedBankBalance = roundMoney(bankClosingBalance + depositsInTransitTotal - outstandingChequesTotal);
  const adjustedBookBalance = roundMoney(bookClosingBalance + bankCreditsTotal - bankChargesTotal);
  const difference = roundMoney(Math.abs(adjustedBankBalance - adjustedBookBalance));

  const bankRefCount = bankMatchingPool.filter((row) => normalizeReference(row.reference).length > 0).length;
  const bookRefCount = bookMatchingPool.filter((row) => normalizeReference(row.reference).length > 0).length;
  const bankReferenceCoveragePct =
    bankMatchingPool.length > 0 ? roundPercent((bankRefCount / bankMatchingPool.length) * 100) : 0;
  const bookReferenceCoveragePct =
    bookMatchingPool.length > 0 ? roundPercent((bookRefCount / bookMatchingPool.length) * 100) : 0;

  let reliabilityScore = 100;
  if (bankReferenceCoveragePct < 80) reliabilityScore -= 10;
  if (bookReferenceCoveragePct < 80) reliabilityScore -= 10;
  if (matchedItems.length === 0 && bankMatchingPool.length && bookMatchingPool.length) reliabilityScore -= 25;
  if (difference >= 1) reliabilityScore -= 10;
  reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));

  const verdict = reliabilityScore >= 80 ? 'high' : reliabilityScore >= 55 ? 'medium' : 'low';
  if (statementStartDate && statementEndDate) {
    notes.push(`Statement window applied: ${statementStartDate} to ${statementEndDate}.`);
  }
  if (referenceMatchedCount > 0) {
    notes.push(`${referenceMatchedCount} transaction(s) matched on exact Reference + Amount + Direction.`);
  }
  if (amountDateMatchedCount > 0) {
    notes.push(
      `${amountDateMatchedCount} transaction(s) matched on Amount + Direction + ${DATE_MATCH_TOLERANCE_BUSINESS_DAYS} business-day tolerance.`
    );
  }
  if (scope.accountsUsed.length === 0) {
    notes.push('No scoped book cash/bank accounts were available; reconciliation confidence is low.');
  }
  if (bookMatchingPool.length === 0) {
    notes.push('Book matching pool is empty: verify GL upload, account scope, and Date/Debit/Credit mappings.');
  }
  if (difference >= 1) {
    notes.push(
      `Adjusted balances still differ by ${difference.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`
    );
  }

  return {
    statementDate,
    statementWindow:
      statementStartDate && statementEndDate ? { startDate: statementStartDate, endDate: statementEndDate } : null,
    bankClosingBalance: roundMoney(bankClosingBalance),
    bookClosingBalance: roundMoney(bookClosingBalance),
    bookAccountScope: options.bookAccountScope || 'auto',
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
      bookRowsTotal: scope.scoped.length,
      bookRowsMatchingPool: bookMatchingPool.length,
      bankReferenceCoveragePct,
      bookReferenceCoveragePct,
      matchedByReference: referenceMatchedCount,
      matchedByAmountDateFallback: amountDateMatchedCount,
      nearMatchesFlagged: amountMismatches.length,
      reliabilityScore,
      verdict,
    },
    notes,
  };
}

function categoryImpact(tx) {
  const absAmount = Math.abs(Number(tx.amount || 0));
  const entryImpact = tx.type === 'debit' ? absAmount : -absAmount;
  if (CREDIT_NORMAL_CATEGORIES.has(tx.category)) {
    return -entryImpact;
  }
  return entryImpact;
}

function generateFinancialSummary({ transactions, companyName = 'Imported Company', reportPeriod = 'custom' }) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw ApiError.badRequest('Transactions are required to generate financial summary', null, 'TRANSACTIONS_REQUIRED');
  }

  const totals = {
    revenue: 0,
    cost_of_goods_sold: 0,
    operating_expense: 0,
    other_income: 0,
    other_expense: 0,
    tax: 0,
    current_asset: 0,
    non_current_asset: 0,
    current_liability: 0,
    non_current_liability: 0,
    equity: 0,
    operating_cash: 0,
    investing_cash: 0,
    financing_cash: 0,
  };

  const dateValues = [];
  for (const tx of transactions) {
    if (!CATEGORY_VALUES.has(tx.category)) continue;
    totals[tx.category] += categoryImpact(tx);
    if (tx.date) dateValues.push(tx.date);
  }

  const totalRevenue = roundMoney(totals.revenue + totals.other_income);
  const totalExpenses = roundMoney(
    totals.cost_of_goods_sold + totals.operating_expense + totals.other_expense + totals.tax
  );
  const netIncome = roundMoney(totalRevenue - totalExpenses);
  const totalAssets = roundMoney(totals.current_asset + totals.non_current_asset);
  const totalLiabilities = roundMoney(totals.current_liability + totals.non_current_liability);
  const totalEquity = roundMoney(totals.equity);
  const balanceSheetDifference = roundMoney(totalAssets - (totalLiabilities + totalEquity));

  const operatingCash = roundMoney(totals.operating_cash);
  const investingCash = roundMoney(totals.investing_cash);
  const financingCash = roundMoney(totals.financing_cash);
  const netCashChange = roundMoney(operatingCash + investingCash + financingCash);

  const warnings = [];
  if (Math.abs(balanceSheetDifference) >= 1) {
    warnings.push(
      `Balance sheet is not balanced. Difference: ${balanceSheetDifference.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`
    );
  }
  if (operatingCash === 0 && investingCash === 0 && financingCash === 0) {
    warnings.push('Cash flow categories are missing or zero; operating/investing/financing cash totals may be incomplete.');
  }

  const sortedDates = [...new Set(dateValues)].sort((a, b) => a.localeCompare(b));
  const periodStart = sortedDates[0] || null;
  const periodEnd = sortedDates[sortedDates.length - 1] || null;

  return {
    companyName,
    reportPeriod,
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    pnl: {
      revenue: roundMoney(totals.revenue),
      otherIncome: roundMoney(totals.other_income),
      totalRevenue,
      costOfGoodsSold: roundMoney(totals.cost_of_goods_sold),
      operatingExpenses: roundMoney(totals.operating_expense),
      otherExpenses: roundMoney(totals.other_expense),
      tax: roundMoney(totals.tax),
      totalExpenses,
      netIncome,
      netMarginPct: totalRevenue ? roundPercent((netIncome / totalRevenue) * 100) : 0,
    },
    balanceSheet: {
      currentAssets: roundMoney(totals.current_asset),
      nonCurrentAssets: roundMoney(totals.non_current_asset),
      totalAssets,
      currentLiabilities: roundMoney(totals.current_liability),
      nonCurrentLiabilities: roundMoney(totals.non_current_liability),
      totalLiabilities,
      equity: totalEquity,
      liabilitiesAndEquity: roundMoney(totalLiabilities + totalEquity),
      difference: balanceSheetDifference,
      isBalanced: Math.abs(balanceSheetDifference) < 1,
    },
    cashFlow: {
      operatingCash,
      investingCash,
      financingCash,
      netCashChange,
    },
    warnings,
  };
}

function ingestBookData(input) {
  const parsed = parseBookRows(input);
  return {
    ...parsed,
    caveats: [
      'Category inference is heuristic when category column is missing.',
      'Rows without parseable date/account/amount are excluded from downstream reporting.',
    ],
  };
}

function reconcileData(input) {
  const bankPayload = input.bankRows
    ? { rows: input.bankRows, mapping: input.bankMapping, options: input.options || {} }
    : null;
  const bookPayload = input.bookRows
    ? { rows: input.bookRows, mapping: input.bookMapping, options: input.options || {} }
    : null;
  const preNormalizedBook = Array.isArray(input.bookTransactions)
    ? input.bookTransactions.map(normalizeBookTransaction).filter(Boolean)
    : [];

  const parsedBank = input.parsedBankRows
    ? { rows: input.parsedBankRows, warnings: [], stats: {} }
    : parseBankRows(bankPayload || {});
  let parsedBook;
  if (preNormalizedBook.length > 0) {
    parsedBook = {
      transactions: preNormalizedBook,
      warnings: [],
      stats: {
        sourceRows: preNormalizedBook.length,
        parsedRows: preNormalizedBook.length,
        droppedRows: 0,
        referenceCoveragePct: roundPercent(
          (preNormalizedBook.filter((tx) => normalizeReference(tx.reference).length > 0).length /
            preNormalizedBook.length) *
            100
        ),
        categoryCoveragePct: 100,
      },
    };
  } else {
    parsedBook = parseBookRows(bookPayload || {});
  }

  const reconciliation = reconcileBankAndBook({
    bankRows: parsedBank.rows,
    bookTransactions: parsedBook.transactions,
    options: input.options || {},
  });

  return {
    reconciliation,
    bankParsing: {
      warnings: parsedBank.warnings || [],
      stats: parsedBank.stats || {},
    },
    bookParsing: {
      warnings: parsedBook.warnings || [],
      stats: parsedBook.stats || {},
    },
    caveats: [
      'Matching priority: Reference+Amount+Direction, then Amount+Direction with ±2 business days, then near-match review.',
      'Opening balance rows are excluded from matching and used only for statement context.',
      'Always verify low-quality reconciliations before publishing financial decisions.',
    ],
  };
}

function generateReportFromInput(input) {
  let transactions = [];
  if (Array.isArray(input.transactions) && input.transactions.length > 0) {
    transactions = input.transactions.map(normalizeBookTransaction).filter(Boolean);
  } else if (Array.isArray(input.rows) && input.rows.length > 0) {
    const parsed = parseBookRows({
      rows: input.rows,
      mapping: input.mapping || {},
      options: input.options || {},
    });
    transactions = parsed.transactions;
  }

  if (transactions.length === 0) {
    throw ApiError.badRequest('No valid transactions available for report generation', null, 'NO_TRANSACTIONS');
  }

  const summary = generateFinancialSummary({
    transactions,
    companyName: trimString(input.companyName) || 'Imported Company',
    reportPeriod: trimString(input.reportPeriod) || 'custom',
  });

  return {
    summary,
    transactionCount: transactions.length,
    caveats: [
      'Report output is generated from parsed transaction-level data and should be reviewed for mapping correctness.',
      'For audited statements, confirm account classifications and manual adjustments externally.',
    ],
  };
}

module.exports = {
  CATEGORY_VALUES,
  detectBookMapping,
  detectBankMapping,
  parseBookRows,
  parseBankRows,
  ingestBookData,
  reconcileData,
  generateReportFromInput,
};
