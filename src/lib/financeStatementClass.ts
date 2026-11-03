// A file that says what each line is.
//
// Many exports carry a column that names the statement class of every line:
// "Income", "ContraIncome", "Expense", "InventoryInput", "Tax", "Other",
// "Asset", "Liability", "Equity". The importer used to read that column only
// as a debit/credit direction and then let keyword rules on the account NAME
// decide the category. The name rules are guesses, and on a real retail
// workbook they guessed wrong in ways the file had already ruled out:
//
//   "Credit Card Processing Fees" (Expense)       -> a liability ("credit card")
//   "Property Taxes"              (Expense)       -> a non-current asset ("property")
//   "Delivery & Handling Fees"    (Income)        -> a negative expense
//   "Loyalty Program Costs"       (Expense)       -> negative revenue
//   "Opening/Closing Inventory"   (InventoryInput) -> assets, and inventory counted twice
//   Tax written as negative amounts                -> tax ADDED to profit
//
// The rule here: **a declared class decides which statement a line belongs
// to; the name may only choose the line within that statement.** Directions
// follow the class too, including the sign conventions summary exports use.
//
// Only a column whose values are statement classes is read this way. A plain
// Income/Expense column in a cash ledger is a direction ("money in / money
// out") - a loan repayment typed "Expense" is not an operating expense - so a
// column of only Income/Expense values is left to the existing logic.

import type { AccountCategory } from './financeTypes';

export type StatementClass =
  | 'income'
  | 'contra_income'
  | 'expense'
  | 'cogs'
  | 'tax'
  | 'other'
  | 'asset'
  | 'liability'
  | 'equity';

const squash = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const CLASS_WORDS: Record<string, StatementClass> = {
  income: 'income', revenue: 'income', revenues: 'income', sales: 'income',
  contraincome: 'contra_income', contrarevenue: 'contra_income', contrasales: 'contra_income',
  expense: 'expense', expenses: 'expense', opex: 'expense', operatingexpense: 'expense', operatingexpenses: 'expense',
  cogs: 'cogs', costofsales: 'cogs', costofgoodssold: 'cogs', inventoryinput: 'cogs', inventoryinputs: 'cogs', cogsinput: 'cogs', cogsinputs: 'cogs',
  tax: 'tax', taxes: 'tax', incometax: 'tax', incometaxes: 'tax',
  other: 'other', otherincomeexpense: 'other', otherincomeandexpense: 'other', nonoperating: 'other',
  asset: 'asset', assets: 'asset',
  liability: 'liability', liabilities: 'liability',
  equity: 'equity', ownersequity: 'equity', shareholdersequity: 'equity', stockholdersequity: 'equity',
};

export const statementClassOf = (value: unknown): StatementClass | null => CLASS_WORDS[squash(value)] ?? null;

/**
 * Whether a column holds statement classes rather than directions: every
 * non-blank value is a class, and at least one is more than Income/Expense.
 */
export const isStatementClassColumn = (values: unknown[]): boolean => {
  let sawSpecific = false;
  let sawAny = false;
  for (const value of values) {
    if (value == null || String(value).trim() === '') continue;
    const cls = statementClassOf(value);
    if (!cls) return false;
    sawAny = true;
    if (cls !== 'income' && cls !== 'expense') sawSpecific = true;
  }
  return sawAny && sawSpecific;
};

const ALLOWED: Record<StatementClass, AccountCategory[]> = {
  income: ['revenue', 'other_income'],
  contra_income: ['revenue'],
  expense: ['operating_expense', 'cost_of_goods_sold', 'other_expense'],
  cogs: ['cost_of_goods_sold'],
  tax: ['tax'],
  other: ['other_income', 'other_expense'],
  asset: ['current_asset', 'non_current_asset', 'contra_asset'],
  liability: ['current_liability', 'non_current_liability'],
  equity: ['equity'],
};

const LONG_TERM = /non\s*-?\s*current|long\s*-?\s*term|fixed|non\s*-?\s*operating\s*asset/i;

/**
 * The category of a line of a declared class. `guess` is what the name and
 * section rules would choose; it is kept only when it is on the statement the
 * class names.
 */
export const categoryForClass = (
  cls: StatementClass,
  guess: AccountCategory,
  section: string,
  amount: number
): AccountCategory => {
  if (cls === 'other') return amount < 0 ? 'other_expense' : 'other_income';
  // A section heading is the file's own word too, and outranks a name guess:
  // "Rental Income" under "Sales Revenue" is revenue, not other income.
  if (cls === 'income') {
    if (/\bother\b|non\s*-?\s*operating/i.test(section)) return 'other_income';
    if (/revenue|sales|turnover/i.test(section)) return 'revenue';
  }
  if (cls === 'expense' && /\bcogs\b|cost of (sales|goods|revenue)/i.test(section)) return 'cost_of_goods_sold';
  if (ALLOWED[cls].includes(guess)) return guess;
  switch (cls) {
    case 'income':
    case 'contra_income':
      return 'revenue';
    case 'expense':
      return 'operating_expense';
    case 'cogs':
      return 'cost_of_goods_sold';
    case 'tax':
      return 'tax';
    case 'asset':
      return LONG_TERM.test(section) ? 'non_current_asset' : 'current_asset';
    case 'liability':
      return LONG_TERM.test(section) ? 'non_current_liability' : 'current_liability';
    case 'equity':
      return 'equity';
  }
};

const CLOSING_INVENTORY = /\b(closing|ending|end of (the )?(year|period))\b.*\binventor(y|ies)\b|\binventor(y|ies)\b.*\b(closing|ending)\b/i;

/**
 * Debit or credit for a line of a declared class.
 *
 * `classAllNegative`: every line of this class in the file is negative. In a
 * signed-P&L export (income +, expense -) that is how the file writes the
 * class, not a reversal of each line, so tax written as -1,850 is a 1,850
 * expense, not a 1,850 benefit.
 */
export const directionForClass = (
  cls: StatementClass,
  account: string,
  amount: number,
  classAllNegative: boolean
): 'debit' | 'credit' => {
  switch (cls) {
    case 'contra_income':
      // A return or discount reduces revenue whichever way the file signs it.
      return 'debit';
    case 'other':
      // Signed: income positive, expense negative.
      return amount < 0 ? 'debit' : 'credit';
    case 'cogs':
      // Periodic inventory: COGS = opening + purchases (+ costs) - closing.
      if (CLOSING_INVENTORY.test(account)) return amount < 0 ? 'debit' : 'credit';
      return amount < 0 ? 'credit' : 'debit';
    case 'expense':
    case 'tax':
      if (classAllNegative) return 'debit';
      return amount < 0 ? 'credit' : 'debit';
    case 'asset':
      return amount < 0 ? 'credit' : 'debit';
    case 'income':
    case 'liability':
    case 'equity':
      return amount < 0 ? 'debit' : 'credit';
  }
};
