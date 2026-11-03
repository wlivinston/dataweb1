import { describe, expect, it } from 'vitest'
import { generateFinancialReport } from '../financeEngine'
import { transformLongDatasetToCanonical, canonicalToReportInput, type CanonicalTransaction } from '../financeImportPipeline'
import { applyPlacementOverrides } from '../financePlacement'
import { validate_liability_journal } from '../financeAssetIngestion'
import type { ReportPeriod } from '../financeTypes'

// A summary with no class column: placement comes from names, and two lines
// cannot be placed with confidence.
//
//   Sales 1,000 (revenue, by name)        Delivery & Handling Fees 50 (reads two ways)
//   Rent Expense 300 (expense, by name)   Account 4711 80 (nothing says: guessed)
const rows = [
  { Account: 'Sales', Amount: 1000 },
  { Account: 'Delivery & Handling Fees', Amount: 50 },
  { Account: 'Rent Expense', Amount: -300 },
  { Account: 'Account 4711', Amount: 80 },
]
const mapping = { account: 'Account', amount: 'Amount' }
const journalOf = () => transformLongDatasetToCanonical(rows, mapping).transactions
const reportOf = (journal: CanonicalTransaction[]) => {
  const input = canonicalToReportInput(journal)
  return generateFinancialReport(input.data, input.mapping, { period: 'custom' as ReportPeriod, companyName: 'Test Co' })
}

describe('where each line went', () => {
  it('records the basis of every account, weakest first', async () => {
    const placement = (await reportOf(journalOf())).linePlacement!
    const basisOf = Object.fromEntries(placement.map(line => [line.account, line.basis]))
    expect(basisOf).toEqual({
      'Account 4711': 'guess',
      'Delivery & Handling Fees': 'name-ambiguous',
      'Rent Expense': 'name',
      Sales: 'name',
    })
    expect(placement[0].account).toBe('Account 4711')
  })

  it('one guessed line is not hidden by a sibling the file placed', async () => {
    const mixed = [
      { Account: 'Account 4711', Category: 'revenue', Amount: 10 },
      { Account: 'Account 4711', Category: '', Amount: 20 },
    ]
    const journal = transformLongDatasetToCanonical(mixed, { account: 'Account', category: 'Category', amount: 'Amount' }).transactions
    const [line] = (await reportOf(journal)).linePlacement!
    expect([line.account, line.category, line.lines, line.basis]).toEqual(['Account 4711', 'revenue', 2, 'guess'])
  })

  it('a class column places lines by the file', async () => {
    const declared = [
      { RecordType: 'Income', Section: 'Sales Revenue', Account: 'Delivery & Handling Fees', Amount: 50 },
      { RecordType: 'Asset', Section: 'Current Assets', Account: 'Cash', Amount: 50 },
    ]
    const journal = transformLongDatasetToCanonical(declared, { account: 'Account', category: 'Section', type: 'RecordType', amount: 'Amount' }).transactions
    const placement = (await reportOf(journal)).linePlacement!
    expect(placement.map(line => line.basis)).toEqual(['file', 'file'])
  })
})

describe('moving a line', () => {
  it('moves a single-amount line to the new statement on its normal side', async () => {
    const before = await reportOf(journalOf())
    const fees = (items: { label: string; amount: number }[]) => items.find(i => i.label === 'Delivery & Handling Fees')?.amount
    // By name it was taken as an expense...
    expect(fees(before.profitAndLoss.operatingExpenses)).toBeDefined()

    const after = await reportOf(applyPlacementOverrides(journalOf(), { 'Delivery & Handling Fees': 'revenue' }))
    // ...moved, it is +50 of revenue, not -50.
    expect(fees(after.profitAndLoss.revenue)).toBe(50)
    expect(fees(after.profitAndLoss.operatingExpenses)).toBeUndefined()
    expect(after.linePlacement!.find(l => l.account === 'Delivery & Handling Fees')!.basis).toBe('file')
  })

  it('a negative single amount takes the opposite side', () => {
    const [moved] = applyPlacementOverrides(journalOf().filter(r => r.Account === 'Rent Expense'), { 'Rent Expense': 'revenue' })
    // -300 as revenue is a 300 debit to revenue (a reduction), as the file signed it.
    expect([moved.Debit, moved.Credit]).toEqual([300, 0])
  })

  it('a line from Debit/Credit columns keeps the side the file gave it', () => {
    const journal = transformLongDatasetToCanonical(
      [{ Date: '2025-01-01', Account: 'Misc', Debit: 40, Credit: '' }],
      { date: 'Date', account: 'Account', debit: 'Debit', credit: 'Credit' }
    ).transactions
    const [moved] = applyPlacementOverrides(journal, { Misc: 'revenue' })
    expect([moved.Category, moved.Debit, moved.Credit]).toEqual(['revenue', 40, 0])
  })

  it('moving twice is the same as moving once', () => {
    const once = applyPlacementOverrides(journalOf(), { 'Account 4711': 'other_income' })
    const twice = applyPlacementOverrides(once, { 'Account 4711': 'other_income' })
    expect(twice).toEqual(once)
  })
})

describe('a file with no category column', () => {
  it('is not blocked because a liability name contains "tax"', () => {
    const journal = transformLongDatasetToCanonical(
      [{ Account: 'Sales Tax Payable', Amount: 120 }, { Account: 'Deferred Tax Liabilities', Amount: 300 }],
      mapping
    ).transactions
    expect(validate_liability_journal(journal).errors).toEqual([])
  })
})
