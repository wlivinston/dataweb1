import type { MeasureSlot, MeasureTemplate } from './types';

/**
 * The measure library.
 *
 * Each entry is a business question with a DAX answer, written once against
 * placeholder slots and bound to whatever columns a model actually has.
 *
 * Two rules run through all of them. Nothing names a currency, because the
 * model does not carry one and a figure wearing the wrong symbol is worse
 * than an unlabelled one. And nothing states a judgement the data cannot
 * support - an interpretation says what the number is and what it is made
 * of, not whether it is good, because "a 3% margin is poor" is false for a
 * wholesaler and true for a consultancy.
 */

// ============================================================
// Reusable slots
// ============================================================

const MONEY_WORDS = ['amount', 'revenue', 'sales', 'total', 'value', 'price', 'turnover'];
const COST_WORDS = ['cost', 'cogs', 'expense', 'spend', 'purchase'];

const amountSlot = (describes = 'amount being measured'): MeasureSlot => ({
  name: 'amount',
  role: 'measure',
  dataType: 'number',
  prefers: MONEY_WORDS,
  // A cost column summed as revenue would read as a healthy total.
  avoids: [...COST_WORDS, 'discount', 'tax', 'qty', 'quantity'],
  describes,
});

const costSlot: MeasureSlot = {
  name: 'cost',
  role: 'measure',
  dataType: 'number',
  prefers: COST_WORDS,
  avoids: ['revenue', 'sales', 'price'],
  describes: 'cost being deducted',
};

const quantitySlot: MeasureSlot = {
  name: 'quantity',
  role: 'measure',
  dataType: 'number',
  prefers: ['quantity', 'qty', 'units', 'count', 'volume', 'pieces'],
  avoids: [...MONEY_WORDS, ...COST_WORDS],
  describes: 'quantity',
};

const customerSlot: MeasureSlot = {
  name: 'customer',
  role: ['key', 'foreignKey'],
  prefers: ['customer', 'client', 'account', 'buyer', 'member'],
  describes: 'column identifying the customer',
};

const orderSlot: MeasureSlot = {
  name: 'order',
  role: ['key', 'foreignKey'],
  prefers: ['order', 'invoice', 'transaction', 'receipt', 'sale', 'ticket'],
  avoids: ['customer', 'product', 'line'],
  describes: 'column identifying the order',
};

const productSlot: MeasureSlot = {
  name: 'product',
  role: ['key', 'foreignKey', 'dimension'],
  prefers: ['product', 'item', 'sku', 'article', 'part'],
  describes: 'column identifying the product',
};

// ============================================================
// Helpers for interpretation
// ============================================================

const columnName = (context: { bindings: Record<string, { name: string }> }, slot: string) =>
  context.bindings[slot]?.name ?? slot;

/** BLANK means no rows matched, which is not the same as a total of zero. */
const blankNote = (what: string) =>
  `No rows contributed to ${what}, so there is no total to report - which is not the same as a total of zero.`;

// ============================================================
// Sales
// ============================================================

