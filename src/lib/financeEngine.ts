// Finance Engine — Core accounting logic for statement generation
// Classifies transactions, generates P&L, Balance Sheet, Cash Flow, and ratios

import { ColumnInfo } from './types';
import {
  AccountCategory,
  ClassifiedTransaction,
  ClosingDetectionDiagnostics,
  FinanceColumnMapping,
  LineItem,
  NetIncomeAutoMediumSignalDefault,
  NetIncomeToEquityMode,
  OpeningBalanceDiagnostics,
  ProfitAndLoss,
  BalanceSheet,
  CashFlowStatement,
  FinancialRatios,
  RatioInterpretation,
  FinancialReport,
  FinanceChartData,
  ReconciliationDiagnostics,
  ReportPeriod,
} from './financeTypes';
import { SHARED_CHART_PALETTE, POSITIVE_CHART_COLOR, NEGATIVE_CHART_COLOR } from './chartColors';

// ============================================================
// 1. SMART COLUMN DETECTION
// ============================================================

const COLUMN_PATTERNS: Record<keyof FinanceColumnMapping, RegExp[]> = {
  date: [/date/i, /period/i, /month/i, /posting.?date/i, /trans.?date/i, /invoice.?date/i],
  account: [/account/i, /ledger/i, /gl.?account/i, /chart.?of.?accounts/i, /account.?name/i, /line.?item/i],
  category: [/category/i, /classification/i, /group/i, /class/i, /account.?type/i],
  amount: [/amount/i, /value/i, /total/i, /balance/i, /sum/i],
  debit: [/debit/i, /dr/i],
  credit: [/credit/i, /cr/i],
  type: [/type/i, /transaction.?type/i, /entry.?type/i, /income.?expense/i],
  description: [/description/i, /memo/i, /narration/i, /details/i, /notes/i, /particular/i],
};

export function detectFinanceColumns(
  columns: ColumnInfo[],
  sampleData: Record<string, any>[]
): FinanceColumnMapping {
  const mapping: FinanceColumnMapping = {};
  const used = new Set<string>();

  // Score each column against each pattern group
  const matchColumn = (patternKey: keyof FinanceColumnMapping): string | undefined => {
    let bestCol: string | undefined;
    let bestScore = 0;

    for (const col of columns) {
      if (used.has(col.name)) continue;
      const patterns = COLUMN_PATTERNS[patternKey];
      for (const pattern of patterns) {
        if (pattern.test(col.name)) {
          const score = col.name.toLowerCase() === patternKey ? 10 : 5;
          if (score > bestScore) {
            bestScore = score;
            bestCol = col.name;
          }
        }
      }
    }

    if (bestCol) used.add(bestCol);
    return bestCol;
  };

  // Detect columns in priority order
  mapping.date = matchColumn('date');
  mapping.account = matchColumn('account');
  mapping.amount = matchColumn('amount');
  mapping.debit = matchColumn('debit');
  mapping.credit = matchColumn('credit');
  mapping.category = matchColumn('category');
  mapping.type = matchColumn('type');
  mapping.description = matchColumn('description');

  // If no amount but debit+credit exist, that's fine — we'll merge them
  // If no date, try to find a date-typed column
  if (!mapping.date) {
    const dateCol = columns.find(c => c.type === 'date' && !used.has(c.name));
    if (dateCol) {
      mapping.date = dateCol.name;
      used.add(dateCol.name);
    }
  }

  // If no account column, try first string column that's not already mapped
  if (!mapping.account) {
    const strCol = columns.find(c => c.type === 'string' && !used.has(c.name));
    if (strCol) {
      mapping.account = strCol.name;
      used.add(strCol.name);
    }
  }

  // If no amount and no debit/credit, try first number column
  if (!mapping.amount && !mapping.debit && !mapping.credit) {
    const numCol = columns.find(c => c.type === 'number' && !used.has(c.name));
    if (numCol) {
      mapping.amount = numCol.name;
      used.add(numCol.name);
    }
  }

  return mapping;
}

// ============================================================
// 2. ACCOUNT AUTO-CLASSIFICATION
// ============================================================

interface ClassificationRule {
  category: AccountCategory;
  keywords: string[];
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Revenue
  { category: 'revenue', keywords: ['sales', 'revenue', 'service income', 'consulting income', 'fees earned', 'commission income', 'subscription income', 'product sales', 'service revenue', 'gross sales'] },
  // COGS
  { category: 'cost_of_goods_sold', keywords: ['cost of goods', 'cogs', 'cost of sales', 'direct materials', 'direct labor', 'manufacturing cost', 'purchase', 'raw materials', 'freight in', 'production cost'] },
  // Operating Expenses
  { category: 'operating_expense', keywords: ['salary', 'salaries', 'wages', 'rent', 'utilities', 'electricity', 'water', 'marketing', 'advertising', 'depreciation', 'amortization', 'insurance', 'office supplies', 'office expense', 'travel', 'professional fees', 'legal fees', 'audit fees', 'software', 'maintenance', 'repairs', 'telephone', 'internet', 'postage', 'printing', 'training', 'subscription', 'cleaning', 'security', 'entertainment', 'meals', 'fuel', 'transport', 'delivery', 'commission expense', 'bad debt', 'bank charges', 'bank fees', 'payroll'] },
  // Tax
  { category: 'tax', keywords: ['income tax', 'tax expense', 'corporate tax', 'tax provision', 'tax payable'] },
  // Other Income
  { category: 'other_income', keywords: ['interest income', 'dividend income', 'gain on sale', 'gain on disposal', 'other income', 'miscellaneous income', 'rental income', 'foreign exchange gain'] },
  // Other Expense
  { category: 'other_expense', keywords: ['interest expense', 'loss on sale', 'loss on disposal', 'other expense', 'miscellaneous expense', 'foreign exchange loss', 'penalty', 'fine'] },
  // Current Assets
  { category: 'current_asset', keywords: ['cash', 'cash in hand', 'cash at bank', 'bank', 'petty cash', 'accounts receivable', 'trade receivable', 'inventory', 'stock', 'prepaid', 'prepayment', 'short-term investment', 'marketable securities', 'notes receivable'] },
  // Non-Current Assets
  { category: 'non_current_asset', keywords: ['property', 'plant', 'equipment', 'vehicle', 'building', 'land', 'furniture', 'fixture', 'intangible', 'goodwill', 'patent', 'trademark', 'long-term investment', 'capital work in progress', 'accumulated depreciation'] },
  // Current Liabilities
  { category: 'current_liability', keywords: ['accounts payable', 'trade payable', 'accrued', 'accrual', 'short-term loan', 'short-term debt', 'unearned revenue', 'deferred revenue', 'credit card', 'current portion', 'wages payable', 'salaries payable', 'tax payable', 'vat payable', 'gst payable', 'overdraft', 'notes payable'] },
  // Non-Current Liabilities
  { category: 'non_current_liability', keywords: ['long-term loan', 'long-term debt', 'mortgage', 'bonds payable', 'deferred tax liability', 'lease liability', 'long-term note', 'pension liability'] },
  // Equity
  { category: 'equity', keywords: ['owner equity', "owner's equity", 'retained earnings', 'capital', 'common stock', 'share capital', 'paid-in capital', 'additional paid-in', 'drawings', 'dividends', 'treasury stock', 'accumulated other comprehensive', 'reserves', 'share premium', 'opening balance equity'] },
];

