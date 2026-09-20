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
  'total-revenue': 2100,
  'order-count': 5,
  'average-order-value': 420,
  'units-sold': 42,
  'average-unit-price': 50,
  'revenue-ytd': 1500,
  'revenue-prior-year': 600,
  'revenue-yoy-percent': 1.5,
  'gross-profit': 800,
  'gross-margin-percent': 0.380952381,
  'total-cost': 1300,
  'customer-count': 3,
  'revenue-per-customer': 700,
  'orders-per-customer': 1.6666666667,
  'product-count': 3,
  'revenue-per-product': 700,
  'row-count': 6,
  'completeness-percent': 1,
};

export const pendingMeasureCount = (): number =>
  Object.values(MEASURE_ANSWERS).filter(value => value === null).length;
