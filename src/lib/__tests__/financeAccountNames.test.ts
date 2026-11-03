import { describe, expect, it } from 'vitest'
import { classifyByName } from '../financeAccountNames'
import { classifyAccount } from '../financeEngine'

// Account names as small and medium businesses write them, each labelled by
// hand with the statement an accountant would put it on. Not read off the
// engine. The first block is every misfiling measured on a real 116-line
// retail chart of accounts.

const LABELLED: Array<[string, string]> = [
  // Misfiled before, on the retail workbook
  ['Accrued Payroll', 'current_liability'],
  ['Lease Liabilities', 'non_current_liability'],
  ['Deferred Tax Liabilities', 'non_current_liability'],
  ['Pension Liabilities', 'non_current_liability'],
  ['Credit Card Processing Fees', 'operating_expense'],
  ['Property Taxes', 'operating_expense'],
  ['Membership / Subscription Revenue', 'revenue'],
  ['Vendor Advertising Allowances (Income)', 'revenue'],
  ['Scrap & Recycling Income', 'revenue'],
  ['Other Operating Income', 'revenue'],
  ['Gift Card Breakage Revenue', 'revenue'],
  ['Import Duties', 'cost_of_goods_sold'],
  ['Inventory Shrinkage', 'cost_of_goods_sold'],
  ['Obsolete Inventory Write-Off', 'cost_of_goods_sold'],
  ['Markdown Expense', 'cost_of_goods_sold'],
  ['Supplier Rebates', 'cost_of_goods_sold'],
  ['Purchase Returns', 'cost_of_goods_sold'],
  ['Leasehold Improvements', 'non_current_asset'],
  ['Intangible Assets (Software)', 'non_current_asset'],
  ['Insurance – General Liability', 'operating_expense'],

  // Revenue
  ['Sales', 'revenue'],
  ['Product Sales', 'revenue'],
  ['Service Revenue', 'revenue'],
  ['Consulting Income', 'revenue'],
  ['Fees Earned', 'revenue'],
  ['Sales Returns and Allowances', 'revenue'],
  ['Turnover', 'revenue'],

  // Cost of sales
  ['Cost of Goods Sold', 'cost_of_goods_sold'],
  ['Cost of Sales', 'cost_of_goods_sold'],
  ['Purchases', 'cost_of_goods_sold'],
  ['Freight Inwards', 'cost_of_goods_sold'],
  ['Carriage Inwards', 'cost_of_goods_sold'],
  ['Direct Labour', 'cost_of_goods_sold'],
  ['Raw Materials Used', 'cost_of_goods_sold'],

  // Operating expenses
  ['Salaries and Wages', 'operating_expense'],
  ['Rent Expense', 'operating_expense'],
  ['Rent', 'operating_expense'],
  ['Utilities', 'operating_expense'],
  ['Electricity', 'operating_expense'],
  ['Advertising', 'operating_expense'],
  ['Depreciation Expense', 'operating_expense'],
  ['Insurance Expense', 'operating_expense'],
  ['Office Supplies', 'operating_expense'],
  ['Bank Charges', 'operating_expense'],
  ['Bad Debt Expense', 'operating_expense'],
  ['Vehicle Expenses', 'operating_expense'],
  ['Equipment Rental Expense', 'operating_expense'],
  ['Repairs and Maintenance', 'operating_expense'],
  ['Telephone and Internet', 'operating_expense'],
  ['Professional Fees', 'operating_expense'],
  ['Payroll Taxes', 'operating_expense'],
  ['Employee Health Benefits', 'operating_expense'],
  ['Sales Salaries', 'operating_expense'],
  ['Software Subscriptions', 'operating_expense'],
  ['Mobile Money Charges', 'operating_expense'],
  ['Overtime Pay', 'operating_expense'],
  ['Outbound Transportation (Store Replenishment)', 'operating_expense'],
  ['Cloud Infrastructure', 'operating_expense'],
  ['Cybersecurity', 'operating_expense'],
  ['Marketplace Commission Revenue', 'revenue'],
  ['Discounts Received', 'other_income'],

  // Other income and expense, tax
  ['Interest Income', 'other_income'],
  ['Dividend Income', 'other_income'],
  ['Gain on Asset Disposal', 'other_income'],
  ['Rental Income', 'other_income'],
  ['Interest Expense', 'other_expense'],
  ['Loss on Sale of Equipment', 'other_expense'],
  ['Foreign Exchange Loss', 'other_expense'],
  ['Penalties and Fines', 'other_expense'],
  ['Income Tax Expense', 'tax'],
  ['Corporate Tax', 'tax'],
  ['Current Income Tax Expense', 'tax'],

  // Current assets
  ['Cash', 'current_asset'],
  ['Cash at Bank', 'current_asset'],
  ['Petty Cash', 'current_asset'],
  ['Cash & Cash Equivalents', 'current_asset'],
  ['Accounts Receivable', 'current_asset'],
  ['Trade Receivables', 'current_asset'],
  ['Interest Receivable', 'current_asset'],
  ['Loan Receivable', 'current_asset'],
  ['Inventory', 'current_asset'],
  ['Prepaid Expenses', 'current_asset'],
  ['Prepaid Insurance', 'current_asset'],
  ['Short-Term Investments', 'current_asset'],

  // Non-current assets
  ['Land', 'non_current_asset'],
  ['Buildings', 'non_current_asset'],
  ['Property, Plant & Equipment', 'non_current_asset'],
  ['Motor Vehicles', 'non_current_asset'],
  ['Furniture and Fixtures', 'non_current_asset'],
  ['Goodwill', 'non_current_asset'],
  ['Accumulated Depreciation', 'contra_asset'],
  ['Allowance for Doubtful Accounts', 'contra_asset'],

  // Liabilities
  ['Accounts Payable', 'current_liability'],
  ['Trade Payables', 'current_liability'],
  ['Accrued Expenses', 'current_liability'],
  ['Salaries Payable', 'current_liability'],
  ['Income Tax Payable', 'current_liability'],
  ['Sales Tax Payable', 'current_liability'],
  ['VAT Payable', 'current_liability'],
  ['Property Tax Payable', 'current_liability'],
  ['Unearned Revenue', 'current_liability'],
  ['Deferred Revenue', 'current_liability'],
  ['Customer Deposits', 'current_liability'],
  ['Bank Overdraft', 'current_liability'],
  ['Credit Card', 'current_liability'],
  ['Short-Term Debt', 'current_liability'],
  ['Current Portion of Long-Term Debt', 'current_liability'],
  ['Bank Loan', 'non_current_liability'],
  ['Long-Term Debt', 'non_current_liability'],
  ['Mortgage', 'non_current_liability'],
  ['Bonds Payable', 'non_current_liability'],

  // Equity
  ['Owner\'s Equity', 'equity'],
  ['Share Capital', 'equity'],
  ['Common Stock', 'equity'],
  ['Retained Earnings', 'equity'],
  ['Drawings', 'equity'],
  ['Dividends Paid', 'equity'],
  ['Opening Balance Equity', 'equity'],
]

