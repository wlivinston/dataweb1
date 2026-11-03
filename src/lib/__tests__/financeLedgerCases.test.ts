import { describe, it, expect } from 'vitest';
import { generateFinancialReport, classifyAccount, reportWindow } from '../financeEngine';
import { transformLongDatasetToCanonical, canonicalToReportInput } from '../financeImportPipeline';
import { generateTrialBalance } from '../financeTrialBalance';
import { reconcileBank } from '../financeBankRecon';
import type { ReportPeriod } from '../financeTypes';

/**
 * Finance statements against ledgers worked out by hand - the finance
 * engine's equivalent of the Power BI parity sheets. Every expected figure
 * below was computed by hand from the journal, not read off the engine.
 */

type Line = [account: string, category: string, amount: number];
/** One journal entry: a debit line and a credit line. */
const j = (date: string, dr: Line, cr: Line) => [
  { Date: date, Account: dr[0], Category: dr[1], Debit: dr[2], Credit: '' },
  { Date: date, Account: cr[0], Category: cr[1], Debit: '', Credit: cr[2] },
];

const run = (rows: Record<string, unknown>[], period: ReportPeriod, asOfDate?: string, withCategory = true) => {
  const data = withCategory ? rows : rows.map(({ Category: _drop, ...rest }) => rest);
  const mapping = { date: 'Date', account: 'Account', debit: 'Debit', credit: 'Credit', ...(withCategory ? { category: 'Category' } : {}) };
  const canonical = transformLongDatasetToCanonical(data, mapping);
  const input = canonicalToReportInput(canonical.transactions);
  return generateFinancialReport(input.data, input.mapping, { period, companyName: 'Test Co', asOfDate });
};

const line = (items: { label: string; amount: number }[], label: string) => items.find(i => i.label === label)?.amount;

// ---------------------------------------------------------------------------
// A year of a small business.
//
//   Revenue          25,000 cash + 5,000 on credit          = 30,000
//   Gross profit     30,000 - 8,000 COGS                    = 22,000
//   Operating income 22,000 - (6,000 + 3,000 + 500)         = 12,500
//   Net income       12,500 - 1,200 interest                = 11,300
//   Cash  50,000 + 20,000 - 30,000 - 8,000 + 25,000 - 6,000 - 4,000 - 1,200 - 2,000 = 43,800
//   Assets 43,800 + 5,000 AR + (30,000 - 3,000)             = 75,800
//   L + E  16,000 loan + 500 AP + (50,000 - 2,000 + 11,300) = 75,800
//   Cash flow: operating 11,300 + 3,000 - 5,000 + 500 = 9,800; investing -30,000;
//              financing 20,000 - 4,000 + 50,000 - 2,000 = 64,000; change 43,800
// ---------------------------------------------------------------------------
const year = [
  ...j('2026-01-01', ['Cash', 'Current Asset', 50000], ["Owner's Capital", 'Equity', 50000]),
  ...j('2026-01-02', ['Cash', 'Current Asset', 20000], ['Bank Loan', 'Non-Current Liability', 20000]),
  ...j('2026-01-03', ['Equipment', 'Fixed Asset', 30000], ['Cash', 'Current Asset', 30000]),
  ...j('2026-01-10', ['Cost of Goods Sold', 'COGS', 8000], ['Cash', 'Current Asset', 8000]),
  ...j('2026-02-01', ['Cash', 'Current Asset', 25000], ['Sales Revenue', 'Revenue', 25000]),
  ...j('2026-02-15', ['Accounts Receivable', 'Current Asset', 5000], ['Sales Revenue', 'Revenue', 5000]),
  ...j('2026-03-31', ['Salaries Expense', 'Expense', 6000], ['Cash', 'Current Asset', 6000]),
  ...j('2026-06-30', ['Utilities Expense', 'Expense', 500], ['Accounts Payable', 'Current Liability', 500]),
  ...j('2026-09-30', ['Bank Loan', 'Non-Current Liability', 4000], ['Cash', 'Current Asset', 4000]),
  ...j('2026-09-30', ['Interest Expense', 'Other Expense', 1200], ['Cash', 'Current Asset', 1200]),
  ...j('2026-11-30', ["Owner's Drawings", 'Equity', 2000], ['Cash', 'Current Asset', 2000]),
  ...j('2026-12-31', ['Depreciation Expense', 'Expense', 3000], ['Accumulated Depreciation', 'Contra Asset', 3000]),
];

