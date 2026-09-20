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
    id: 'values-counts-blank-as-a-group',
    probes:
      'Region is blank on one row. If Power BI treats blank as a group there are 3, ' +
      'if it drops the row there are 2. DISTINCTCOUNT already counts blank as a ' +
      'value, so 2 here would mean grouping and counting disagree about the same data.',
    dax: 'COUNTROWS(VALUES(Sales[Region]))',
    expected: null,
  },
  {
    id: 'distinct-agrees-with-values',
    probes:
      'DISTINCT and VALUES differ in Power BI only over the blank row a broken ' +
      'relationship adds. On one table with a genuinely blank value they should ' +
      'agree, and this engine implements DISTINCT as VALUES outright.',
    dax: 'COUNTROWS(DISTINCT(Sales[Region]))',
    expected: null,
  },
  {
    id: 'groups-cover-the-whole',
    probes:
      'Summing each region total should give the grand total, 7600. Less means a ' +
      'group was dropped - almost certainly the blank one. More means context ' +
      'transition failed and groups saw the grand total instead of their own.',
    dax: 'SUMX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: null,
  },
  {
    id: 'largest-group-total',
    probes:
      'North is 3600, South 3800, the blank region 200. Picks up an error in any ' +
      'single group without depending on the others cancelling out.',
    dax: 'MAXX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: null,
  },
  {
    id: 'smallest-group-total',
    probes:
      'The smallest group is the blank one, at 200. If blank is not a group this ' +
      'returns 3600 instead - the same disagreement as the first case, reached ' +
      'from the other end.',
    dax: 'MINX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))',
    expected: null,
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
    expected: null,
  },
  {
    id: 'row-count-per-group',
    probes:
      'North has 9 rows, South 8, blank 1. Counts rows rather than summing, so a ' +
      'group boundary that is wrong shows up even where the amounts happen to ' +
      'balance.',
    dax: 'MAXX(VALUES(Sales[Region]), CALCULATE(COUNTROWS(Sales)))',
    expected: null,
  },
  {
    id: 'addcolumns-read-back-by-name',
    probes:
      'The added column read back as [T] inside the iterator. Should equal the ' +
      'grand total, and equal the same expression without ADDCOLUMNS.',
    dax: 'SUMX(ADDCOLUMNS(VALUES(Sales[Region]), "T", CALCULATE(SUM(Sales[Amount]))), [T])',
    expected: null,
  },
  {
    id: 'addcolumns-keeps-one-row-per-group',
    probes:
      'ADDCOLUMNS must not change how many rows there are. 3 if blank is a group.',
    dax: 'COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "T", 1))',
    expected: null,
  },
  {
    id: 'computed-column-has-no-lineage',
    probes:
      'A column built by arithmetic came from no model column, so it should ' +
      'narrow nothing on context transition. Half of each region total, summed, ' +
      'is 3800 - half the grand total.',
    dax:
      'SUMX(ADDCOLUMNS(VALUES(Sales[Region]), "Half", CALCULATE(SUM(Sales[Amount])) / 2), [Half])',
    expected: null,
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
    expected: null,
  },
  {
    id: 'outer-filter-limits-the-groups',
    probes:
      'Grouping inside a filter. No Gadget row has a blank Region, so the groups ' +
      'are North and South only: 2 with the filter, 3 without. Widget would have ' +
      'been the wrong choice - it covers all three regions, so the case would ' +
      'have read 3 whether the filter reached VALUES or not.',
    dax: 'CALCULATE(COUNTROWS(VALUES(Sales[Region])), Sales[Product] = "Gadget")',
    expected: null,
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
    expected: null,
  },
  {
    id: 'distinct-values-of-a-number',
    probes:
      'Grouping by Amount itself. 200 and 600 each appear twice and one row is ' +
      'blank, so the distinct values sum to 6800. Checks that deduplication ' +
      'treats numbers the way a filter does.',
    dax: 'SUMX(VALUES(Sales[Amount]), Sales[Amount])',
    expected: null,
  },
  {
    id: 'column-outside-the-grouping-is-unavailable',
    probes:
      'Grouped by Region, so Amount has no single value on a row. Power BI ' +
      'should refuse this. If it instead returns a number, a derived row context ' +
      'makes more visible than I think it does, and the whole design needs ' +
      'revisiting.',
    dax: 'SUMX(VALUES(Sales[Region]), Sales[Amount])',
    expected: null,
  },
];

export const pendingGroupingCount = (): number =>
  GROUPING_CASES.filter(entry => entry.expected === null).length;
