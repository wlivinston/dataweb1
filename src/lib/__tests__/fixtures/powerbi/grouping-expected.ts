import type { ParityCase } from './expected';

/**
 * Ground truth from Power BI for grouping.
 *
 * VALUES of a single column and ADDCOLUMNS are the first functions here that
 * build a table whose columns belong to no model table. Their arithmetic is
 * the verified engine's, but the SHAPE is new: which values become groups,
 * whether a blank is one of them, and what a derived row makes visible.
 * None of that is exercised by the 43 scalar answers already collected.
 *
 * Every case is deliberately scalar. Comparing whole tables needs a harness
 * that does not exist yet, and the risky part is not the table - it is
 * whether context transition through data lineage is right. A single number
 * settles that, and settling it now is cheaper than discovering it after
 * TOPN, the result path, the NLQ compiler and the UI are stacked on top.
 *
 * Runs against sales.csv, already loaded from the first parity round, so
 * there is nothing to import. Region is blank on O15 and Amount is blank on
 * O16, which is where the interesting disagreements live.
 */
export const GROUPING_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes:
      'Not a semantic question - a check that the sheet is worth reading. An ' +
      'empty Sales table makes COUNTROWS and every aggregation return BLANK, ' +
      'so all fourteen cases come back BLANK for one reason that has nothing ' +
      'to do with grouping. That happened on the first attempt, and fourteen ' +
      'blanks look like fourteen answers until you check. If this is not 18, ' +
      'the rest of the sheet means nothing.\n\n' +
      'ANSWERED from the blank sheet rather than this one: the grouping ' +
      'screenshot came back without the canary row, and the blank sheet asks ' +
      'the identical question - COUNTROWS(Sales), same sales.csv, same model - ' +
      'and Power BI answered 18. Borrowed rather than assumed, and said so ' +
      'here, because an unanswered canary that stays skipped is exactly the ' +
      'hole it was added to close.',
    dax: 'COUNTROWS(Sales)',
    expected: 18,
  },
  {
    id: 'values-counts-blank-as-a-group',
    probes:
      'Region is blank on one row. If Power BI treats blank as a group there are 3, ' +
      'if it drops the row there are 2. DISTINCTCOUNT already counts blank as a ' +
      'value, so 2 here would mean grouping and counting disagree about the same data.',
    dax: 'COUNTROWS(VALUES(Sales[Region]))',
    expected: 3,
  },
  {
    id: 'distinct-agrees-with-values',
    probes:
      'DISTINCT and VALUES differ in Power BI only over the blank row a broken ' +
      'relationship adds. On one table with a genuinely blank value they should ' +
      'agree, and this engine implements DISTINCT as VALUES outright.',
    dax: 'COUNTROWS(DISTINCT(Sales[Region]))',
    expected: 3,
  },
  {
    id: 'groups-cover-the-whole',
    probes:
      'Summing each region total should give the grand total, 7600. Less means a ' +
      'group was dropped - almost certainly the blank one. More means context ' +
      'transition failed and groups saw the grand total instead of their own.',
    dax: 'SUMX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: 7600,
  },
  {
    id: 'largest-group-total',
    probes:
      'North is 3600, South 3800, the blank region 200. Picks up an error in any ' +
      'single group without depending on the others cancelling out.',
    dax: 'MAXX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: 3800,
  },
  {
    id: 'smallest-group-total',
    probes:
      'The smallest group is the blank one, at 200. If blank is not a group this ' +
      'returns 3600 instead - the same disagreement as the first case, reached ' +
      'from the other end.',
    dax: 'MINX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: 200,
  },
  {
    id: 'blank-amount-inside-a-group',
    probes:
      'O16 is North with a blank Amount. North averages 3600 over 8 rows if the ' +
      'blank is excluded and over 9 if it is counted as zero - 450 against 400. ' +
      'Summed across groups that is 1125 against 1075. MAXX would have been ' +
      'useless here: South wins at 475 either way, so the case would have ' +
      'passed without ever probing the blank.',
    dax: 'SUMX(VALUES(Sales[Region]), CALCULATE(AVERAGE(Sales[Amount])))',
    expected: 1125,
  },
  {
    id: 'row-count-per-group',
    probes:
      'North has 9 rows, South 8, blank 1. Counts rows rather than summing, so a ' +
      'group boundary that is wrong shows up even where the amounts happen to ' +
      'balance.',
    dax: 'MAXX(VALUES(Sales[Region]), CALCULATE(COUNTROWS(Sales)))',
    expected: 9,
  },
  {
    id: 'addcolumns-read-back-by-name',
    probes:
      'The added column read back as [T] inside the iterator. Should equal the ' +
      'grand total, and equal the same expression without ADDCOLUMNS.',
    dax: 'SUMX(ADDCOLUMNS(VALUES(Sales[Region]), "T", CALCULATE(SUM(Sales[Amount]))), [T])',
    expected: 7600,
  },
  {
    id: 'addcolumns-keeps-one-row-per-group',
    probes:
      'ADDCOLUMNS must not change how many rows there are. 3 if blank is a group.',
    dax: 'COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "T", 1))',
    expected: 3,
  },
  {
    id: 'computed-column-has-no-lineage',
    probes:
      'A column built by arithmetic came from no model column, so it should ' +
      'narrow nothing on context transition. Half of each region total, summed, ' +
      'is 3800 - half the grand total.',
    dax:
      'SUMX(ADDCOLUMNS(VALUES(Sales[Region]), "Half", CALCULATE(SUM(Sales[Amount])) / 2), [Half])',
    expected: 3800,
  },
  {
    id: 'grouping-inside-grouping',
    probes:
      'Per region, the largest product total: North Widget 2600, South Gadget ' +
      '3000, blank region 200, summing to 5800. Two derived row contexts are ' +
      'live at once, and the inner one must win for Product while the outer ' +
      'still constrains Region.',
    dax:
      'SUMX(VALUES(Sales[Region]), CALCULATE(MAXX(VALUES(Sales[Product]), ' +
      'CALCULATE(SUM(Sales[Amount])))))',
    expected: 5800,
  },
  {
    id: 'outer-filter-limits-the-groups',
    probes:
      'Grouping inside a filter. No Gadget row has a blank Region, so the groups ' +
      'are North and South only: 2 with the filter, 3 without. Widget would have ' +
      'been the wrong choice - it covers all three regions, so the case would ' +
      'have read 3 whether the filter reached VALUES or not.',
    dax: 'CALCULATE(COUNTROWS(VALUES(Sales[Region])), Sales[Product] = "Gadget")',
    expected: 2,
  },
  {
    id: 'outer-filter-reaches-inside-each-group',
    probes:
      'Gadget only: North 1000, South 3000, and no blank-region Gadget row at ' +
      'all, so 4000. If the outer filter is lost inside the groups this returns ' +
      '7600 instead.',
    dax:
      'CALCULATE(SUMX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount]))), ' +
      'Sales[Product] = "Gadget")',
    expected: 4000,
  },
  {
    id: 'distinct-values-of-a-number',
    probes:
      'Grouping by Amount itself. 200 and 600 each appear twice and one row is ' +
      'blank, so the distinct values sum to 6800. Checks that deduplication ' +
      'treats numbers the way a filter does.',
    dax: 'SUMX(VALUES(Sales[Amount]), Sales[Amount])',
    expected: 6800,
  },
  {
    id: 'column-outside-the-grouping-is-unavailable',
    probes:
      'Grouped by Region, so Amount has no single value on a row. Power BI ' +
      'should refuse this. If it instead returned a number, a derived row ' +
      'context would make more visible than the design assumes, and the ' +
      'representation would need revisiting rather than extending.',
    dax: 'SUMX(VALUES(Sales[Region]), Sales[Amount])',
    // Answered 2026-09-20. Power BI: "A single value for column 'Amount' in
    // table 'Sales' cannot be determined. This can happen when a measure or
    // function formula refers to a column that contains many values without
    // specifying an aggregation such as min, max, count, or sum."
    //
    // This engine refuses it too - "Sales[Amount] needs a row to read from.
    // Wrap it in an aggregation such as SUM, or use an iterator like SUMX."
    // The derived row context exposes only the columns of the derived table,
    // which is what Power BI does.
    expected: 'ERROR',
    engineRefuses: true,
    compileError: true,
    note:
      'Rejected when the formula is compiled rather than while it runs, so ' +
      'IFERROR cannot contain it and the whole UNION failed with it inside. ' +
      'Excluded from the script and answered on its own.',
  },
];

export const pendingGroupingCount = (): number =>
  GROUPING_CASES.filter(entry => entry.expected === null).length;