describe.each([
  ['with a category column', true],
  ['from account names alone', false],
])('a year of a small business, %s', (_label, withCategory) => {
  it('P&L', async () => {
    const { profitAndLoss: pl } = await run(year, 'annual', undefined, withCategory);
    expect([pl.totalRevenue, pl.totalCOGS, pl.grossProfit, pl.operatingIncome, pl.netIncome])
      .toEqual([30000, 8000, 22000, 12500, 11300]);
    expect(line(pl.otherExpenses, 'Interest Expense')).toBe(1200);
  });

  it('balance sheet', async () => {
    const { balanceSheet: bs } = await run(year, 'annual', undefined, withCategory);
    expect(line(bs.currentAssets, 'Cash')).toBe(43800);
    // A bank loan is a liability, not cash - and a long-term one.
    expect(line(bs.nonCurrentLiabilities, 'Bank Loan')).toBe(16000);
    expect(line(bs.currentLiabilities, 'Bank Loan')).toBeUndefined();
    expect([bs.totalAssets, bs.totalLiabilities, bs.totalEquity]).toEqual([75800, 16500, 59300]);
    expect(bs.isBalanced).toBe(true);
  });

  it('ratios', async () => {
    // By hand: gross 22,000/30,000; operating 12,500/30,000; net 11,300/30,000;
    // ROA 11,300/75,800; ROE 11,300/59,300; current 48,800/500;
    // debt/equity 16,500/59,300; debt/assets 16,500/75,800.
    const { ratios } = await run(year, 'annual', undefined, withCategory);
    expect(ratios).toMatchObject({
      grossMargin: 73.33, operatingMargin: 41.67, netProfitMargin: 37.67,
      returnOnAssets: 14.91, returnOnEquity: 19.06, currentRatio: 97.6,
      debtToEquity: 0.28, debtToAssets: 21.77,
    });
  });

  it('trial balance: account balances, debits equal credits at 99,500', async () => {
    // Debit balances 5,000 + 43,800 + 30,000 + 2,000 + 8,000 + 3,000 + 6,000 + 500 + 1,200;
    // credit balances 3,000 + 500 + 16,000 + 50,000 + 30,000.
    const report = await run(year, 'annual', undefined, withCategory);
    const tb = generateTrialBalance(report.transactions, report.balanceSheet.asOfDate);
    expect([tb.totalDebits, tb.totalCredits, tb.isBalanced]).toEqual([99500, 99500, true]);
  });

  it('cash flow', async () => {
    const { cashFlow: cf, balanceSheet: bs } = await run(year, 'annual', undefined, withCategory);
    expect([cf.netOperatingCashFlow, cf.netInvestingCashFlow, cf.netFinancingCashFlow]).toEqual([9800, -30000, 64000]);
    expect(cf.endingCash).toBe(line(bs.currentAssets, 'Cash'));
  });
});

// ---------------------------------------------------------------------------
// Two years and a later sale.
//
//   2025: capital 10,000; sales 4,000; rent 1,000  -> profit 3,000, cash 13,000
//   2026: equipment 2,000 (Mar); sales 6,000 (Jun); rent 1,500 (Dec)
//   2027-01-05: sale 999 - after the as-of date, never in the statements
//
//   Annual to 2026-12-31: P&L revenue 6,000, NI 4,500
//     cash 13,000 + 6,000 - 1,500 - 2,000 = 15,500; assets 15,500 + 2,000 = 17,500
//     equity 10,000 capital + 7,500 profit to date = 17,500
//     cash flow 13,000 -> 15,500
//   Monthly to 2026-12-31 (December): NI -1,500; cash 17,000 -> 15,500
// ---------------------------------------------------------------------------
const twoYears = [
  ...j('2025-01-01', ['Cash', 'Current Asset', 10000], ["Owner's Capital", 'Equity', 10000]),
  ...j('2025-05-01', ['Cash', 'Current Asset', 4000], ['Sales Revenue', 'Revenue', 4000]),
  ...j('2025-08-01', ['Rent Expense', 'Expense', 1000], ['Cash', 'Current Asset', 1000]),
  ...j('2026-03-01', ['Equipment', 'Fixed Asset', 2000], ['Cash', 'Current Asset', 2000]),
  ...j('2026-06-15', ['Cash', 'Current Asset', 6000], ['Sales Revenue', 'Revenue', 6000]),
  ...j('2026-12-20', ['Rent Expense', 'Expense', 1500], ['Cash', 'Current Asset', 1500]),
  ...j('2027-01-05', ['Cash', 'Current Asset', 999], ['Sales Revenue', 'Revenue', 999]),
];