export function classifyAccount(
  accountName: string,
  categoryHint?: string,
  amountHint?: number
): AccountCategory {
  const name = (accountName || '').toLowerCase().trim();
  const hint = (categoryHint || '').toLowerCase().replace(/[_-]+/g, ' ').trim();

  // Check category hint first (user-provided or column value)
  if (hint) {
    // Direct category mapping from common labels
    const hintMap: Record<string, AccountCategory> = {
      'revenue': 'revenue', 'income': 'revenue', 'sales': 'revenue',
      'cogs': 'cost_of_goods_sold', 'cost of goods sold': 'cost_of_goods_sold', 'cost of sales': 'cost_of_goods_sold',
      'expense': 'operating_expense', 'operating expense': 'operating_expense', 'opex': 'operating_expense',
      'asset': 'current_asset', 'current asset': 'current_asset',
      'fixed asset': 'non_current_asset', 'non-current asset': 'non_current_asset',
      'liability': 'current_liability', 'current liability': 'current_liability',
      'long-term liability': 'non_current_liability', 'non-current liability': 'non_current_liability',
      'equity': 'equity', "owner's equity": 'equity',
      'tax': 'tax',
      'other income': 'other_income',
      'other expense': 'other_expense',
    };

    for (const [key, cat] of Object.entries(hintMap)) {
      if (hint === key || hint.includes(key)) return cat;
    }
  }

  // Keyword matching against account name
  for (const rule of CLASSIFICATION_RULES) {
    for (const keyword of rule.keywords) {
      if (name.includes(keyword)) {
        return rule.category;
      }
    }
  }

  // Fallback: use amount sign if available
  if (amountHint !== undefined && amountHint !== 0) {
    return amountHint > 0 ? 'revenue' : 'operating_expense';
  }

  // Default: operating expense (most common catch-all)
  return 'operating_expense';
}

// ============================================================
// 3. TRANSACTION PARSER
// ============================================================

export function parseTransactions(
  data: Record<string, any>[],
  mapping: FinanceColumnMapping
): ClassifiedTransaction[] {
  const transactions: ClassifiedTransaction[] = [];
  const hasDebitCredit = !!(mapping.debit && mapping.credit);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    // Extract date
    let date = '';
    if (mapping.date && row[mapping.date] != null) {
      const raw = row[mapping.date];
      if (raw instanceof Date) {
        date = raw.toISOString().split('T')[0];
      } else {
        date = String(raw);
      }
    }

    // Extract account name
    const account = mapping.account ? String(row[mapping.account] || 'Unknown').trim() : 'Unknown';

    // Extract description
    const description = mapping.description ? String(row[mapping.description] || '').trim() : '';

    // Extract amount and determine debit/credit
    let amount = 0;
    let txType: 'debit' | 'credit' = 'debit';

    if (hasDebitCredit) {
      const debitVal = Number(row[mapping.debit!]) || 0;
      const creditVal = Number(row[mapping.credit!]) || 0;
      if (debitVal > 0) {
        amount = debitVal;
        txType = 'debit';
      } else if (creditVal > 0) {
        amount = creditVal;
        txType = 'credit';
      } else {
        continue; // Skip zero rows
      }
    } else if (mapping.amount) {
      const rawAmount = Number(row[mapping.amount]);
      if (isNaN(rawAmount) || rawAmount === 0) continue;
      amount = Math.abs(rawAmount);

      // Determine type from type column or amount sign
      if (mapping.type && row[mapping.type]) {
        const typeVal = String(row[mapping.type]).toLowerCase().trim();
        if (['income', 'revenue', 'credit', 'cr'].includes(typeVal)) {
          txType = 'credit';
        } else {
          txType = 'debit';
        }
      } else {
        // Positive = credit (income), negative = debit (expense) by convention
        txType = Number(row[mapping.amount]) >= 0 ? 'credit' : 'debit';
      }
    } else {
      continue;
    }

    // Extract category hint
    const categoryHint = mapping.category ? String(row[mapping.category] || '') : '';

    // Classify account
    const category = classifyAccount(account, categoryHint, txType === 'credit' ? amount : -amount);

    transactions.push({
      date,
      account,
      category,
      amount,
      description,
      type: txType,
      originalRow: i,
    });
  }

  // Sort by date
  return transactions.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// 4. HELPERS
// ============================================================

function groupByAccount(
  transactions: ClassifiedTransaction[],
  categories: AccountCategory[]
): LineItem[] {
  const filtered = transactions.filter(t => categories.includes(t.category));
  const grouped: Record<string, number> = {};

  const creditNormalCategories = new Set<AccountCategory>([
    'revenue',
    'other_income',
    'current_liability',
    'non_current_liability',
    'equity',
    'financing_cash',
  ]);

  for (const t of filtered) {
    const isCreditNormal = creditNormalCategories.has(t.category);
    const signedAmount =
      t.type === 'credit'
        ? (isCreditNormal ? t.amount : -t.amount)
        : (isCreditNormal ? -t.amount : t.amount);

    const key = t.account;
    if (!grouped[key]) grouped[key] = 0;
    grouped[key] += signedAmount;
  }

  return Object.entries(grouped)
    .map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
}

function sumLineItems(items: LineItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0 || isNaN(denominator)) return null;
  return Math.round((numerator / denominator) * 10000) / 100; // Two decimal %
}

type NetIncomeClosingMode = 'use_imported_equity' | 'add_net_income';

interface NetIncomeClosingDecision {
  mode: NetIncomeClosingMode;
  signalStrength: 'strong' | 'medium' | 'none';
  reason: string;
  evidence: string[];
}

