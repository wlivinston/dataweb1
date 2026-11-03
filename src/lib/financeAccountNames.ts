// What an account NAME says about its statement, for files that say nothing
// else (no class column, no usable section).
//
// The old rules matched keywords as substrings, longest first. Measured on a
// real 116-line retail chart of accounts, they misfiled 22 lines by name:
//
//   substrings    'rent' inside "cur-rent", 'fine' inside "re-fine-d"
//   plurals       "Lease Liabilities", "Pension Liabilities" matched nothing
//                 and fell to the default: an operating EXPENSE
//   precedence    "Accrued Payroll" -> expense ('payroll' tied 'accrued')
//                 "Credit Card Processing Fees" -> liability ('credit card')
//                 "Property Taxes" -> non-current asset ('property')
//   vocabulary    import duties, shrinkage, markdowns, supplier rebates,
//                 leasehold improvements: unknown
//
// Now: whole words only (with plurals), and a fixed precedence that follows
// how accountants name accounts. The word that decides the statement is the
// one that names the KIND of account - "payable", "accrued", "receivable",
// "expense", "fees", "revenue" - not the thing it is about ("property",
// "credit card", "payroll").
//
// Each answer carries how it was reached. 'ambiguous' marks names that read
// either way ("Delivery Fees" may be charged or paid); the report flags them
// so a person can confirm, instead of the engine silently picking one.

import type { AccountCategory } from './financeTypes';

export type NameBasis = 'kind-word' | 'keyword' | 'ambiguous';

export interface NameClassification {
  category: AccountCategory;
  basis: NameBasis;
}