const SALES: MeasureTemplate[] = [
  {
    id: 'total-revenue',
    name: 'Total Revenue',
    pack: 'sales',
    description: 'Everything sold, across whatever is currently in scope.',
    dax: 'SUM({amount})',
    slots: [amountSlot('revenue column')],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? blankNote('revenue')
        : `${context.formatted} in total ${columnName(context, 'amount')}, summed over every row of ${context.table} in scope.`,
  },
  {
    id: 'order-count',
    name: 'Order Count',
    pack: 'sales',
    description: 'How many distinct orders, not how many rows.',
    dax: 'DISTINCTCOUNT({order})',
    slots: [orderSlot],
    format: 'integer',
    interpret: (value, context) =>
      value === null
        ? blankNote('the order count')
        : `${context.formatted} distinct ${columnName(context, 'order')} values. Counting rows instead would multiply this by the number of lines per order.`,
  },
  {
    id: 'average-order-value',
    name: 'Average Order Value',
    pack: 'sales',
    description: 'Revenue divided by the number of distinct orders.',
    dax: 'DIVIDE(SUM({amount}), DISTINCTCOUNT({order}))',
    slots: [amountSlot('revenue column'), orderSlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? 'There were no orders to average over.'
        : `Each order is worth ${context.formatted} on average. This divides by distinct ${columnName(context, 'order')} values, so an order split across several lines still counts once.`,
  },
  {
    id: 'units-sold',
    name: 'Units Sold',
    pack: 'sales',
    description: 'Total quantity, separate from what it was worth.',
    dax: 'SUM({quantity})',
    slots: [quantitySlot],
    format: 'integer',
    interpret: (value, context) =>
      value === null
        ? blankNote('units sold')
        : `${context.formatted} units, summed from ${columnName(context, 'quantity')}.`,
  },
  {
    id: 'average-unit-price',
    name: 'Average Unit Price',
    pack: 'sales',
    description: 'Revenue per unit, which is not the average of the prices.',
    dax: 'DIVIDE(SUM({amount}), SUM({quantity}))',
    slots: [amountSlot('revenue column'), quantitySlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? 'No units were sold, so there is no price per unit.'
        : `${context.formatted} per unit. This is total revenue over total units, which weights each sale by its size - it is not the average of the individual prices, and the two differ whenever order sizes vary.`,
  },
];

// ============================================================
// Finance
// ============================================================

const FINANCE: MeasureTemplate[] = [
  {
    id: 'gross-profit',
    name: 'Gross Profit',
    pack: 'finance',
    description: 'Revenue less the cost of what was sold.',
    dax: 'SUM({amount}) - SUM({cost})',
    slots: [amountSlot('revenue column'), costSlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? blankNote('gross profit')
        : `${context.formatted} left after taking ${columnName(context, 'cost')} off ${columnName(context, 'amount')}. This covers direct costs only - anything not in that column is still to come out.`,
  },
  {
    id: 'gross-margin-percent',
    name: 'Gross Margin %',
    pack: 'finance',
    description: 'Gross profit as a share of revenue.',
    dax: 'DIVIDE(SUM({amount}) - SUM({cost}), SUM({amount}))',
    slots: [amountSlot('revenue column'), costSlot],
    format: 'percent',
    interpret: (value, context) => {
      if (value === null) return 'There was no revenue to take a margin on.';
      const share = typeof value === 'number' ? Math.round(value * 1000) / 10 : null;
      const perHundred =
        share === null ? '' : ` For every 100 of revenue, ${share.toFixed(1)} is left after direct cost.`;
      return `${context.formatted} gross margin.${perHundred} What counts as healthy depends entirely on the trade, so this says what the number is rather than whether it is where you want it.`;
    },
  },
  {
    id: 'total-cost',
    name: 'Total Cost',
    pack: 'finance',
    description: 'The cost side on its own.',
    dax: 'SUM({cost})',
    slots: [costSlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? blankNote('cost')
        : `${context.formatted} of ${columnName(context, 'cost')} in scope.`,
  },
];

// ============================================================
// Customer
// ============================================================

const CUSTOMER: MeasureTemplate[] = [
  {
    id: 'customer-count',
    name: 'Customer Count',
    pack: 'customer',
    description: 'How many distinct customers appear.',
    dax: 'DISTINCTCOUNT({customer})',
    slots: [customerSlot],
    format: 'integer',
    interpret: (value, context) =>
      value === null
        ? blankNote('the customer count')
        : `${context.formatted} distinct ${columnName(context, 'customer')} values in scope. This counts who appears in the data, which is not the same as who is still active.`,
  },
  {
    id: 'revenue-per-customer',
    name: 'Revenue per Customer',
    pack: 'customer',
    description: 'Revenue divided by distinct customers.',
    dax: 'DIVIDE(SUM({amount}), DISTINCTCOUNT({customer}))',
    slots: [amountSlot('revenue column'), customerSlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? 'There were no customers to divide by.'
        : `${context.formatted} per customer on average. An average hides the spread: a handful of large accounts can carry this figure while most customers sit well below it.`,
  },
  {
    id: 'orders-per-customer',
    name: 'Orders per Customer',
    pack: 'customer',
    description: 'How often a customer buys, on average.',
    dax: 'DIVIDE(DISTINCTCOUNT({order}), DISTINCTCOUNT({customer}))',
    slots: [orderSlot, customerSlot],
    format: 'ratio',
    interpret: (value, context) =>
      value === null
        ? 'There were no customers to divide by.'
        : `${context.formatted} orders per customer over the period in scope. Widen or narrow the date range and this moves, because it is a count over a window rather than a rate.`,
  },
];

// ============================================================
// Time intelligence
//
// Offered only when the bound table is actually joined to the calendar.
// Without that join TOTALYTD still returns a number - the grand total -
// which is the most dangerous kind of wrong.
// ============================================================

const TIME: MeasureTemplate[] = [
  {
    id: 'revenue-ytd',
    name: 'Revenue Year to Date',
    pack: 'sales',
    description: 'Accumulated from the start of the calendar year.',
    dax: 'TOTALYTD(SUM({amount}), {calendar})',
    slots: [amountSlot('revenue column')],
    needsCalendar: true,
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? blankNote('year to date')
        : `${context.formatted} accumulated since 1 January of the year in scope. This uses the calendar year; a business running to a different year end needs the fiscal variant.`,
  },
  {
    id: 'revenue-prior-year',
    name: 'Revenue Previous Year',
    pack: 'sales',
    description: 'The full year before the latest one in scope.',
    // Anchored to a year rather than written as a bare SAMEPERIODLASTYEAR.
    // Unanchored, the comparison silently spans every year the data holds,
    // and the measure reports a whole-history total as though it were one
    // period. LatestYear is evaluated in the surrounding context, so with no
    // filter this is the last year in the data and under a year slicer it
    // follows the slicer instead of overriding it.
    dax:
      'VAR LatestYear = YEAR(MAX({calendar}))\n' +
      'RETURN CALCULATE(SUM({amount}), {calendar:year} = LatestYear - 1)',
    slots: [amountSlot('revenue column')],
    needsCalendar: true,
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? 'There is nothing in the data for the year before the one in scope.'
        : `${context.formatted} over the whole of the year before the latest one in scope. Compared against a part-finished current year this will always look larger.`,
  },
  {
    id: 'revenue-yoy-percent',
    name: 'Revenue Growth YoY %',
    pack: 'sales',
    description: 'The latest year in scope against the one before it.',
    dax:
      'VAR LatestYear = YEAR(MAX({calendar}))\n' +
      'VAR ThisYear = CALCULATE(SUM({amount}), {calendar:year} = LatestYear)\n' +
      'VAR PriorYear = CALCULATE(SUM({amount}), {calendar:year} = LatestYear - 1)\n' +
      'RETURN DIVIDE(ThisYear - PriorYear, PriorYear)',
    slots: [amountSlot('revenue column')],
    needsCalendar: true,
    format: 'percent',
    interpret: (value, context) => {
      if (value === null) {
        return 'The earlier year is blank, so there is no growth rate - a percentage against nothing is not a number.';
      }
      const direction = typeof value === 'number' && value < 0 ? 'down' : 'up';
      return `${direction} ${context.formatted}, comparing the latest year in scope against the whole of the one before. If the latest year is still running, it is being measured against a complete one and will understate.`;
    },
  },
];

// ============================================================
// Inventory and operations
// ============================================================

const INVENTORY: MeasureTemplate[] = [
  {
    id: 'product-count',
    name: 'Products Sold',
    pack: 'inventory',
    description: 'How many distinct products appear.',
    dax: 'DISTINCTCOUNT({product})',
    slots: [productSlot],
    format: 'integer',
    interpret: (value, context) =>
      value === null
        ? blankNote('the product count')
        : `${context.formatted} distinct ${columnName(context, 'product')} values in scope. Products never sold do not appear here at all.`,
  },
  {
    id: 'revenue-per-product',
    name: 'Revenue per Product',
    pack: 'inventory',
    description: 'Revenue divided by distinct products.',
    dax: 'DIVIDE(SUM({amount}), DISTINCTCOUNT({product}))',
    slots: [amountSlot('revenue column'), productSlot],
    format: 'currency',
    interpret: (value, context) =>
      value === null
        ? 'There were no products to divide by.'
        : `${context.formatted} per product on average. Ranges usually follow a steep curve, so the typical product earns far less than this.`,
  },
];

const OPERATIONS: MeasureTemplate[] = [
  {
    id: 'row-count',
    name: 'Record Count',
    pack: 'operations',
    description: 'How many rows are in scope.',
    dax: 'COUNTROWS({amount:table})',
    slots: [amountSlot('table being counted')],
    format: 'integer',
    interpret: (value, context) =>
      value === null
        ? 'No rows are in scope.'
        : `${context.formatted} rows of ${context.table}. This counts rows, including any where the measured column is blank.`,
  },
  {
    id: 'completeness-percent',
    name: 'Completeness %',
    pack: 'operations',
    description: 'What share of rows actually carry a value.',
    dax: 'DIVIDE(COUNT({amount}), COUNTROWS({amount:table}))',
    slots: [amountSlot('column being checked')],
    format: 'percent',
    interpret: (value, context) => {
      if (value === null) return 'There are no rows to check.';
      const complete = typeof value === 'number' && value >= 0.999;
      return complete
        ? `Every row carries a ${columnName(context, 'amount')}.`
        : `${context.formatted} of rows carry a ${columnName(context, 'amount')}. The rest are blank, and every total above is computed without them.`;
    },
  },
];

export const MEASURE_LIBRARY: MeasureTemplate[] = [
  ...SALES,
  ...TIME,
  ...FINANCE,
  ...CUSTOMER,
  ...INVENTORY,
  ...OPERATIONS,
];

export const templatesInPack = (pack: MeasureTemplate['pack']): MeasureTemplate[] =>
  MEASURE_LIBRARY.filter(template => template.pack === pack);