const EARNINGS_CLOSING_KEYWORDS = [
  'retained earnings',
  'current year earnings',
  'prior year earnings',
  'net income',
  'net loss',
  'income summary',
  'profit and loss',
  'accumulated deficit',
  'year end close',
  'closing entry',
];

const STRONG_CLOSING_ACCOUNT_EXACT = new Set([
  'retained earnings',
  'current year earnings',
  'current-year earnings',
  'income summary',
  'profit and loss summary',
  'closing balance',
  'opening balance equity',
]);

const CLOSING_DESCRIPTION_HINTS = ['closing', 'year-end close', 'month-end close', 'close entry', 'closing entry'];
const PNL_CATEGORIES = new Set<AccountCategory>([
  'revenue',
  'cost_of_goods_sold',
  'operating_expense',
  'other_income',
  'other_expense',
  'tax',
]);

function hasKeywordMatch(accountName: string, keywords: string[]): boolean {
  const normalized = accountName.toLowerCase().trim();
  return keywords.some(keyword => normalized.includes(keyword));
}

function normalizeAccountName(accountName: string): string {
  return accountName.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isStrongClosingAccountName(accountName: string): boolean {
  return STRONG_CLOSING_ACCOUNT_EXACT.has(normalizeAccountName(accountName));
}

function descriptionHasClosingSignal(description?: string): boolean {
  if (!description) return false;
  const normalized = description.toLowerCase().trim();
  return CLOSING_DESCRIPTION_HINTS.some(hint => normalized.includes(hint));
}

function isMonthEnd(dateText: string): boolean {
  const parsed = Date.parse(dateText);
  if (Number.isNaN(parsed)) return false;
  const d = new Date(parsed);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return day === monthEnd;
}

function determineNetIncomeClosingDecision(
  transactions: ClassifiedTransaction[],
  netIncome: number,
  mode: NetIncomeToEquityMode,
  mediumSignalDefault: NetIncomeAutoMediumSignalDefault
): NetIncomeClosingDecision {
  const equityTransactions = transactions.filter(tx => tx.category === 'equity');
  const exactClosingAccounts = [...new Set(
    equityTransactions
      .filter(tx => isStrongClosingAccountName(tx.account))
      .map(tx => tx.account)
  )];
  const keywordClosingAccounts = [...new Set(
    equityTransactions
      .filter(tx => hasKeywordMatch(tx.account, EARNINGS_CLOSING_KEYWORDS))
      .map(tx => tx.account)
  )];

  const evidence: string[] = [];
  if (exactClosingAccounts.length > 0) {
    evidence.push(`Exact closing accounts detected: ${exactClosingAccounts.slice(0, 3).join(', ')}`);
  }
  if (keywordClosingAccounts.length > 0 && exactClosingAccounts.length === 0) {
    evidence.push(`Potential closing accounts detected: ${keywordClosingAccounts.slice(0, 3).join(', ')}`);
  }

  // Strong signal group 2: posting pattern detection.
  const byDate: Record<string, ClassifiedTransaction[]> = {};
  for (const tx of transactions) {
    const key = tx.date || '';
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(tx);
  }
  const postingPatternEvidence: string[] = [];
  for (const [date, entries] of Object.entries(byDate)) {
    const hasClosingSide = entries.some(entry => isStrongClosingAccountName(entry.account));
    const hasPnlOrClosingSide = entries.some(
      entry => PNL_CATEGORIES.has(entry.category) || hasKeywordMatch(entry.account, ['income summary', 'closing'])
    );
    if (hasClosingSide && hasPnlOrClosingSide) {
      const sample = entries.find(entry => isStrongClosingAccountName(entry.account));
      postingPatternEvidence.push(
        `${date}: posting includes "${sample?.account || 'closing account'}" with P&L/closing counterpart.`
      );
    }
  }
  const hasStrongPostingPattern = postingPatternEvidence.length > 0;
  if (hasStrongPostingPattern) {
    evidence.push(`Posting-pattern closing detected (${postingPatternEvidence.slice(0, 2).join(' | ')})`);
  }

  // Medium signal group 3: period-end closing markers.
  const mediumEvidence: string[] = [];
  const periodEndClosingRows = transactions.filter(tx => isMonthEnd(tx.date) && descriptionHasClosingSignal(tx.description));
  if (periodEndClosingRows.length > 0) {
    const sample = periodEndClosingRows[0];
    mediumEvidence.push(`Period-end closing memo on ${sample.date} (${sample.description || sample.account}).`);
  }

  const closingDateFrequency: Record<string, number> = {};
  for (const tx of transactions) {
    if (!descriptionHasClosingSignal(tx.description)) continue;
    closingDateFrequency[tx.date] = (closingDateFrequency[tx.date] || 0) + 1;
  }
  const repeatedClosingDates = Object.entries(closingDateFrequency)
    .filter(([, count]) => count >= 2)
    .map(([date, count]) => `${date} (${count} rows)`);
  if (repeatedClosingDates.length > 0) {
    mediumEvidence.push(`Repeated closing markers found on ${repeatedClosingDates.slice(0, 2).join(', ')}.`);
  }

  const hasMediumSignals = mediumEvidence.length > 0;
  if (hasMediumSignals) {
    evidence.push(...mediumEvidence);
  }

  const hasNameOnlySignal = exactClosingAccounts.length > 0 || keywordClosingAccounts.length > 0;
  const strongSignal = hasStrongPostingPattern;
  const mediumSignal = hasMediumSignals || (hasNameOnlySignal && !hasStrongPostingPattern);

  if (mode === 'always') {
    return {
      mode: 'add_net_income',
      signalStrength: strongSignal ? 'strong' : mediumSignal ? 'medium' : 'none',
      reason: 'Mode override always: net income is always added to equity.',
      evidence,
    };
  }

  if (mode === 'never') {
    return {
      mode: 'use_imported_equity',
      signalStrength: strongSignal ? 'strong' : mediumSignal ? 'medium' : 'none',
      reason: 'Mode override never: net income is never auto-added to equity.',
      evidence,
    };
  }

  if (strongSignal) {
    return {
      mode: 'use_imported_equity',
      signalStrength: 'strong',
      reason: 'Strong closing signal detected; net income will NOT be added to equity.',
      evidence,
    };
  }

  if (mediumSignal) {
    let selectedBehavior: 'add' | 'skip';
    let selectionReason: string;

    if (mediumSignalDefault === 'add') {
      selectedBehavior = 'add';
      selectionReason = 'manual setting selected add.';
    } else if (mediumSignalDefault === 'skip') {
      selectedBehavior = 'skip';
      selectionReason = 'manual setting selected skip.';
    } else if (hasNameOnlySignal) {
      // In auto mode, account-name closing hints are treated as stronger than memo-only markers.
      selectedBehavior = 'skip';
      selectionReason = 'auto selected skip because account-name closing signals were detected.';
    } else {
      selectedBehavior = 'add';
      selectionReason = 'auto selected add because only period-end memo markers were detected.';
    }

    const useImported = selectedBehavior === 'skip';
    const mediumSettingEvidence = `Medium-signal setting applied: net_income_equity_default=${mediumSignalDefault}; behavior=${selectedBehavior}.`;
    return {
      mode: useImported ? 'use_imported_equity' : 'add_net_income',
      signalStrength: 'medium',
      reason:
        `Medium closing signals detected; net_income_equity_default=${mediumSignalDefault} -> ` +
        `${useImported ? 'skip net-income auto-close' : 'add net income to equity'} (${selectionReason})`,
      evidence: [...evidence, mediumSettingEvidence],
    };
  }

  return {
    mode: 'add_net_income',
    signalStrength: 'none',
    reason: 'No closing signals detected; net income will be added to equity.',
    evidence: equityTransactions.length > 0
      ? [...evidence, `Equity transactions found (${equityTransactions.length}) without closing-pattern evidence.`]
      : [...evidence, 'No equity transactions were detected in source data.'],
  };
}

function detectOpeningBalances(transactions: ClassifiedTransaction[]): OpeningBalanceDiagnostics {
  if (transactions.length === 0) {
    return {
      firstTransactionDate: '',
      openingDetected: false,
      missingOpeningAssets: false,
      hasLiabilitiesOrEquity: false,
      evidence: ['No transactions available for opening-balance detection.'],
      suggestedDebitAccount: 'Cash',
      suggestedCreditAccount: 'Opening Balance Equity',
    };
  }

  const sortedDates = [...new Set(transactions.map(tx => tx.date).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const firstTransactionDate = sortedDates[0] || transactions[0].date || '';
  const firstDateRows = transactions.filter(tx => tx.date === firstTransactionDate);

  const openingMemoRows = transactions.filter(
    tx => /opening/i.test(tx.description || '') || /opening balance equity/i.test(tx.account)
  );
  const hasOpeningMemoSignal = openingMemoRows.length > 0;

  const openingAssetRegex = /(cash|bank|accounts receivable|trade receivable|inventory|stock|prepaid|petty cash)/i;
  const hasOpeningAssetDebit = firstDateRows.some(
    tx =>
      (tx.category === 'current_asset' || tx.category === 'non_current_asset') &&
      tx.type === 'debit' &&
      tx.amount > 0 &&
      openingAssetRegex.test(tx.account)
  );

  const hasLiabilitiesOrEquity = transactions.some(
    tx => tx.category === 'current_liability' || tx.category === 'non_current_liability' || tx.category === 'equity'
  );

  const hasFirstDateLiabEquityCredit = firstDateRows.some(
    tx =>
      (tx.category === 'current_liability' || tx.category === 'non_current_liability' || tx.category === 'equity') &&
      tx.type === 'credit' &&
      tx.amount > 0
  );

  const openingDetected = hasOpeningMemoSignal || hasOpeningAssetDebit;
  const missingOpeningAssets = (hasFirstDateLiabEquityCredit || hasLiabilitiesOrEquity) && !openingDetected;

  const liabEquityFirstDateCreditTotal = Math.round(
    firstDateRows
      .filter(
        tx =>
          (tx.category === 'current_liability' || tx.category === 'non_current_liability' || tx.category === 'equity') &&
          tx.type === 'credit'
      )
      .reduce((sum, tx) => sum + tx.amount, 0) * 100
  ) / 100;

  const assetFirstDateDebitTotal = Math.round(
    firstDateRows
      .filter(
        tx =>
          (tx.category === 'current_asset' || tx.category === 'non_current_asset') &&
          tx.type === 'debit'
      )
      .reduce((sum, tx) => sum + tx.amount, 0) * 100
  ) / 100;

  const evidence: string[] = [
    `First transaction date: ${firstTransactionDate || 'unknown'}.`,
    `Opening memo/account signal: ${hasOpeningMemoSignal ? 'yes' : 'no'}.`,
    `Opening asset debit signal: ${hasOpeningAssetDebit ? 'yes' : 'no'}.`,
  ];

  if (missingOpeningAssets) {
    evidence.push(
      `Liabilities/Equity present without opening assets (first-date Liabilities+Equity credits ${liabEquityFirstDateCreditTotal.toFixed(2)}, opening asset debits ${assetFirstDateDebitTotal.toFixed(2)}).`
    );
  }

  const suggestedAmount = Math.max(0, liabEquityFirstDateCreditTotal - assetFirstDateDebitTotal);

  return {
    firstTransactionDate,
    openingDetected,
    missingOpeningAssets,
    hasLiabilitiesOrEquity,
    evidence,
    suggestedDebitAccount: 'Cash',
    suggestedCreditAccount: 'Opening Balance Equity',
    suggestedAmount: suggestedAmount > 0 ? suggestedAmount : undefined,
  };
}

// ============================================================
// 5. PROFIT & LOSS GENERATOR
// ============================================================

export function generateProfitAndLoss(
  transactions: ClassifiedTransaction[],
  period: string
): ProfitAndLoss {
  const revenue = groupByAccount(transactions, ['revenue']);
  const totalRevenue = sumLineItems(revenue);

  const costOfGoodsSold = groupByAccount(transactions, ['cost_of_goods_sold']);
  const totalCOGS = sumLineItems(costOfGoodsSold);

  const grossProfit = Math.round((totalRevenue - totalCOGS) * 100) / 100;
  const grossMargin = safeDivide(grossProfit, totalRevenue) ?? 0;

  const operatingExpenses = groupByAccount(transactions, ['operating_expense']);
  const totalOperatingExpenses = sumLineItems(operatingExpenses);

  const operatingIncome = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;

  const otherIncome = groupByAccount(transactions, ['other_income']);
  const totalOtherIncome = sumLineItems(otherIncome);

  const otherExpenses = groupByAccount(transactions, ['other_expense']);
  const totalOtherExpenses = sumLineItems(otherExpenses);

  const incomeBeforeTax = Math.round((operatingIncome + totalOtherIncome - totalOtherExpenses) * 100) / 100;

  const taxItems = groupByAccount(transactions, ['tax']);
  const taxExpense = sumLineItems(taxItems);

  const netIncome = Math.round((incomeBeforeTax - taxExpense) * 100) / 100;
  const netMargin = safeDivide(netIncome, totalRevenue) ?? 0;

  return {
    period,
    revenue,
    totalRevenue,
    costOfGoodsSold,
    totalCOGS,
    grossProfit,
    grossMargin,
    operatingExpenses,
    totalOperatingExpenses,
    operatingIncome,
    otherIncome,
    totalOtherIncome,
    otherExpenses,
    totalOtherExpenses,
    incomeBeforeTax,
    taxExpense,
    netIncome,
    netMargin,
  };
}

// ============================================================
// 6. BALANCE SHEET GENERATOR
// ============================================================

const BALANCE_SHEET_TOLERANCE = 0.05;

export function generateBalanceSheet(
  transactions: ClassifiedTransaction[],
  asOfDate: string,
  retainedEarnings?: number
): BalanceSheet {
  const currentAssets = groupByAccount(transactions, ['current_asset']);
  const totalCurrentAssets = sumLineItems(currentAssets);

  const nonCurrentAssets = groupByAccount(transactions, ['non_current_asset']);
  const totalNonCurrentAssets = sumLineItems(nonCurrentAssets);

  const totalAssets = Math.round((totalCurrentAssets + totalNonCurrentAssets) * 100) / 100;

  const currentLiabilities = groupByAccount(transactions, ['current_liability']);
  const totalCurrentLiabilities = sumLineItems(currentLiabilities);

  const nonCurrentLiabilities = groupByAccount(transactions, ['non_current_liability']);
  const totalNonCurrentLiabilities = sumLineItems(nonCurrentLiabilities);

  const totalLiabilities = Math.round((totalCurrentLiabilities + totalNonCurrentLiabilities) * 100) / 100;

  // Equity items from transactions
  const equityItems = groupByAccount(transactions, ['equity']);

  // Add retained earnings from P&L if available
  if (retainedEarnings !== undefined && retainedEarnings !== 0) {
    equityItems.push({
      label: 'Retained Earnings (Net Income)',
      amount: Math.round(retainedEarnings * 100) / 100,
    });
  }

  const totalEquity = sumLineItems(equityItems);
  const totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;

  // Check if balanced
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) <= BALANCE_SHEET_TOLERANCE;

  return {
    asOfDate,
    currentAssets,
    totalCurrentAssets,
    nonCurrentAssets,
    totalNonCurrentAssets,
    totalAssets,
    currentLiabilities,
    totalCurrentLiabilities,
    nonCurrentLiabilities,
    totalNonCurrentLiabilities,
    totalLiabilities,
    equity: equityItems,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
  };
}

// ============================================================
// 7. CASH FLOW STATEMENT GENERATOR
// ============================================================

export function generateCashFlow(
  transactions: ClassifiedTransaction[],
  period: string,
  netIncome: number
): CashFlowStatement {
  // Operating activities: start with net income, add back non-cash items
  const operatingItems: LineItem[] = [
    { label: 'Net Income', amount: netIncome },
  ];

  // Add back depreciation/amortization (non-cash expenses)
  const depreciationTxns = transactions.filter(
    t =>
      t.category === 'operating_expense' &&
      (t.account.toLowerCase().includes('depreciation') || t.account.toLowerCase().includes('amortization'))
  );
  const depreciation = depreciationTxns.reduce((s, t) => s + t.amount, 0);
  if (depreciation > 0) {
    operatingItems.push({ label: 'Add: Depreciation & Amortization', amount: Math.round(depreciation * 100) / 100 });
  }

  // Changes in working capital
  const receivables = transactions
    .filter(t => t.account.toLowerCase().includes('receivable'))
    .reduce((s, t) => s + (t.type === 'debit' ? t.amount : -t.amount), 0);
  if (receivables !== 0) {
    operatingItems.push({
      label: receivables > 0 ? 'Decrease in Accounts Receivable' : 'Increase in Accounts Receivable',
      amount: Math.round(-receivables * 100) / 100,
    });
  }

  const inventoryChanges = transactions
    .filter(t => t.account.toLowerCase().includes('inventor'))
    .reduce((s, t) => s + (t.type === 'debit' ? t.amount : -t.amount), 0);
  if (inventoryChanges !== 0) {
    operatingItems.push({
      label: inventoryChanges > 0 ? 'Decrease in Inventory' : 'Increase in Inventory',
      amount: Math.round(-inventoryChanges * 100) / 100,
    });
  }

  const payables = transactions
    .filter(t => t.account.toLowerCase().includes('payable') && t.category === 'current_liability')
    .reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
  if (payables !== 0) {
    operatingItems.push({
      label: payables > 0 ? 'Increase in Accounts Payable' : 'Decrease in Accounts Payable',
      amount: Math.round(payables * 100) / 100,
    });
  }

  const netOperatingCashFlow = Math.round(sumLineItems(operatingItems) * 100) / 100;

  // Investing activities: asset purchases/sales
  const investingItems: LineItem[] = [];
  const assetPurchases = transactions.filter(t => t.category === 'non_current_asset');
  const assetTotal = assetPurchases.reduce((s, t) => s + t.amount, 0);
  if (assetTotal > 0) {
    investingItems.push({
      label: 'Purchase of Property & Equipment',
      amount: Math.round(-assetTotal * 100) / 100,
    });
  }
  const netInvestingCashFlow = Math.round(sumLineItems(investingItems) * 100) / 100;

  // Financing activities: debt + equity transactions
  const financingItems: LineItem[] = [];
  const debtInflows = transactions.filter(
    t =>
      (t.category === 'current_liability' || t.category === 'non_current_liability') &&
      t.type === 'credit' &&
      (t.account.toLowerCase().includes('loan') || t.account.toLowerCase().includes('debt') || t.account.toLowerCase().includes('mortgage'))
  );
  const debtInflowTotal = debtInflows.reduce((s, t) => s + t.amount, 0);
  if (debtInflowTotal > 0) {
    financingItems.push({ label: 'Proceeds from Borrowings', amount: Math.round(debtInflowTotal * 100) / 100 });
  }

  const debtRepayments = transactions.filter(
    t =>
      (t.category === 'current_liability' || t.category === 'non_current_liability') &&
      t.type === 'debit' &&
      (t.account.toLowerCase().includes('loan') || t.account.toLowerCase().includes('debt') || t.account.toLowerCase().includes('mortgage'))
  );
  const repaymentTotal = debtRepayments.reduce((s, t) => s + t.amount, 0);
  if (repaymentTotal > 0) {
    financingItems.push({ label: 'Repayment of Borrowings', amount: Math.round(-repaymentTotal * 100) / 100 });
  }

  const equityTxns = transactions.filter(t => t.category === 'equity');
  const capitalContributions = equityTxns.filter(t => t.type === 'credit' && !t.account.toLowerCase().includes('drawing') && !t.account.toLowerCase().includes('dividend'));
  const capitalTotal = capitalContributions.reduce((s, t) => s + t.amount, 0);
  if (capitalTotal > 0) {
    financingItems.push({ label: 'Capital Contributions', amount: Math.round(capitalTotal * 100) / 100 });
  }

  const drawings = equityTxns.filter(t => t.account.toLowerCase().includes('drawing') || t.account.toLowerCase().includes('dividend'));
  const drawingsTotal = drawings.reduce((s, t) => s + t.amount, 0);
  if (drawingsTotal > 0) {
    financingItems.push({ label: 'Owner Drawings / Dividends', amount: Math.round(-drawingsTotal * 100) / 100 });
  }

  const netFinancingCashFlow = Math.round(sumLineItems(financingItems) * 100) / 100;

  // Net cash change
  const netCashChange = Math.round((netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow) * 100) / 100;

  // Beginning cash: sum of cash accounts
  const cashAccounts = transactions.filter(
    t => t.category === 'current_asset' && (t.account.toLowerCase().includes('cash') || t.account.toLowerCase().includes('bank'))
  );
  const beginningCash = Math.round(cashAccounts.reduce((s, t) => s + (t.type === 'debit' ? t.amount : -t.amount), 0) * 100) / 100;
  const endingCash = Math.round((beginningCash + netCashChange) * 100) / 100;

  return {
    period,
    operatingActivities: operatingItems,
    netOperatingCashFlow,
    investingActivities: investingItems,
    netInvestingCashFlow,
    financingActivities: financingItems,
    netFinancingCashFlow,
    netCashChange,
    beginningCash,
    endingCash,
  };
}

// ============================================================
// 8. FINANCIAL RATIOS
// ============================================================

export function calculateFinancialRatios(
  pnl: ProfitAndLoss,
  bs: BalanceSheet,
  cf: CashFlowStatement
): FinancialRatios {
  return {
    grossMargin: safeDivide(pnl.grossProfit, pnl.totalRevenue),
    operatingMargin: safeDivide(pnl.operatingIncome, pnl.totalRevenue),
    netProfitMargin: safeDivide(pnl.netIncome, pnl.totalRevenue),
    returnOnAssets: bs.totalAssets > 0 ? safeDivide(pnl.netIncome, bs.totalAssets) : null,
    returnOnEquity: bs.totalEquity > 0 ? safeDivide(pnl.netIncome, bs.totalEquity) : null,
    currentRatio: bs.totalCurrentLiabilities > 0
      ? Math.round((bs.totalCurrentAssets / bs.totalCurrentLiabilities) * 100) / 100
      : null,
    quickRatio: bs.totalCurrentLiabilities > 0
      ? (() => {
          const inventory = bs.currentAssets
            .filter(a => a.label.toLowerCase().includes('inventor'))
            .reduce((s, a) => s + a.amount, 0);
          return Math.round(((bs.totalCurrentAssets - inventory) / bs.totalCurrentLiabilities) * 100) / 100;
        })()
      : null,
    debtToEquity: bs.totalEquity > 0
      ? Math.round((bs.totalLiabilities / bs.totalEquity) * 100) / 100
      : null,
    debtToAssets: bs.totalAssets > 0
      ? safeDivide(bs.totalLiabilities, bs.totalAssets)
      : null,
    assetTurnover: bs.totalAssets > 0
      ? Math.round((pnl.totalRevenue / bs.totalAssets) * 100) / 100
      : null,
    operatingCashFlowRatio: bs.totalCurrentLiabilities > 0
      ? Math.round((cf.netOperatingCashFlow / bs.totalCurrentLiabilities) * 100) / 100
      : null,
  };
}

// ============================================================
// 9. RATIO INTERPRETATION
// ============================================================

export function interpretRatios(ratios: FinancialRatios): RatioInterpretation[] {
  const result: RatioInterpretation[] = [];

  const addRatio = (
    name: string,
    value: number | null,
    format: 'percent' | 'ratio',
    thresholds: { healthy: number; caution: number },
    higherIsBetter: boolean,
    description: string
  ) => {
    if (value === null) {
      result.push({ name, value: null, formatted: 'N/A', status: 'na', description });
      return;
    }
    const formatted = format === 'percent' ? `${value.toFixed(1)}%` : value.toFixed(2);
    let status: 'healthy' | 'caution' | 'warning';
    if (higherIsBetter) {
      status = value >= thresholds.healthy ? 'healthy' : value >= thresholds.caution ? 'caution' : 'warning';
    } else {
      status = value <= thresholds.healthy ? 'healthy' : value <= thresholds.caution ? 'caution' : 'warning';
    }
    result.push({ name, value, formatted, status, description });
  };

  addRatio('Gross Margin', ratios.grossMargin, 'percent', { healthy: 40, caution: 20 }, true,
    'Percentage of revenue retained after direct costs');
  addRatio('Operating Margin', ratios.operatingMargin, 'percent', { healthy: 15, caution: 5 }, true,
    'Percentage of revenue retained after operating costs');
  addRatio('Net Profit Margin', ratios.netProfitMargin, 'percent', { healthy: 10, caution: 2 }, true,
    'Percentage of revenue that becomes profit');
  addRatio('Return on Assets', ratios.returnOnAssets, 'percent', { healthy: 5, caution: 2 }, true,
    'How efficiently assets generate profit');
  addRatio('Return on Equity', ratios.returnOnEquity, 'percent', { healthy: 15, caution: 8 }, true,
    'Return generated on owners\' investment');
  addRatio('Current Ratio', ratios.currentRatio, 'ratio', { healthy: 1.5, caution: 1.0 }, true,
    'Ability to pay short-term obligations');
  addRatio('Quick Ratio', ratios.quickRatio, 'ratio', { healthy: 1.0, caution: 0.5 }, true,
    'Ability to pay short-term obligations without inventory');
  addRatio('Debt to Equity', ratios.debtToEquity, 'ratio', { healthy: 1.5, caution: 2.5 }, false,
    'Total debt relative to equity (lower is safer)');
  addRatio('Debt to Assets', ratios.debtToAssets, 'percent', { healthy: 50, caution: 70 }, false,
    'Percentage of assets financed by debt');
  addRatio('Asset Turnover', ratios.assetTurnover, 'ratio', { healthy: 1.0, caution: 0.5 }, true,
    'Revenue generated per dollar of assets');
  addRatio('Operating Cash Flow Ratio', ratios.operatingCashFlowRatio, 'ratio', { healthy: 1.0, caution: 0.5 }, true,
    'Cash generated from operations vs short-term liabilities');

  return result;
}

// ============================================================
// 10. FINANCIAL HEALTH SCORE
// ============================================================

function calculateHealthScore(ratios: FinancialRatios, bs: BalanceSheet): number {
  let score = 50; // Start at neutral

  // Profitability (up to +20)
  if (ratios.netProfitMargin !== null) {
    if (ratios.netProfitMargin > 15) score += 20;
    else if (ratios.netProfitMargin > 5) score += 10;
    else if (ratios.netProfitMargin > 0) score += 5;
    else score -= 10;
  }

  // Liquidity (up to +15)
  if (ratios.currentRatio !== null) {
    if (ratios.currentRatio >= 2) score += 15;
    else if (ratios.currentRatio >= 1.5) score += 10;
    else if (ratios.currentRatio >= 1) score += 5;
    else score -= 10;
  }

  // Leverage (up to +10)
  if (ratios.debtToEquity !== null) {
    if (ratios.debtToEquity < 1) score += 10;
    else if (ratios.debtToEquity < 2) score += 5;
    else score -= 5;
  }

  // Balance sheet balance (+5)
  if (bs.isBalanced) score += 5;

  // Gross margin (up to +10)
  if (ratios.grossMargin !== null) {
    if (ratios.grossMargin > 50) score += 10;
    else if (ratios.grossMargin > 30) score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================================
// 11. CHART DATA GENERATORS
// ============================================================

export function generateFinanceChartData(report: FinancialReport): FinanceChartData {
  const pnl = report.profitAndLoss;
  const bs = report.balanceSheet;
  const cf = report.cashFlow;

  // Revenue vs Expenses
  const revenueVsExpenses = [
    { category: 'Revenue', revenue: pnl.totalRevenue, expenses: 0 },
    { category: 'COGS', revenue: 0, expenses: pnl.totalCOGS },
    { category: 'Operating Exp.', revenue: 0, expenses: pnl.totalOperatingExpenses },
    { category: 'Other Exp.', revenue: 0, expenses: pnl.totalOtherExpenses + pnl.taxExpense },
  ];

  // Expense breakdown
  const allExpenses = [
    ...pnl.costOfGoodsSold.map(i => ({ name: i.label, value: i.amount })),
    ...pnl.operatingExpenses.map(i => ({ name: i.label, value: i.amount })),
  ].sort((a, b) => b.value - a.value);

  // Limit to top 8 + "Other"
  let expenseBreakdown: { name: string; value: number }[];
  if (allExpenses.length > 8) {
    const top8 = allExpenses.slice(0, 8);
    const otherTotal = allExpenses.slice(8).reduce((s, e) => s + e.value, 0);
    expenseBreakdown = [...top8, { name: 'Other', value: Math.round(otherTotal * 100) / 100 }];
  } else {
    expenseBreakdown = allExpenses;
  }

  // Cash flow waterfall
  const cashFlowWaterfall = [
    { name: 'Operating', value: cf.netOperatingCashFlow, fill: cf.netOperatingCashFlow >= 0 ? POSITIVE_CHART_COLOR : NEGATIVE_CHART_COLOR },
    { name: 'Investing', value: cf.netInvestingCashFlow, fill: cf.netInvestingCashFlow >= 0 ? POSITIVE_CHART_COLOR : NEGATIVE_CHART_COLOR },
    { name: 'Financing', value: cf.netFinancingCashFlow, fill: cf.netFinancingCashFlow >= 0 ? POSITIVE_CHART_COLOR : NEGATIVE_CHART_COLOR },
    { name: 'Net Change', value: cf.netCashChange, fill: cf.netCashChange >= 0 ? SHARED_CHART_PALETTE[0] : SHARED_CHART_PALETTE[2] },
  ];

  // Asset allocation
  const assetAllocation = [
    ...bs.currentAssets.map(a => ({ name: a.label, value: a.amount })),
    ...bs.nonCurrentAssets.map(a => ({ name: a.label, value: a.amount })),
  ].filter(a => a.value > 0).sort((a, b) => b.value - a.value);

  // Liability breakdown
  const liabilityBreakdown = [
    ...bs.currentLiabilities.map(a => ({ name: a.label, value: a.amount })),
    ...bs.nonCurrentLiabilities.map(a => ({ name: a.label, value: a.amount })),
  ].filter(a => a.value > 0).sort((a, b) => b.value - a.value);

  // Profitability margins
  const profitabilityMargins = [
    { name: 'Gross Margin', value: pnl.grossMargin, color: SHARED_CHART_PALETTE[5] },
    { name: 'Operating Margin', value: safeDivide(pnl.operatingIncome, pnl.totalRevenue) ?? 0, color: SHARED_CHART_PALETTE[0] },
    { name: 'Net Margin', value: pnl.netMargin, color: SHARED_CHART_PALETTE[4] },
  ];

  return {
    revenueVsExpenses,
    expenseBreakdown,
    cashFlowWaterfall,
    assetAllocation,
    liabilityBreakdown,
    profitabilityMargins,
  };
}

// ============================================================
// 12. TEMPLATE CSV GENERATOR
// ============================================================

export function generateTemplateCSV(): string {
  const headers = 'Date,Account,Category,Amount,Type,Description';
  const rows = [
    '2024-01-01,Product Sales,Revenue,50000,Credit,January product revenue',
    '2024-01-01,Service Revenue,Revenue,15000,Credit,Consulting services',
    '2024-01-01,Cost of Goods Sold,COGS,20000,Debit,Raw materials and production',
    '2024-01-15,Salaries,Operating Expense,12000,Debit,Monthly payroll',
    '2024-01-15,Rent,Operating Expense,3000,Debit,Office rent',
    '2024-01-15,Utilities,Operating Expense,800,Debit,Electricity and water',
    '2024-01-15,Marketing,Operating Expense,2500,Debit,Digital advertising',
    '2024-01-20,Interest Income,Other Income,200,Credit,Bank interest earned',
    '2024-01-25,Interest Expense,Other Expense,500,Debit,Loan interest',
    '2024-01-31,Income Tax,Tax,3000,Debit,Quarterly tax estimate',
    '2024-01-01,Cash at Bank,Current Asset,25000,Debit,Opening bank balance',
    '2024-01-01,Accounts Receivable,Current Asset,10000,Debit,Outstanding invoices',
    '2024-01-01,Inventory,Current Asset,8000,Debit,Stock on hand',
    '2024-01-01,Office Equipment,Non-Current Asset,15000,Debit,Computer and furniture',
    '2024-01-01,Accounts Payable,Current Liability,5000,Credit,Supplier bills due',
    '2024-01-01,Short-term Loan,Current Liability,10000,Credit,Working capital loan',
    '2024-01-01,Long-term Loan,Non-Current Liability,30000,Credit,Equipment financing',
    '2024-01-01,Owner Equity,Equity,50000,Credit,Initial capital investment',
    '2024-01-31,Retained Earnings,Equity,3400,Credit,Accumulated profits',
  ];

  return [headers, ...rows].join('\n');
}

// ============================================================
// 13. MASTER ORCHESTRATOR
// ============================================================

export async function generateFinancialReport(
  data: Record<string, any>[],
  mapping: FinanceColumnMapping,
  options: {
    period: ReportPeriod;
    companyName: string;
    asOfDate?: string;
    netIncomeToEquityMode?: NetIncomeToEquityMode;
    netIncomeEquityDefault?: NetIncomeAutoMediumSignalDefault;
    autoNetIncomeDefaultOnMediumSignal?: NetIncomeAutoMediumSignalDefault;
  },
  onProgress?: (progress: number, message: string) => void
): Promise<FinancialReport> {
  const warnings: string[] = [];
  const yieldToBrowser = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  // Step 1: Parse transactions
  onProgress?.(10, 'Parsing and classifying transactions...');
  await yieldToBrowser();
  const transactions = parseTransactions(data, mapping);

  if (transactions.length === 0) {
    warnings.push('No valid transactions were found. Please check your column mapping.');
  }

  // Step 2: Generate P&L
  onProgress?.(30, 'Generating Profit & Loss Statement...');
  await yieldToBrowser();

  const periodLabel = options.asOfDate
    ? `Period ending ${options.asOfDate}`
    : `${options.period.charAt(0).toUpperCase() + options.period.slice(1)} Report`;

  const pnl = generateProfitAndLoss(transactions, periodLabel);

  if (pnl.totalRevenue === 0) {
    warnings.push('No revenue transactions found. Check that income items are properly classified.');
  }

  // Step 3: Generate Balance Sheet
  onProgress?.(50, 'Generating Balance Sheet...');
  await yieldToBrowser();
  const asOfDate = options.asOfDate || new Date().toISOString().split('T')[0];
  const netIncomeMode = options.netIncomeToEquityMode || 'auto';
  const mediumSignalDefault =
    options.netIncomeEquityDefault ||
    options.autoNetIncomeDefaultOnMediumSignal ||
    'auto';
  const closingDecision = determineNetIncomeClosingDecision(
    transactions,
    pnl.netIncome,
    netIncomeMode,
    mediumSignalDefault
  );
  const bs = closingDecision.mode === 'use_imported_equity'
    ? generateBalanceSheet(transactions, asOfDate)
    : generateBalanceSheet(transactions, asOfDate, pnl.netIncome);
  const openingDiagnostics = detectOpeningBalances(transactions);

  warnings.push(`Equity closing decision: ${closingDecision.reason}`);
  closingDecision.evidence.slice(0, 3).forEach(line => warnings.push(`Equity closing evidence: ${line}`));
  openingDiagnostics.evidence.slice(0, 3).forEach(line => warnings.push(`Opening balance evidence: ${line}`));
  if (openingDiagnostics.missingOpeningAssets) {
    warnings.push(
      "Opening balances missing. Balance Sheet can't reconcile without opening assets (Cash/AR/Inventory) to match Liabilities/Equity."
    );
  }

  if (!bs.isBalanced) {
    const diff = Math.abs(bs.totalAssets - bs.totalLiabilitiesAndEquity);
    warnings.push(
      `Balance Sheet is not balanced. Assets (${bs.totalAssets.toLocaleString()}) != Liabilities + Equity (${bs.totalLiabilitiesAndEquity.toLocaleString()}). Difference: ${diff.toLocaleString()}`
    );
  }

  if (bs.totalAssets < 0) {
    warnings.push(
      'Total Assets are negative after normal-balance enforcement (Assets = Debits - Credits). Review account type mapping and debit/credit direction.'
    );
  }

  const reconciliationDiagnostics: ReconciliationDiagnostics = {
    assets: bs.totalAssets,
    liabilities: bs.totalLiabilities,
    equity: bs.totalEquity,
    netIncome: pnl.netIncome,
    normalBalanceRule: 'Assets = Debits - Credits; Liabilities/Equity = Credits - Debits',
    closing: {
      signalStrength: closingDecision.signalStrength,
      closingDetected: closingDecision.signalStrength !== 'none',
      addedNetIncomeToEquity: closingDecision.mode === 'add_net_income',
      reason: closingDecision.reason,
      evidence: closingDecision.evidence.slice(0, 3),
    } as ClosingDetectionDiagnostics,
    opening: openingDiagnostics,
  };

  // Step 4: Generate Cash Flow
  onProgress?.(70, 'Generating Cash Flow Statement...');
  await yieldToBrowser();
  const cf = generateCashFlow(transactions, periodLabel, pnl.netIncome);

  // Step 5: Calculate Ratios
  onProgress?.(85, 'Calculating Financial Ratios...');
  await yieldToBrowser();
  const ratios = calculateFinancialRatios(pnl, bs, cf);
  const ratioInterpretations = interpretRatios(ratios);

  // Step 6: Health Score
  onProgress?.(95, 'Computing Financial Health Score...');
  await yieldToBrowser();
  const healthScore = calculateHealthScore(ratios, bs);

  onProgress?.(100, 'Complete!');
  await yieldToBrowser();

  return {
    companyName: options.companyName || 'My Company',
    reportPeriod: periodLabel,
    generatedAt: new Date(),
    profitAndLoss: pnl,
    balanceSheet: bs,
    cashFlow: cf,
    ratios,
    ratioInterpretations,
    transactions,
    warnings,
    healthScore,
    reconciliationDiagnostics,
  };
}

