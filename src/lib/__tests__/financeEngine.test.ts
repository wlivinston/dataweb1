import { describe, it, expect } from 'vitest';
import {
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlow,
  calculateFinancialRatios,
  interpretRatios,
  classifyAccount,
} from '../financeEngine';
import type { AccountCategory, ClassifiedTransaction } from '../financeTypes';

/**
 * A complete, hand-computed trial balance for a trading company.
 *
 *   Revenue                       500,000
 *   Cost of sales                (300,000)  -> Gross profit   200,000 (40.0%)
 *   Operating expenses           (110,000)  -> Operating inc.  90,000 (18.0%)
 *   Other income                    5,000
 *   Other expense                 (15,000)  -> Pre-tax income  80,000
 *   Tax                           (20,000)  -> Net income      60,000 (12.0%)
 *
 *   Current assets                230,000   Current liabilities   100,000
 *   Non-current assets            150,000   Non-current liab.      80,000
 *   ------------------------------------    Share capital         140,000
 *   Total assets                  380,000   Retained earnings      60,000
 *                                           ----------------------------
 *                                           Total L + E           380,000
 *
 * Every figure asserted below is derived from this table by hand, not captured
 * from a previous run of the engine.
 */
const tx = (
  account: string,
  category: AccountCategory,
  amount: number,
  type: 'debit' | 'credit',
  date = '2024-06-30'
): ClassifiedTransaction => ({ date, account, category, amount, type });

const trialBalance: ClassifiedTransaction[] = [
  // --- Profit and loss ---
  tx('Sales Revenue', 'revenue', 500_000, 'credit'),
  tx('Cost of Sales', 'cost_of_goods_sold', 300_000, 'debit'),
  tx('Salaries', 'operating_expense', 80_000, 'debit'),
  tx('Rent', 'operating_expense', 20_000, 'debit'),
  tx('Marketing', 'operating_expense', 10_000, 'debit'),
  tx('Interest Income', 'other_income', 5_000, 'credit'),
  tx('Interest Expense', 'other_expense', 15_000, 'debit'),
  tx('Income Tax', 'tax', 20_000, 'debit'),

  // --- Balance sheet ---
  tx('Cash', 'current_asset', 120_000, 'debit', '2024-12-31'),
  tx('Accounts Receivable', 'current_asset', 60_000, 'debit', '2024-12-31'),
  tx('Inventory', 'current_asset', 40_000, 'debit', '2024-12-31'),
  tx('Prepaid Insurance', 'current_asset', 10_000, 'debit', '2024-12-31'),
  tx('Equipment', 'non_current_asset', 150_000, 'debit', '2024-12-31'),
  tx('Accounts Payable', 'current_liability', 70_000, 'credit', '2024-12-31'),
  tx('Accrued Expenses', 'current_liability', 30_000, 'credit', '2024-12-31'),
  tx('Long-term Loan', 'non_current_liability', 80_000, 'credit', '2024-12-31'),
  tx('Share Capital', 'equity', 140_000, 'credit', '2024-12-31'),
];

describe('Profit and loss statement', () => {
  const pnl = generateProfitAndLoss(trialBalance, 'FY2024');

  it('totals revenue and cost of sales with the correct sign convention', () => {
    expect(pnl.totalRevenue).toBe(500_000);
    expect(pnl.totalCOGS).toBe(300_000);
  });

  it('computes gross profit and gross margin', () => {
    expect(pnl.grossProfit).toBe(200_000);
    expect(pnl.grossMargin).toBeCloseTo(40, 6); // reported as a percentage
  });

  it('aggregates every operating expense account', () => {
    expect(pnl.totalOperatingExpenses).toBe(110_000);
    expect(pnl.operatingExpenses.map((i) => i.label).sort()).toEqual([
      'Marketing',
      'Rent',
      'Salaries',
    ]);
    expect(pnl.operatingIncome).toBe(90_000);
  });

  it('applies other income, other expense and tax in the right order', () => {
    expect(pnl.totalOtherIncome).toBe(5_000);
    expect(pnl.totalOtherExpenses).toBe(15_000);
    expect(pnl.incomeBeforeTax).toBe(80_000);
    expect(pnl.taxExpense).toBe(20_000);
    expect(pnl.netIncome).toBe(60_000);
    expect(pnl.netMargin).toBeCloseTo(12, 6);
  });

  it('nets debits against credits within the same account', () => {
    // A sales return (debit to revenue) must reduce revenue, not add to it.
    const withReturn = [...trialBalance, tx('Sales Revenue', 'revenue', 50_000, 'debit')];
    const adjusted = generateProfitAndLoss(withReturn, 'FY2024');
    expect(adjusted.totalRevenue).toBe(450_000);
    expect(adjusted.grossProfit).toBe(150_000);
  });

  it('does not divide by zero when there is no revenue', () => {
    const expenseOnly = [tx('Rent', 'operating_expense', 1_000, 'debit')];
    const r = generateProfitAndLoss(expenseOnly, 'FY2024');
    expect(r.totalRevenue).toBe(0);
    expect(r.grossMargin).toBe(0);
    expect(r.netMargin).toBe(0);
    expect(r.netIncome).toBe(-1_000);
  });
});