describe('the period chosen is the period reported', () => {
  it('annual: this year in the P&L, earlier years carried into equity, later rows excluded', async () => {
    const report = await run(twoYears, 'annual', '2026-12-31');
    expect([report.profitAndLoss.totalRevenue, report.profitAndLoss.netIncome]).toEqual([6000, 4500]);
    expect(line(report.balanceSheet.currentAssets, 'Cash')).toBe(15500);
    expect([report.balanceSheet.totalAssets, report.balanceSheet.totalEquity]).toEqual([17500, 17500]);
    expect(report.balanceSheet.isBalanced).toBe(true);
    expect([report.cashFlow.beginningCash, report.cashFlow.endingCash]).toEqual([13000, 15500]);
    expect(report.warnings.join(' ')).toMatch(/2026-01-01 to 2026-12-31.*carried in.*after 2026-12-31 are not included/);
  });

  it('monthly: December only, cash brought forward from November', async () => {
    const report = await run(twoYears, 'monthly', '2026-12-31');
    expect(report.profitAndLoss.netIncome).toBe(-1500);
    expect([report.cashFlow.beginningCash, report.cashFlow.endingCash]).toEqual([17000, 15500]);
    expect(report.balanceSheet.isBalanced).toBe(true);
  });

  it('custom: everything', async () => {
    const report = await run(twoYears, 'custom');
    expect(report.profitAndLoss.totalRevenue).toBe(4000 + 6000 + 999);
  });

  it('defaults to the last period in the data, and quarters start where they should', () => {
    const txns = [{ date: '2026-02-10' }, { date: '2026-08-20' }];
    expect(reportWindow(txns, 'quarterly')).toMatchObject({ start: '2026-07-01', end: '2026-08-20', label: 'Q3 2026' });
    expect(reportWindow(txns, 'monthly')).toMatchObject({ start: '2026-08-01', label: 'August 2026' });
    expect(reportWindow([{ date: '10/02/2026' }], 'annual').all).toBe(true);
  });
});

describe('account classification', () => {
  it.each([
    ['Bank Loan', '', 'non_current_liability'],
    ['Term Loan', '', 'non_current_liability'],
    ['Short-term Loan', '', 'current_liability'],
    ['Loan Receivable', '', 'current_asset'],
    ['Cash at Bank', '', 'current_asset'],
    ['Interest Expense', 'Interest Expense', 'other_expense'],
    ['Mortgage', 'Non-Current Liability', 'non_current_liability'],
    ['Lease', 'Long-term Liabilities', 'non_current_liability'],
    ['Vendors', 'Current Liabilities', 'current_liability'],
    ['Trucks', 'Non-current assets', 'non_current_asset'],
  ])('%s (category "%s") is %s', (account, hint, expected) => {
    expect(classifyAccount(account, hint)).toBe(expected);
  });

  it('a specific account name outranks a generic word inside the category', () => {
    // "Finance Expenses" only contains the generic 'expense'; the name says interest.
    expect(classifyAccount('Interest Expense', 'Finance Expenses')).toBe('other_expense');
  });

  it('the account name passed as its own category does not make it an asset', () => {
    // With no category column the import passes the name as the hint; "asset"
    // inside "Asset Management Fees" must not file a fee as an asset.
    expect(classifyAccount('Asset Management Fees', 'Asset Management Fees', -250)).toBe('operating_expense');
  });
});

