// Trial Balance Generator
// Derives a standard double-entry trial balance from ClassifiedTransaction[].
// Purely additive — no existing engine code is modified.

import { AccountCategory, ClassifiedTransaction, TrialBalance, TrialBalanceRow } from './financeTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Display order of account categories in the printed trial balance */
const CATEGORY_ORDER: AccountCategory[] = [
  'current_asset',
  'non_current_asset',
  'current_liability',
  'non_current_liability',
  'equity',
  'revenue',
  'other_income',
  'cost_of_goods_sold',
  'operating_expense',
  'other_expense',
  'tax',
  'operating_cash',
  'investing_cash',
  'financing_cash',
];

/** Human-readable section headings for each category */
export const TRIAL_BALANCE_CATEGORY_LABELS: Record<AccountCategory, string> = {
  current_asset: 'Current Assets',
  non_current_asset: 'Non-Current Assets',
  current_liability: 'Current Liabilities',
  non_current_liability: 'Non-Current Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  other_income: 'Other Income',
  cost_of_goods_sold: 'Cost of Goods Sold',
  operating_expense: 'Operating Expenses',
  other_expense: 'Other Expenses',
  tax: 'Tax',
  operating_cash: 'Operating Cash',
  investing_cash: 'Investing Cash',
  financing_cash: 'Financing Cash',
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Generates a trial balance from a set of classified transactions.
 *
 * Algorithm:
 *  1. Optionally filter transactions to those on or before `asOfDate`.
 *  2. Aggregate total debits and total credits per account name.
 *  3. Derive the net balance for each account:
 *       debitBalance  = max(totalDebits - totalCredits, 0)
 *       creditBalance = max(totalCredits - totalDebits, 0)
 *  4. Sum all debitBalance values → totalDebits
 *     Sum all creditBalance values → totalCredits
 *  5. isBalanced = |totalDebits - totalCredits| < 0.01
 *
 * A balanced trial balance is a prerequisite for correct financial statements.
 */
export function generateTrialBalance(
  transactions: ClassifiedTransaction[],
  asOfDate?: string,
): TrialBalance {
  const resolvedDate = asOfDate ?? new Date().toISOString().split('T')[0];

  // 1. Filter to the reporting period
  const filtered = asOfDate
    ? transactions.filter(t => t.date <= resolvedDate)
    : transactions;

  // 2. Aggregate per account
  const accountMap = new Map<
    string,
    {
      totalDebits: number;
      totalCredits: number;
      categoryCounts: Map<AccountCategory, number>;
    }
  >();

  for (const tx of filtered) {
    const existing = accountMap.get(tx.account);
    const amount = Math.abs(tx.amount);
    if (!existing) {
      accountMap.set(tx.account, {
        totalDebits: tx.type === 'debit' ? amount : 0,
        totalCredits: tx.type === 'credit' ? amount : 0,
        categoryCounts: new Map<AccountCategory, number>([[tx.category, 1]]),
      });
    } else {
      if (tx.type === 'debit') {
        existing.totalDebits += amount;
      } else {
        existing.totalCredits += amount;
      }
      existing.categoryCounts.set(
        tx.category,
        (existing.categoryCounts.get(tx.category) || 0) + 1,
      );
    }
  }

  // 3. Build rows with net balances
  const rows: TrialBalanceRow[] = [];
  const categoryConflicts: Array<{ account: string; categories: AccountCategory[] }> = [];
  for (const [account, data] of accountMap.entries()) {
    const categories = [...data.categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const dominantCategory = categories[0][0];
    if (categories.length > 1) {
      categoryConflicts.push({
        account,
        categories: categories.map(([category]) => category),
      });
    }

    const net = data.totalDebits - data.totalCredits;
    rows.push({
      account,
      category: dominantCategory,
      totalDebits: Math.round(data.totalDebits * 100) / 100,
      totalCredits: Math.round(data.totalCredits * 100) / 100,
      debitBalance: net > 0 ? Math.round(net * 100) / 100 : 0,
      creditBalance: net < 0 ? Math.round(Math.abs(net) * 100) / 100 : 0,
    });
  }

  // 4. Sort: category order first, then alphabetically
  rows.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.account.localeCompare(b.account);
  });

  // 5. Totals and balance check
  const totalDebits = Math.round(rows.reduce((s, r) => s + r.debitBalance, 0) * 100) / 100;
  const totalCredits = Math.round(rows.reduce((s, r) => s + r.creditBalance, 0) * 100) / 100;
  const difference = Math.abs(totalDebits - totalCredits);

  return {
    asOfDate: resolvedDate,
    rows,
    totalDebits,
    totalCredits,
    isBalanced: difference < 0.01,
    difference: Math.round(difference * 100) / 100,
    categoryConflicts,
  };
}