describe('Balance sheet', () => {
  const pnl = generateProfitAndLoss(trialBalance, 'FY2024');
  const bs = generateBalanceSheet(trialBalance, '2024-12-31', pnl.netIncome);

  it('totals assets from current and non-current sections', () => {
    expect(bs.totalCurrentAssets).toBe(230_000);
    expect(bs.totalNonCurrentAssets).toBe(150_000);
    expect(bs.totalAssets).toBe(380_000);
  });

  it('totals liabilities with the credit-normal sign convention', () => {
    expect(bs.totalCurrentLiabilities).toBe(100_000);
    expect(bs.totalNonCurrentLiabilities).toBe(80_000);
    expect(bs.totalLiabilities).toBe(180_000);
  });

  it('carries net income into equity as retained earnings', () => {
    const retained = bs.equity.find((e) => e.label.includes('Retained Earnings'));
    expect(retained?.amount).toBe(60_000);
    expect(bs.totalEquity).toBe(200_000);
  });

  it('balances: assets equal liabilities plus equity', () => {
    expect(bs.totalLiabilitiesAndEquity).toBe(380_000);
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
    expect(bs.isBalanced).toBe(true);
  });

  it('reports an unbalanced sheet when retained earnings are omitted', () => {
    const missing = generateBalanceSheet(trialBalance, '2024-12-31');
    expect(missing.totalEquity).toBe(140_000);
    expect(missing.isBalanced).toBe(false);
  });

  it('subtracts contra-assets from non-current assets', () => {
    const withDepreciation = [
      ...trialBalance,
      tx('Accumulated Depreciation', 'contra_asset', 50_000, 'credit', '2024-12-31'),
    ];
    const r = generateBalanceSheet(withDepreciation, '2024-12-31', 60_000);
    expect(r.totalNonCurrentAssets).toBe(100_000);
    expect(r.totalAssets).toBe(330_000);
  });
});

describe('Financial ratios', () => {
  const pnl = generateProfitAndLoss(trialBalance, 'FY2024');
  const bs = generateBalanceSheet(trialBalance, '2024-12-31', pnl.netIncome);
  const cf = generateCashFlow(trialBalance, 'FY2024', pnl.netIncome);
  const ratios = calculateFinancialRatios(pnl, bs, cf);

  it('computes margin ratios as percentages', () => {
    expect(ratios.grossMargin).toBeCloseTo(40, 6);
    expect(ratios.operatingMargin).toBeCloseTo(18, 6);
    expect(ratios.netProfitMargin).toBeCloseTo(12, 6);
  });

  it('computes liquidity ratios', () => {
    // 230,000 / 100,000
    expect(ratios.currentRatio).toBeCloseTo(2.3, 6);
    // (230,000 - 40,000 inventory - 10,000 prepaid) / 100,000
    expect(ratios.quickRatio).toBeCloseTo(1.8, 6);
  });

  it('computes leverage and return ratios', () => {
    expect(ratios.debtToEquity).toBeCloseTo(0.9, 6); // 180,000 / 200,000
    expect(ratios.debtToAssets).toBeCloseTo(47.37, 1); // 180,000 / 380,000
    expect(ratios.returnOnEquity).toBeCloseTo(30, 1); // 60,000 / 200,000
    expect(ratios.returnOnAssets).toBeCloseTo(15.79, 1); // 60,000 / 380,000
    expect(ratios.assetTurnover).toBeCloseTo(1.32, 2); // 500,000 / 380,000
  });

  it('returns null rather than Infinity when a denominator is zero', () => {
    const emptyPnl = generateProfitAndLoss([], 'FY2024');
    const emptyBs = generateBalanceSheet([], '2024-12-31');
    const emptyCf = generateCashFlow([], 'FY2024', 0);
    const r = calculateFinancialRatios(emptyPnl, emptyBs, emptyCf);
    expect(r.currentRatio).toBeNull();
    expect(r.debtToEquity).toBeNull();
    expect(r.returnOnAssets).toBeNull();
    expect(r.assetTurnover).toBeNull();
  });

  it('produces an interpretation for each populated ratio', () => {
    const notes = interpretRatios(ratios);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.description.length).toBeGreaterThan(0);
      expect(note.name.length).toBeGreaterThan(0);
    }
  });
});

