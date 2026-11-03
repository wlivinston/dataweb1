import { describe, it, expect } from 'vitest';
import { parseMoney, sumMoney, toCents } from '../money';
import { readTransactions, generateFinancialReport } from '../financeEngine';
import { transformLongDatasetToCanonical, canonicalToReportInput } from '../financeImportPipeline';

/**
 * Money in the finance engine, checked against a ledger worked out by hand.
 *
 * The engine read amounts with `Number(cell) || 0`: "1,250.00", "$300.00" and
 * "(500)" became 0 and their rows vanished from the statements. The import
 * pipeline read "€1.250,00" as 1.25, and booked a negative debit (a reversal)
 * as more debit. Totals were float sums, so 0.1 + 0.2 was not 0.3.
 */

describe('parseMoney', () => {
  it.each([
    ['1,250.00', 1250],
    ['$300.00', 300],
    ['(500)', -500],
    ['500-', -500],
    ['-1,000.50', -1000.5],
    ['€1.250,00', 1250],
    ['12,50', 12.5],
    ['1,250', 1250],
    ['GH₵ 2,000', 2000],
    ['₦15,000.75', 15000.75],
    ['  42 ', 42],
    [42, 42],
  ])('reads %s as %s', (cell, expected) => {
    expect(parseMoney(cell)).toBe(expected);
  });

  it.each([[''], ['   '], [null], [undefined], ['N/A'], ['about 20'], ['1.2.3'], ['1,2345'], ['ERROR 5']])(
    'refuses %s rather than guess',
    cell => {
      expect(parseMoney(cell)).toBeNull();
    }
  );

  it('adds exactly to the cent', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(toCents(1.005)).toBe(101);
  });
});

// A small double-entry ledger, written the way accountants write numbers.
const ledger = [
  { date: '2026-01-01', account: 'Cash', category: 'Current Asset', debit: '10,000.00', credit: '' },
  { date: '2026-01-01', account: "Owner's Capital", category: 'Equity', debit: '', credit: '10,000.00' },
  { date: '2026-01-05', account: 'Cash', category: 'Current Asset', debit: '1,250.00', credit: '' },
  { date: '2026-01-05', account: 'Sales Revenue', category: 'Revenue', debit: '', credit: '1,250.00' },
  { date: '2026-01-10', account: 'Rent Expense', category: 'Expense', debit: '$400.00', credit: '' },
  { date: '2026-01-10', account: 'Cash', category: 'Current Asset', debit: '', credit: '$400.00' },
  // A refund, written as a negative credit to revenue and a negative debit to cash.
  { date: '2026-01-12', account: 'Sales Revenue', category: 'Revenue', debit: '', credit: '(50.00)' },
  { date: '2026-01-12', account: 'Cash', category: 'Current Asset', debit: '-50.00', credit: '' },
  // Three ten-cent sales: float sums drift here.
  ...[13, 14, 15].flatMap(day => [
    { date: `2026-01-${day}`, account: 'Cash', category: 'Current Asset', debit: '0.10', credit: '' },
    { date: `2026-01-${day}`, account: 'Sales Revenue', category: 'Revenue', debit: '', credit: '0.10' },
  ]),
];
const mapping = { date: 'date', account: 'account', category: 'category', debit: 'debit', credit: 'credit' };

// Worked by hand:
//   revenue  1,250.00 - 50.00 + 0.30          =  1,200.30
//   expenses 400.00
//   net income                                  =    800.30
//   cash     10,000 + 1,250 - 400 - 50 + 0.30  = 10,800.30
const report = (rows: Record<string, unknown>[]) => {
  const canonical = transformLongDatasetToCanonical(rows, mapping);
  const input = canonicalToReportInput(canonical.transactions);
  return { canonical, run: generateFinancialReport(input.data, input.mapping, { period: 'monthly', companyName: 'Test Co' }) };
};

describe('statements from a hand-worked ledger', () => {
  it('reads formatted amounts straight from the rows', () => {
    const { transactions, unreadableRows } = readTransactions(ledger, mapping);
    expect(unreadableRows).toEqual([]);
    expect(transactions).toHaveLength(ledger.length);
    const refund = transactions.find(t => t.account === 'Sales Revenue' && t.date === '2026-01-12');
    expect(refund).toMatchObject({ amount: 50, type: 'debit' });
  });

  it('produces the P&L worked by hand', async () => {
    const { profitAndLoss } = await report(ledger).run;
    expect(profitAndLoss.totalRevenue).toBe(1200.3);
    expect(profitAndLoss.totalOperatingExpenses).toBe(400);
    expect(profitAndLoss.netIncome).toBe(800.3);
  });

  it('produces cash worked by hand, and a balance sheet that balances', async () => {
    const { balanceSheet } = await report(ledger).run;
    const cash = balanceSheet.currentAssets.find(item => item.label === 'Cash');
    expect(cash?.amount).toBe(10800.3);
    expect(balanceSheet.isBalanced).toBe(true);
  });

  it('cash flow ends at the cash the balance sheet holds, not twice it', async () => {
    // Beginning cash was the ledger's whole cash movement - the ending balance -
    // with the change added on top: 21,600.60 for a business holding 10,800.30.
    const { cashFlow, balanceSheet } = await report(ledger).run;
    const cash = balanceSheet.currentAssets.find(item => item.label === 'Cash')?.amount;
    expect(cashFlow.beginningCash).toBe(0);
    expect(cashFlow.endingCash).toBe(10800.3);
    expect(cashFlow.endingCash).toBe(cash);
  });

  it('a row with an unreadable amount is reported, never silently dropped', async () => {
    const rows = [...ledger, { date: '2026-01-20', account: 'Misc Expense', category: 'Expense', debit: 'about 20', credit: '' }];
    const { canonical, run } = report(rows);
    expect(canonical.warnings.join(' ')).toMatch(/1 row\(s\) have an amount that could not be read/);
    const direct = readTransactions(rows, mapping);
    expect(direct.unreadableRows).toEqual([rows.length - 1]);
    // The rest of the statements are unaffected.
    expect((await run).profitAndLoss.netIncome).toBe(800.3);
  });
});
