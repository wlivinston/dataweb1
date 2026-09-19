/**
 * The catalogue of DAX functions this product recognises.
 *
 * One list, deliberately. The alternative - the parser holding its own set of
 * names while the evaluator holds the implementations - guarantees the two
 * drift, and a function accepted by one and unknown to the other fails in the
 * worst possible place.
 *
 * `implemented` is the difference between "we recognise this" and "we can run
 * this". Both matter: Phase 3 exports measure text to Power BI, which has
 * hundreds of functions we will never execute, and refusing to parse them
 * would mean refusing to carry a user's own measures.
 */

export type DaxType =
  /** A single value. */
  | 'scalar'
  /** A table expression. */
  | 'table'
  /**
   * A bare column reference, not an expression that yields one. SUM takes
   * this; SUM(Sales[Qty] * Sales[Price]) is the mistake it catches.
   */
  | 'columnRef'
  | 'any';

export interface DaxParameter {
  name: string;
  type: DaxType;
  optional?: boolean;
  /**
   * Bare words accepted in this position, such as YEAR in
   * DATEADD(Date[Date], -1, YEAR) or ASC in RANKX(..., ASC).
   *
   * DAX has no keyword token, so the parser sees these as table references
   * and the validator would otherwise report both a type error and a missing
   * table. Listing them here also buys a check DAX itself does not make:
   * MONTHS instead of MONTH is caught before the measure is saved.
   */
  keywords?: string[];
}

export interface DaxFunctionSignature {
  name: string;
  parameters: DaxParameter[];
  /** The final parameter may repeat, as in CALCULATE's filter arguments. */
  variadic?: boolean;
  returns: DaxType;
  /** Whether the evaluator can execute it. False means parse-and-export only. */
  implemented: boolean;
  category:
    | 'aggregation'
    | 'iterator'
    | 'filter'
    | 'logical'
    | 'math'
    | 'text'
    | 'date'
    | 'timeIntelligence'
    | 'statistical'
    | 'ranking'
    | 'info';
  description: string;
}

/** Units DATEADD, PARALLELPERIOD and DATESINPERIOD shift by. */
const DATE_INTERVALS = ['DAY', 'MONTH', 'QUARTER', 'YEAR'];
/** DATEDIFF measures in finer units than the date shifters move by. */
const DIFFERENCE_INTERVALS = [
  'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR',
];
/** DAX accepts the words and the 0/1 forms interchangeably. */
const RANK_ORDERS = ['ASC', 'DESC', 'TRUE', 'FALSE', '0', '1'];
const RANK_TIES = ['SKIP', 'DENSE'];

const fn = (
  name: string,
  category: DaxFunctionSignature['category'],
  parameters: DaxParameter[],
  returns: DaxType,
  description: string,
  extras: { variadic?: boolean; implemented?: boolean } = {}
): DaxFunctionSignature => ({
  name,
  parameters,
  returns,
  category,
  description,
  variadic: extras.variadic ?? false,
  // Nothing is executable until the evaluator lands. Flipped per function as
  // each one is implemented, so the registry never overstates what works.
  implemented: extras.implemented ?? false,
});

const column = (name: string, optional = false): DaxParameter => ({
  name,
  type: 'columnRef',
  optional,
});
const table = (name: string, optional = false): DaxParameter => ({
  name,
  type: 'table',
  optional,
});
const scalar = (name: string, optional = false): DaxParameter => ({
  name,
  type: 'scalar',
  optional,
});
/** A parameter taking one of a fixed set of bare words. */
const keyword = (name: string, keywords: string[], optional = false): DaxParameter => ({
  name,
  type: 'scalar',
  optional,
  keywords,
});
const any = (name: string, optional = false): DaxParameter => ({
  name,
  type: 'any',
  optional,
});

