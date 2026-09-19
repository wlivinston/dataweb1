/**
 * Ground truth from Power BI for the measure library.
 *
 * The 18 measures are verified against my own arithmetic, which is the same
 * position the DAX engine was in before the parity sheet - and that sheet
 * found two real bugs. The formulas here are simpler, but "simple enough to
 * be obviously right" is the sentence that preceded three of this week's
 * bugs.
 *
 * Keyed by template id. A value of null means unanswered, and the comparison
 * skips it, so a partly filled sheet is still worth having.
 *
 * Use the string 'BLANK' for an empty cell and 'ERROR' if Power BI refuses
 * the expression.
 */
export const MEASURE_ANSWERS: Record<string, number | string | null> = {
  'total-revenue': null,
  'order-count': null,
  'average-order-value': null,
  'units-sold': null,
  'average-unit-price': null,
  'revenue-ytd': null,
  'revenue-prior-year': null,
  'revenue-yoy-percent': null,
  'gross-profit': null,
  'gross-margin-percent': null,
  'total-cost': null,
  'customer-count': null,
  'revenue-per-customer': null,
  'orders-per-customer': null,
  'product-count': null,
  'revenue-per-product': null,
  'row-count': null,
  'completeness-percent': null,
};

export const pendingMeasureCount = (): number =>
  Object.values(MEASURE_ANSWERS).filter(value => value === null).length;