describe('Cash flow statement', () => {
  const pnl = generateProfitAndLoss(trialBalance, 'FY2024');

  it('starts operating cash flow from net income', () => {
    const cf = generateCashFlow(trialBalance, 'FY2024', pnl.netIncome);
    expect(cf.operatingActivities[0].label).toBe('Net Income');
    expect(cf.operatingActivities[0].amount).toBe(60_000);
  });

  it('adds back depreciation as a non-cash expense', () => {
    const withDepreciation = [
      ...trialBalance,
      tx('Depreciation Expense', 'operating_expense', 25_000, 'debit'),
    ];
    const p = generateProfitAndLoss(withDepreciation, 'FY2024');
    const cf = generateCashFlow(withDepreciation, 'FY2024', p.netIncome);
    const addBack = cf.operatingActivities.find((i) => i.label.includes('Depreciation'));
    expect(addBack?.amount).toBe(25_000);
  });
});

describe('Account classification', () => {
  it('classifies common income statement accounts', () => {
    expect(classifyAccount('Sales Revenue')).toBe('revenue');
    expect(classifyAccount('Cost of Goods Sold')).toBe('cost_of_goods_sold');
    expect(classifyAccount('Rent Expense')).toBe('operating_expense');
  });

  it('classifies contra-asset accounts rather than the expense they resemble', () => {
    // 'depreciation' is an operating-expense keyword and appears in an earlier
    // rule; the more specific contra-asset keyword must win.
    expect(classifyAccount('Accumulated Depreciation')).toBe('contra_asset');
    expect(classifyAccount('Accumulated Amortization')).toBe('contra_asset');
    expect(classifyAccount('Allowance for Doubtful Accounts')).toBe('contra_asset');
    expect(classifyAccount('Allowance for Bad Debts')).toBe('contra_asset');
    // ...while the expense itself still classifies as an expense.
    expect(classifyAccount('Depreciation Expense')).toBe('operating_expense');
    expect(classifyAccount('Bad Debt Expense')).toBe('operating_expense');
  });

  it('prefers the most specific keyword when several rules match', () => {
    // 'tax' vs 'tax payable' -> the liability, not the expense.
    expect(classifyAccount('Income Tax Payable')).toBe('current_liability');
    // 'loan' variants: short-term vs long-term.
    expect(classifyAccount('Long-term Loan')).toBe('non_current_liability');
    expect(classifyAccount('Short-term Loan')).toBe('current_liability');
    // 'subscription' (expense) vs 'subscription income' (revenue).
    expect(classifyAccount('Subscription Income')).toBe('revenue');
    expect(classifyAccount('Software Subscription')).toBe('operating_expense');
  });

  it('falls back to operating expense for unrecognised accounts', () => {
    expect(classifyAccount('Zzz Unknown Ledger Account')).toBe('operating_expense');
  });

  it('honours an explicit category hint over the account name', () => {
    expect(classifyAccount('Miscellaneous', 'revenue')).toBe('revenue');
    expect(classifyAccount('Miscellaneous', 'contra asset')).toBe('contra_asset');
  });

  it('classifies common balance sheet accounts', () => {
    expect(classifyAccount('Cash at Bank')).toBe('current_asset');
    expect(classifyAccount('Accounts Payable')).toBe('current_liability');
    expect(classifyAccount('Share Capital')).toBe('equity');
  });
});