// ---------------------------------------------------------------------------
// Bank reconciliation for January, worked by hand.
//
//   Books:  +10,000 capital; -400 cheque 101; -250 cheque 102 (not yet cleared);
//           +1,500 deposit on the 31st (not yet at the bank)   -> 10,850
//   Bank:   +10,000; -400 cheque 101; -15 fee; +5 interest      ->  9,590
//   Adjusted bank 9,590 + 1,500 - 250 = 10,840
//   Adjusted book 10,850 - 15 + 5     = 10,840
// ---------------------------------------------------------------------------
describe('bank reconciliation', () => {
  const book = [
    ...j('2026-01-01', ['Cash at Bank', 'Current Asset', 10000], ["Owner's Capital", 'Equity', 10000]),
    ...j('2026-01-10', ['Rent Expense', 'Expense', 400], ['Cash at Bank', 'Current Asset', 400]),
    ...j('2026-01-28', ['Office Supplies', 'Expense', 250], ['Cash at Bank', 'Current Asset', 250]),
    ...j('2026-01-31', ['Cash at Bank', 'Current Asset', 1500], ['Sales Revenue', 'Revenue', 1500]),
  ];
  const bank = [
    { id: 'b1', date: '2026-01-01', description: 'Deposit', debit: 0, credit: 10000 },
    { id: 'b2', date: '2026-01-12', description: 'Cheque 101', debit: 400, credit: 0 },
    { id: 'b3', date: '2026-01-31', description: 'Monthly service fee', debit: 15, credit: 0 },
    { id: 'b4', date: '2026-01-31', description: 'Interest earned', debit: 0, credit: 5 },
  ];

  it('reconciles to 10,840 on both sides, naming each reconciling item', async () => {
    const report = await run(book, 'custom');
    const recon = reconcileBank(bank, report.transactions, { statementDate: '2026-01-31' });
    expect([recon.bookClosingBalance, recon.bankClosingBalance]).toEqual([10850, 9590]);
    expect([recon.adjustedBankBalance, recon.adjustedBookBalance, recon.isReconciled]).toEqual([10840, 10840, true]);
    expect(recon.depositsInTransit.map(m => m.amount)).toContain(1500);
    expect(recon.outstandingCheques.map(m => m.amount)).toContain(250);
    expect(recon.bankChargesUnrecorded).toHaveLength(1);
    expect(recon.bankCreditsUnrecorded).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Generated balancing rows are never assets.
//
// A summary export (each line one-sided, no counterparts) does not balance.
// The dashboard can add "System Clearing Account" offsets so a report can be
// shown anyway. Those offsets used to be booked as a current asset, so Total
// Assets became whatever balanced the sheet: on a real workbook, $13.04B of
// assets that do not exist.
//
//   Cash 85 (Dr) | AP 20, Loan 10, Stock 20 (Cr) | Revenue 100 (Cr), COGS 60 (Dr)
//   Real assets          85
//   Liabilities          30
//   Equity               20 stock + 40 net income  = 60
//   L + E - A            90 - 85                   = 5 unreconciled
// ---------------------------------------------------------------------------

describe('generated balancing rows', () => {
  const oneSided = (Account: string, Category: string, Debit: number | '', Credit: number | '') =>
    ({ Date: '2025-12-31', Account, Category, Debit, Credit });
  const summary = [
    oneSided('Cash', 'current_asset', 85, ''),
    oneSided('Accounts Payable', 'current_liability', '', 20),
    oneSided('Bank Loan', 'non_current_liability', '', 10),
    oneSided('Common Stock', 'equity', '', 20),
    oneSided('Sales Revenue', 'revenue', '', 100),
    oneSided('Cost of Goods Sold', 'cogs', 60, ''),
  ];
  // What the dashboard's per-row Opening Balance Initialization adds.
  const offsets = summary.map((row) => ({
    Date: row.Date,
    Account: 'System Clearing Account',
    Category: 'current_asset',
    Debit: row.Credit,
    Credit: row.Debit,
    SourceColumn: 'Single_Entry_Offset',
  }));
  const withOffsets = (rows: Record<string, unknown>[]) => {
    const mapping = { date: 'Date', account: 'Account', debit: 'Debit', credit: 'Credit', category: 'Category' };
    // The SourceColumn tag is how the engine knows a row was generated.
    return generateFinancialReport(rows, mapping, { period: 'annual' as ReportPeriod, companyName: 'Test Co' });
  };

  it('keeps them out of Total Assets and reports the difference instead', async () => {
    const report = await withOffsets([...summary, ...offsets]);
    const bs = report.balanceSheet;
    expect(bs.totalAssets).toBe(85);
    expect(line(bs.currentAssets, 'System Clearing Account')).toBeUndefined();
    expect(bs.totalLiabilities).toBe(30);
    expect(bs.totalEquity).toBe(60);
    expect(bs.isBalanced).toBe(false);
    expect(bs.unreconciledDifference).toBe(5);
  });

  it('leave the P&L alone', async () => {
    const report = await withOffsets([...summary, ...offsets]);
    expect(report.profitAndLoss.totalRevenue).toBe(100);
    expect(report.profitAndLoss.grossProfit).toBe(40);
  });

  it('a ledger that balances on its own has no difference line', async () => {
    const report = await withOffsets([
      oneSided('Cash', 'current_asset', 90, ''),
      oneSided('Common Stock', 'equity', '', 90),
    ]);
    expect(report.balanceSheet.isBalanced).toBe(true);
    expect(report.balanceSheet.unreconciledDifference).toBeUndefined();
  });
});