const SIGNATURES: DaxFunctionSignature[] = [
  // Aggregation over a single column.
  fn('SUM', 'aggregation', [column('column')], 'scalar', 'Adds up every value in a column.', { implemented: true }),
  fn('AVERAGE', 'aggregation', [column('column')], 'scalar', 'The mean of a column, ignoring blanks.', { implemented: true }),
  fn('MIN', 'aggregation', [column('column')], 'scalar', 'The smallest value in a column.', { implemented: true }),
  fn('MAX', 'aggregation', [column('column')], 'scalar', 'The largest value in a column.', { implemented: true }),
  fn('COUNT', 'aggregation', [column('column')], 'scalar', 'Counts the non-blank values in a column.', { implemented: true }),
  fn('COUNTA', 'aggregation', [column('column')], 'scalar', 'Counts values in a column, including text.', { implemented: true }),
  fn('COUNTBLANK', 'aggregation', [column('column')], 'scalar', 'Counts the blanks in a column.', { implemented: true }),
  fn('DISTINCTCOUNT', 'aggregation', [column('column')], 'scalar', 'Counts how many different values a column holds.', { implemented: true }),
  fn('COUNTROWS', 'aggregation', [table('table', true)], 'scalar', 'Counts the rows in a table, after any filters.', { implemented: true }),

  // Iterators, which evaluate an expression row by row.
  fn('SUMX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'Evaluates an expression for each row, then adds the results.', { implemented: true }),
  fn('AVERAGEX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'Evaluates an expression for each row, then averages the results.', { implemented: true }),
  fn('MINX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'The smallest result of an expression across rows.', { implemented: true }),
  fn('MAXX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'The largest result of an expression across rows.', { implemented: true }),
  fn('COUNTX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'Counts non-blank results of an expression across rows.', { implemented: true }),
  fn('CONCATENATEX', 'iterator', [table('table'), scalar('expression'), scalar('delimiter', true)], 'scalar', 'Joins an expression evaluated across rows into one string.', { implemented: true }),
  fn('RANKX', 'ranking', [table('table'), scalar('expression'), scalar('value', true), keyword('order', RANK_ORDERS, true), keyword('ties', RANK_TIES, true)], 'scalar', 'Ranks each row by an expression.', { implemented: true }),

  // Filter context.
  fn('CALCULATE', 'filter', [scalar('expression'), any('filter', true)], 'scalar', 'Evaluates an expression with the filter context modified.', { variadic: true, implemented: true }),
  fn('CALCULATETABLE', 'filter', [table('table'), any('filter', true)], 'table', 'Evaluates a table expression with the filter context modified.', { variadic: true, implemented: true }),
  fn('FILTER', 'filter', [table('table'), scalar('condition')], 'table', 'Keeps only the rows of a table where a condition holds.', { implemented: true }),
  fn('ALL', 'filter', [any('tableOrColumn', true)], 'table', 'Removes filters from a table or columns.', { variadic: true, implemented: true }),
  fn('ALLEXCEPT', 'filter', [table('table'), column('column')], 'table', 'Removes every filter from a table except those on the named columns.', { variadic: true, implemented: true }),
  fn('ALLSELECTED', 'filter', [any('tableOrColumn', true)], 'table', 'Restores the filters the user chose, ignoring those from the current row.', { implemented: true }),
  fn('VALUES', 'filter', [any('tableOrColumn')], 'table', 'The distinct values visible in the current filter context.', { implemented: true }),
  fn('DISTINCT', 'filter', [any('tableOrColumn')], 'table', 'The distinct values of a column or rows of a table.', { implemented: true }),
  fn('RELATED', 'filter', [column('column')], 'scalar', 'Fetches a value from the one side of a relationship.', { implemented: true }),
  fn('RELATEDTABLE', 'filter', [table('table')], 'table', 'Fetches the related rows from the many side of a relationship.', { implemented: true }),
  fn('LOOKUPVALUE', 'filter', [column('resultColumn'), column('searchColumn'), scalar('searchValue')], 'scalar', 'Looks a value up by matching one or more columns.', { variadic: true, implemented: true }),
  fn('USERELATIONSHIP', 'filter', [column('column1'), column('column2')], 'scalar', 'Activates an inactive relationship for this calculation only.', { implemented: true }),
  fn('TOPN', 'filter', [scalar('n'), table('table'), scalar('orderBy', true), keyword('order', RANK_ORDERS, true)], 'table', 'The first N rows of a table by some ordering.', { variadic: true, implemented: true }),
  fn('SELECTEDVALUE', 'filter', [column('column'), scalar('alternate', true)], 'scalar', 'The single value in scope, or an alternative when there is more than one.', { implemented: true }),

  // Logic.
  fn('IF', 'logical', [scalar('condition'), any('then'), any('else', true)], 'any', 'Chooses between two results.', { implemented: true }),
  fn('SWITCH', 'logical', [any('expression'), any('value'), any('result')], 'any', 'Matches an expression against a list of values.', { variadic: true, implemented: true }),
  fn('AND', 'logical', [scalar('a'), scalar('b')], 'scalar', 'True when both arguments are true.', { implemented: true }),
  fn('OR', 'logical', [scalar('a'), scalar('b')], 'scalar', 'True when either argument is true.', { implemented: true }),
  fn('NOT', 'logical', [scalar('value')], 'scalar', 'Reverses a true/false value.', { implemented: true }),
  fn('IFERROR', 'logical', [any('value'), any('alternate')], 'any', 'Returns an alternative when the first argument errors.', { implemented: true }),
  fn('ISBLANK', 'info', [any('value')], 'scalar', 'True when a value is blank.', { implemented: true }),
  fn('ISERROR', 'info', [any('value')], 'scalar', 'True when an expression errors.', { implemented: true }),
  fn('COALESCE', 'logical', [any('value')], 'any', 'The first argument that is not blank.', { variadic: true, implemented: true }),
  fn('BLANK', 'info', [], 'scalar', 'The blank value.', { implemented: true }),

  // Arithmetic.
  fn('DIVIDE', 'math', [scalar('numerator'), scalar('denominator'), scalar('alternateResult', true)], 'scalar', 'Divides, returning an alternative instead of an error when dividing by zero.', { implemented: true }),
  fn('ROUND', 'math', [scalar('number'), scalar('digits')], 'scalar', 'Rounds to a number of decimal places.', { implemented: true }),
  fn('ROUNDUP', 'math', [scalar('number'), scalar('digits')], 'scalar', 'Rounds away from zero.', { implemented: true }),
  fn('ROUNDDOWN', 'math', [scalar('number'), scalar('digits')], 'scalar', 'Rounds towards zero.', { implemented: true }),
  fn('ABS', 'math', [scalar('number')], 'scalar', 'The magnitude of a number, without its sign.', { implemented: true }),
  fn('CEILING', 'math', [scalar('number'), scalar('significance')], 'scalar', 'Rounds up to a multiple.', { implemented: true }),
  fn('FLOOR', 'math', [scalar('number'), scalar('significance')], 'scalar', 'Rounds down to a multiple.', { implemented: true }),
  fn('INT', 'math', [scalar('number')], 'scalar', 'Truncates to a whole number.', { implemented: true }),
  fn('POWER', 'math', [scalar('number'), scalar('power')], 'scalar', 'Raises a number to a power.', { implemented: true }),
  fn('SQRT', 'math', [scalar('number')], 'scalar', 'The square root of a number.', { implemented: true }),
  fn('MOD', 'math', [scalar('number'), scalar('divisor')], 'scalar', 'The remainder after division.', { implemented: true }),

  // Statistics.
  fn('MEDIAN', 'statistical', [column('column')], 'scalar', 'The middle value of a column.', { implemented: true }),
  fn('STDEV.P', 'statistical', [column('column')], 'scalar', 'Standard deviation across a whole population.', { implemented: true }),
  fn('STDEV.S', 'statistical', [column('column')], 'scalar', 'Standard deviation estimated from a sample.', { implemented: true }),
  fn('VAR.P', 'statistical', [column('column')], 'scalar', 'Variance across a whole population.', { implemented: true }),
  fn('VAR.S', 'statistical', [column('column')], 'scalar', 'Variance estimated from a sample.', { implemented: true }),
  fn('PERCENTILE.INC', 'statistical', [column('column'), scalar('k')], 'scalar', 'The value at a given percentile, inclusive.', { implemented: true }),

  // Text.
  fn('CONCATENATE', 'text', [scalar('a'), scalar('b')], 'scalar', 'Joins two strings.', { implemented: true }),
  fn('LEFT', 'text', [scalar('text'), scalar('count', true)], 'scalar', 'The first characters of a string.', { implemented: true }),
  fn('RIGHT', 'text', [scalar('text'), scalar('count', true)], 'scalar', 'The last characters of a string.', { implemented: true }),
  fn('MID', 'text', [scalar('text'), scalar('start'), scalar('count')], 'scalar', 'Characters from the middle of a string.', { implemented: true }),
  fn('LEN', 'text', [scalar('text')], 'scalar', 'How many characters a string has.', { implemented: true }),
  fn('UPPER', 'text', [scalar('text')], 'scalar', 'Converts text to upper case.', { implemented: true }),
  fn('LOWER', 'text', [scalar('text')], 'scalar', 'Converts text to lower case.', { implemented: true }),
  fn('TRIM', 'text', [scalar('text')], 'scalar', 'Removes leading and trailing spaces.', { implemented: true }),
  fn('SUBSTITUTE', 'text', [scalar('text'), scalar('old'), scalar('new')], 'scalar', 'Replaces one piece of text with another.', { implemented: true }),
  fn('FORMAT', 'text', [scalar('value'), scalar('format')], 'scalar', 'Formats a value as text.', { implemented: true }),

  // Dates.
  fn('YEAR', 'date', [scalar('date')], 'scalar', 'The year of a date.', { implemented: true }),
  fn('MONTH', 'date', [scalar('date')], 'scalar', 'The month of a date, 1 to 12.', { implemented: true }),
  fn('DAY', 'date', [scalar('date')], 'scalar', 'The day of the month.', { implemented: true }),
  fn('QUARTER', 'date', [scalar('date')], 'scalar', 'The quarter of a date, 1 to 4.', { implemented: true }),
  fn('WEEKNUM', 'date', [scalar('date'), scalar('returnType', true)], 'scalar', 'The week number of a date.', { implemented: true }),
  fn('TODAY', 'date', [], 'scalar', "Today's date.", { implemented: true }),
  fn('NOW', 'date', [], 'scalar', 'The current date and time.', { implemented: true }),
  fn('DATE', 'date', [scalar('year'), scalar('month'), scalar('day')], 'scalar', 'Builds a date from its parts.', { implemented: true }),
  fn('EDATE', 'date', [scalar('date'), scalar('months')], 'scalar', 'A date a number of months away.', { implemented: true }),
  fn('EOMONTH', 'date', [scalar('date'), scalar('months')], 'scalar', 'The last day of a month, offset from a date.', { implemented: true }),
  fn('DATEDIFF', 'date', [scalar('start'), scalar('end'), keyword('interval', DIFFERENCE_INTERVALS)], 'scalar', 'The distance between two dates in a chosen unit.', { implemented: true }),

  // Time intelligence.
  fn('TOTALYTD', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true), scalar('yearEnd', true)], 'scalar', 'A running total from the start of the year.', { variadic: true, implemented: true }),
  fn('TOTALQTD', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true)], 'scalar', 'A running total from the start of the quarter.', { variadic: true, implemented: true }),
  fn('TOTALMTD', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true)], 'scalar', 'A running total from the start of the month.', { variadic: true, implemented: true }),
  fn('DATESYTD', 'timeIntelligence', [column('dates'), scalar('yearEnd', true)], 'table', 'The dates from the start of the year to the current one.', { implemented: true }),
  fn('DATESQTD', 'timeIntelligence', [column('dates')], 'table', 'The dates from the start of the quarter.', { implemented: true }),
  fn('DATESMTD', 'timeIntelligence', [column('dates')], 'table', 'The dates from the start of the month.', { implemented: true }),
  fn('SAMEPERIODLASTYEAR', 'timeIntelligence', [column('dates')], 'table', 'The same span of dates one year earlier.', { implemented: true }),
  fn('PREVIOUSYEAR', 'timeIntelligence', [column('dates'), scalar('yearEnd', true)], 'table', 'All dates in the previous year.', { implemented: true }),
  fn('PREVIOUSQUARTER', 'timeIntelligence', [column('dates')], 'table', 'All dates in the previous quarter.', { implemented: true }),
  fn('PREVIOUSMONTH', 'timeIntelligence', [column('dates')], 'table', 'All dates in the previous month.', { implemented: true }),
  fn('DATEADD', 'timeIntelligence', [column('dates'), scalar('intervals'), keyword('interval', DATE_INTERVALS)], 'table', 'Shifts a set of dates forwards or backwards.', { implemented: true }),
  fn('DATESINPERIOD', 'timeIntelligence', [column('dates'), scalar('startDate'), scalar('intervals'), keyword('interval', DATE_INTERVALS)], 'table', 'A span of dates from a starting point.', { implemented: true }),
  fn('PARALLELPERIOD', 'timeIntelligence', [column('dates'), scalar('intervals'), keyword('interval', DATE_INTERVALS)], 'table', 'A whole period shifted forwards or backwards.', { implemented: true }),
  fn('FIRSTDATE', 'timeIntelligence', [column('dates')], 'scalar', 'The earliest date in scope.', { implemented: true }),
  fn('LASTDATE', 'timeIntelligence', [column('dates')], 'scalar', 'The latest date in scope.', { implemented: true }),
  fn('STARTOFMONTH', 'timeIntelligence', [column('dates')], 'scalar', 'The first day of the month in scope.', { implemented: true }),
  fn('STARTOFQUARTER', 'timeIntelligence', [column('dates')], 'scalar', 'The first day of the quarter in scope.', { implemented: true }),
  fn('STARTOFYEAR', 'timeIntelligence', [column('dates')], 'scalar', 'The first day of the year in scope.', { implemented: true }),
  fn('ENDOFMONTH', 'timeIntelligence', [column('dates')], 'scalar', 'The last day of the month in scope.', { implemented: true }),
  fn('ENDOFQUARTER', 'timeIntelligence', [column('dates')], 'scalar', 'The last day of the quarter in scope.', { implemented: true }),
  fn('ENDOFYEAR', 'timeIntelligence', [column('dates')], 'scalar', 'The last day of the year in scope.', { implemented: true }),
  fn('NEXTDAY', 'timeIntelligence', [column('dates')], 'table', 'The day after the one in scope.', { implemented: true }),
  fn('PREVIOUSDAY', 'timeIntelligence', [column('dates')], 'table', 'The day before the one in scope.', { implemented: true }),
  fn('NEXTMONTH', 'timeIntelligence', [column('dates')], 'table', 'All dates in the following month.', { implemented: true }),
  fn('NEXTQUARTER', 'timeIntelligence', [column('dates')], 'table', 'All dates in the following quarter.', { implemented: true }),
  fn('NEXTYEAR', 'timeIntelligence', [column('dates'), scalar('yearEnd', true)], 'table', 'All dates in the following year.', { implemented: true }),

  // ----------------------------------------------------------------
  // Recognised but not executed.
  //
  // These turn up often enough in real Power BI measures that refusing to
  // PARSE them would mean refusing to carry work a user already has. They
  // are catalogued so such a measure can be stored, validated, printed and
  // exported; asking for a number from one fails with a message saying
  // exactly that. Each needs machinery this engine does not have: table
  // shaping that invents columns, or filter concepts that only mean
  // something inside a report.
  // ----------------------------------------------------------------
  fn('SUMMARIZE', 'filter', [table('table'), any('groupBy')], 'table', 'Groups a table by columns, adding aggregated columns.', { variadic: true }),
  fn('SUMMARIZECOLUMNS', 'filter', [any('groupBy')], 'table', 'Groups and aggregates across columns without naming a base table.', { variadic: true }),
  fn('ADDCOLUMNS', 'filter', [table('table'), scalar('name'), scalar('expression')], 'table', 'Adds calculated columns to a table expression.', { variadic: true }),
  fn('SELECTCOLUMNS', 'filter', [table('table'), scalar('name'), scalar('expression')], 'table', 'Picks and renames columns from a table expression.', { variadic: true }),
  fn('CROSSJOIN', 'filter', [table('table1'), table('table2')], 'table', 'Every combination of rows from two tables.', { variadic: true }),
  fn('UNION', 'filter', [table('table1'), table('table2')], 'table', 'The rows of two tables combined.', { variadic: true }),
  fn('EXCEPT', 'filter', [table('table1'), table('table2')], 'table', 'The rows of one table that are not in another.'),
  fn('INTERSECT', 'filter', [table('table1'), table('table2')], 'table', 'The rows common to two tables.'),
  fn('GENERATE', 'filter', [table('table1'), table('table2')], 'table', 'Joins each row of one table to a table evaluated for it.'),
  fn('TREATAS', 'filter', [table('table'), column('column')], 'table', 'Applies a table as a filter on unrelated columns.', { variadic: true }),
  fn('KEEPFILTERS', 'filter', [any('expression')], 'any', 'Adds a filter instead of replacing the existing one.'),
  fn('REMOVEFILTERS', 'filter', [any('tableOrColumn', true)], 'table', 'Clears filters, as ALL does, but only as a modifier.', { variadic: true }),
  fn('CROSSFILTER', 'filter', [column('column1'), column('column2'), scalar('direction')], 'scalar', 'Changes the cross-filter direction of a relationship.'),
  fn('EARLIER', 'filter', [column('column'), scalar('number', true)], 'scalar', 'Refers to the value in an outer row context.'),
  fn('HASONEVALUE', 'info', [column('column')], 'scalar', 'True when exactly one value of a column is in scope.'),
  fn('ISFILTERED', 'info', [any('tableOrColumn')], 'scalar', 'True when a column is being filtered directly.'),
  fn('ISINSCOPE', 'info', [column('column')], 'scalar', 'True when a column is a grouping level in the current visual.'),
  fn('CALENDAR', 'date', [scalar('start'), scalar('end')], 'table', 'A one-column table of dates between two bounds.'),
  fn('CALENDARAUTO', 'date', [scalar('fiscalYearEndMonth', true)], 'table', 'A date table covering the whole model.'),
  fn('DATATABLE', 'date', [scalar('name'), scalar('type')], 'table', 'A table written out inline.', { variadic: true }),
  fn('PATH', 'text', [column('idColumn'), column('parentColumn')], 'scalar', 'The chain of parents above a row in a hierarchy.'),
  fn('PATHITEM', 'text', [scalar('path'), scalar('position')], 'scalar', 'One level out of a PATH result.'),
  fn('RANK.EQ', 'ranking', [scalar('value'), column('column'), scalar('order', true)], 'scalar', 'Ranks a value against a column.'),
  fn('MEDIANX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'The median of an expression evaluated across rows.'),
  fn('PERCENTILEX.INC', 'iterator', [table('table'), scalar('expression'), scalar('k')], 'scalar', 'A percentile of an expression evaluated across rows.'),
  fn('PRODUCT', 'aggregation', [column('column')], 'scalar', 'Multiplies every value in a column together.'),
  fn('PRODUCTX', 'iterator', [table('table'), scalar('expression')], 'scalar', 'Multiplies an expression evaluated across rows.'),
  fn('GEOMEAN', 'statistical', [column('column')], 'scalar', 'The geometric mean of a column.'),
  fn('FIRSTNONBLANK', 'filter', [column('column'), scalar('expression')], 'table', 'The first value of a column where an expression is not blank.'),
  fn('LASTNONBLANK', 'filter', [column('column'), scalar('expression')], 'table', 'The last value of a column where an expression is not blank.'),
  fn('OPENINGBALANCEMONTH', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true)], 'scalar', 'A value evaluated at the start of the month.', { variadic: true }),
  fn('CLOSINGBALANCEMONTH', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true)], 'scalar', 'A value evaluated at the end of the month.', { variadic: true }),
  fn('CLOSINGBALANCEYEAR', 'timeIntelligence', [scalar('expression'), column('dates'), any('filter', true), scalar('yearEnd', true)], 'scalar', 'A value evaluated at the end of the year.', { variadic: true }),
];