/** Lowercase words separated by single spaces; "Non-Current" -> "non current". */
export const normaliseAccountName = (text: string): string =>
  ` ${String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map<string, RegExp>();

/** Whole-word match, each word allowed a plural ending ("liabilities", "fees"). */
const pattern = (keyword: string): RegExp => {
  let cached = patternCache.get(keyword);
  if (!cached) {
    const words = normaliseAccountName(keyword).trim().split(' ');
    const body = words
      .map(word => {
        const stem = word.endsWith('y') ? `${escapeRegExp(word.slice(0, -1))}(?:y|ies)` : `${escapeRegExp(word)}(?:s|es)?`;
        return stem;
      })
      .join(' ');
    cached = new RegExp(` ${body} `);
    patternCache.set(keyword, cached);
  }
  return cached;
};

const hasAny = (name: string, keywords: readonly string[]) => keywords.some(keyword => pattern(keyword).test(name));

/** The longest keyword of any listed category found in the name. */
const longestMatch = (name: string, rules: ReadonlyArray<[AccountCategory, readonly string[]]>): AccountCategory | null => {
  let best: AccountCategory | null = null;
  let bestLength = 0;
  for (const [category, keywords] of rules) {
    for (const keyword of keywords) {
      if (keyword.length > bestLength && pattern(keyword).test(name)) {
        best = category;
        bestLength = keyword.length;
      }
    }
  }
  return best;
};

// --- Kind words: they name what sort of account this is. -------------------

const CONTRA_ASSET = ['accumulated depreciation', 'accumulated amortization', 'accumulated amortisation', 'allowance for doubtful', 'allowance for bad debt', 'provision for depreciation', 'provision for doubtful'];
const ASSET_KIND = ['receivable', 'prepaid', 'prepayment', 'deposit paid', 'security deposit', 'advance to supplier', 'advances to supplier'];
const LIABILITY_KIND = ['payable', 'accrued', 'accrual', 'liability', 'unearned', 'deferred revenue', 'deferred income', 'overdraft', 'customer deposit', 'customer advance', 'advance from customer', 'gift card liability'];
const NON_CURRENT_LIABILITY = ['long term', 'non current', 'mortgage', 'bond', 'debenture', 'lease liability', 'pension', 'deferred tax liability', 'term loan', 'long term loan', 'long term debt', 'long term note'];
const CURRENT_LIABILITY_OVERRIDE = ['current portion', 'short term'];

const TAX = ['income tax', 'tax expense', 'corporate tax', 'tax provision', 'provision for tax', 'deferred tax expense', 'company tax'];
const COGS = ['cost of goods', 'cogs', 'cost of sales', 'cost of revenue', 'direct material', 'direct labor', 'direct labour', 'manufacturing cost', 'production cost', 'raw material', 'purchase', 'freight in', 'freight inward', 'carriage inward', 'import duty', 'customs duty', 'inventory shrinkage', 'shrinkage', 'inventory write off', 'inventory write down', 'obsolete inventory', 'markdown', 'supplier rebate', 'purchase return', 'purchase discount', 'purchase allowance'];
const OTHER_INCOME = ['discount received', 'gain on', 'interest income', 'interest received', 'dividend income', 'dividend received', 'gain on sale', 'gain on disposal', 'other income', 'miscellaneous income', 'sundry income', 'rental income', 'foreign exchange gain', 'fx gain', 'investment income'];
const OTHER_EXPENSE = ['loss on', 'interest expense', 'interest paid', 'finance cost', 'loss on sale', 'loss on disposal', 'other expense', 'miscellaneous expense', 'sundry expense', 'foreign exchange loss', 'fx loss', 'penalty', 'fine', 'restructuring', 'impairment'];
// "Discounts" alone are usually discounts allowed to customers: a reduction
// of revenue. Marked ambiguous, since discounts received reduce cost.
const REVENUE_KIND = ['revenue', 'income', 'turnover', 'fees earned', 'commission earned', 'commission income', 'breakage', 'discount', 'discount allowed', 'sales discount'];
const EXPENSE_KIND = ['expense', 'fee', 'cost', 'charge', 'tax', 'insurance'];
const OPEX = ['salary', 'salaries', 'wage', 'payroll', 'overtime', 'transportation', 'cloud', 'hosting', 'cybersecurity', 'it services', 'returns processing', 'bonus', 'benefit', 'pension contribution', 'retirement contribution', 'workers compensation', 'rent', 'lease expense', 'utility', 'electricity', 'water', 'gas', 'heating', 'marketing', 'advertising', 'promotion', 'depreciation', 'amortization', 'amortisation', 'insurance', 'office supplies', 'office expense', 'stationery', 'travel', 'professional fees', 'legal fees', 'audit fees', 'accounting fees', 'consulting fees', 'software', 'maintenance', 'repair', 'telephone', 'internet', 'telecommunication', 'postage', 'printing', 'training', 'subscription', 'cleaning', 'janitorial', 'security', 'entertainment', 'meals', 'fuel', 'transport', 'delivery', 'shipping', 'courier', 'logistics', 'commission expense', 'sales commission', 'commission', 'bad debt', 'bank charges', 'bank fees', 'recruiting', 'uniform', 'pest control', 'waste', 'supplies', 'packaging'];
const SALES = ['sales', 'sale of goods', 'product sales'];

// --- Balance-sheet things, consulted only when no kind word decided. -------

const BALANCE_THINGS: ReadonlyArray<[AccountCategory, readonly string[]]> = [
  ['current_asset', ['cash', 'cash in hand', 'cash at bank', 'cash and cash equivalents', 'bank', 'petty cash', 'inventory', 'stock in trade', 'merchandise inventory', 'short term investment', 'marketable securities', 'treasury bill']],
  ['non_current_asset', ['property', 'plant', 'equipment', 'vehicle', 'fleet', 'building', 'land', 'furniture', 'fixture', 'leasehold', 'leasehold improvement', 'intangible', 'goodwill', 'patent', 'trademark', 'long term investment', 'capital work in progress', 'computer hardware', 'machinery', 'right of use asset']],
  ['current_liability', ['credit card', 'short term loan', 'short term debt', 'current portion']],
  ['non_current_liability', ['loan', 'bank loan', 'borrowing', 'debt', 'mortgage', 'bond', 'debenture']],
  ['equity', ['equity', 'owner equity', 'owners equity', 'retained earnings', 'capital', 'common stock', 'ordinary shares', 'share capital', 'paid in capital', 'additional paid in', 'drawings', 'dividends paid', 'dividends declared', 'dividend', 'treasury stock', 'accumulated other comprehensive', 'reserve', 'share premium', 'opening balance equity']],
];

/** Names that honestly read two ways; the report asks a person. */
const AMBIGUOUS = ['delivery fee', 'delivery and handling fee', 'handling fee', 'service fee', 'discount', 'rebate', 'opening inventory', 'closing inventory', 'beginning inventory', 'ending inventory', 'opening stock', 'closing stock', 'commission'];

const SETTLES_AMBIGUITY = ['revenue', 'income', 'earned', 'received', 'allowed', 'expense', 'paid', 'payable', 'receivable', 'sales discount', 'purchase discount'];

const liabilityTerm = (name: string, otherwise: AccountCategory = 'current_liability'): AccountCategory =>
  hasAny(name, CURRENT_LIABILITY_OVERRIDE) ? 'current_liability'
    : hasAny(name, NON_CURRENT_LIABILITY) ? 'non_current_liability'
      : otherwise;

/** The statement an account name points to, or null when it says nothing. */
export const classifyByName = (accountName: string): NameClassification | null => {
  const name = normaliseAccountName(accountName);
  if (name.trim() === '') return null;
  // A two-way word is settled by a word that says which way:
  // "Marketplace Commission Revenue" is revenue; "Commissions" alone is not clear.
  const ambiguous = hasAny(name, AMBIGUOUS) && !hasAny(name, SETTLES_AMBIGUITY);
  const answer = (category: AccountCategory, basis: NameBasis): NameClassification => ({
    category,
    basis: ambiguous ? 'ambiguous' : basis,
  });

  // 1. Contra assets, then words that make an account an asset or a liability.
  if (hasAny(name, CONTRA_ASSET)) return answer('contra_asset', 'kind-word');
  if (hasAny(name, ASSET_KIND) && !hasAny(name, ['payable'])) return answer('current_asset', 'kind-word');
  const insurancePremium = hasAny(name, ['insurance']) && !hasAny(name, ['payable', 'accrued', 'accrual']);
  if (hasAny(name, LIABILITY_KIND) && !insurancePremium) return answer(liabilityTerm(name), 'kind-word');

  // 2. Profit and loss: taxes on income, cost of sales, other income/expense,
  //    then what kind of P&L line the name declares.
  if (hasAny(name, TAX)) return answer('tax', 'kind-word');
  if (hasAny(name, COGS)) return answer('cost_of_goods_sold', 'keyword');
  const other = longestMatch(name, [['other_income', OTHER_INCOME], ['other_expense', OTHER_EXPENSE]]);
  if (other) return answer(other, 'keyword');
  if (hasAny(name, REVENUE_KIND) && !hasAny(name, ['expense'])) return answer('revenue', 'kind-word');
  if (hasAny(name, EXPENSE_KIND)) return answer('operating_expense', 'kind-word');
  // "Intangible Assets (Software)": the kind word is "assets", not "software".
  if (hasAny(name, ['asset'])) {
    const thingOf = longestMatch(name, BALANCE_THINGS);
    const longTerm = thingOf === 'non_current_asset' || hasAny(name, ['fixed', 'non current', 'long term']);
    return answer(longTerm ? 'non_current_asset' : 'current_asset', 'kind-word');
  }
  if (hasAny(name, OPEX)) return answer('operating_expense', 'keyword');
  if (hasAny(name, SALES)) return answer('revenue', 'keyword');

  // 3. What the account is about, when nothing said what kind it is.
  const thing = longestMatch(name, BALANCE_THINGS);
  // A loan or borrowing is long-term unless the name says otherwise.
  if (thing === 'current_liability' || thing === 'non_current_liability') return answer(liabilityTerm(name, thing), 'keyword');
  if (thing) return answer(thing, 'keyword');

  return null;
};