describe('account names, as businesses write them', () => {
  it.each(LABELLED)('%s -> %s', (name, expected) => {
    expect(classifyByName(name)?.category).toBe(expected)
    // classifyAccount, with no other signal, agrees.
    expect(classifyAccount(name)).toBe(expected)
  })
})

describe('whole words only', () => {
  it('"rent" does not match inside "current"', () => {
    expect(classifyByName('Other Current Assets')?.category).toBe('current_asset')
  })
  it('"fine" does not match inside "refined"', () => {
    expect(classifyByName('Refined Oil Purchases')?.category).toBe('cost_of_goods_sold')
  })
})

describe('names that read two ways are flagged, not silently decided', () => {
  it.each(['Delivery & Handling Fees', 'Promotional Discounts', 'Opening Inventory', 'Closing Inventory', 'Commissions'])(
    '%s is ambiguous',
    (name) => {
      expect(classifyByName(name)?.basis).toBe('ambiguous')
    }
  )
  it.each(['Accounts Payable', 'Rent Expense', 'Interest Income', 'Marketplace Commission Revenue', 'Discounts Received'])('%s is not', (name) => {
    expect(classifyByName(name)?.basis).not.toBe('ambiguous')
  })
})

describe('a name that says nothing', () => {
  it('is left to the other signals', () => {
    expect(classifyByName('Account 4711')).toBeNull()
    expect(classifyByName('')).toBeNull()
  })
})