const BY_NAME = new Map(SIGNATURES.map(signature => [signature.name.toUpperCase(), signature]));

export const lookupFunction = (name: string): DaxFunctionSignature | undefined =>
  BY_NAME.get(name.toUpperCase());

export const allFunctions = (): DaxFunctionSignature[] => SIGNATURES.slice();

/** Fewest arguments the function will accept. */
export const minArity = (signature: DaxFunctionSignature): number =>
  signature.parameters.filter(parameter => !parameter.optional).length;

/** Most arguments the function will accept; Infinity when it is variadic. */
export const maxArity = (signature: DaxFunctionSignature): number =>
  signature.variadic ? Infinity : signature.parameters.length;

/** Render a signature the way documentation would, for error messages. */
export const formatSignature = (signature: DaxFunctionSignature): string => {
  const parts = signature.parameters.map(parameter =>
    parameter.optional ? `[${parameter.name}]` : parameter.name
  );
  if (signature.variadic) parts.push('...');
  return `${signature.name}(${parts.join(', ')})`;
};

/**
 * Names close enough to a typo to be worth suggesting.
 *
 * Levenshtein distance, capped at 2 edits, so SUMM offers SUM and SUMX but a
 * genuinely unknown name offers nothing rather than something misleading.
 */
export const suggestFunctionNames = (name: string, limit = 3): string[] => {
  const target = name.toUpperCase();
  const scored: { name: string; distance: number }[] = [];

  for (const candidate of BY_NAME.keys()) {
    const distance = editDistance(target, candidate);
    if (distance <= 2) scored.push({ name: candidate, distance });
  }

  return scored
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(entry => entry.name);
};

const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }

  return previous[b.length];
};
