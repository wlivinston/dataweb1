import type { ParityCase } from './expected';

/**
 * Ground truth from Power BI for filtered questions.
 *
 * The NLQ compiler now turns "total Amount for North" into
 * CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North"). The arithmetic was
 * already verified; what is new is the SHAPE - a predicate inside CALCULATE,
 * and for a grouped question a predicate inside the per-group CALCULATE
 * rather than around the TOPN.
 *
 * That last distinction is the one worth paying for. Both placements return
 * the same rows in the same order; only the numbers inside them differ, and
 * a wrong one looks exactly like a right one on screen. Cases 6 and 7 are
 * the same question compiled both ways, so Power BI says which is which.
 *
 * Runs against sales.csv, already loaded. Region is blank on O15 and Amount
 * is blank on O16, so the filters cross a blank on both sides.
 */
export const FILTER_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes: 'If this is not 18, nothing below it means anything.',
    dax: 'COUNTROWS(Sales)',
    expected: null,
  },
  {
    id: 'a-plain-text-filter',
    probes:
      'The simplest filtered question there is, and the one an analyst asks ' +
      'first. North has 8 rows; O16 among them has a blank Amount, so this ' +
      'also says whether a blank row drags a filtered total anywhere.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North")',
    expected: null,
  },
  {
    id: 'the-same-filter-averaged',
    probes:
      'Same filter, different aggregation. North has 8 rows and 7 Amounts, so ' +
      'this is 2600/7 if the blank is excluded and 2600/8 if it is counted - ' +
      'the exact mistake the KPI tiles were making in production.',
    dax: 'CALCULATE(AVERAGE(Sales[Amount]), Sales[Region] = "North")',
    expected: null,
  },
  {
    id: 'a-filter-on-a-second-column',
    probes:
      'Product rather than Region, to check the compiler is not quietly ' +
      'specialised to one column. Widget includes O15, whose Region is blank.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Product] = "Widget")',
    expected: null,
  },
  {
    id: 'a-filter-matching-nothing',
    probes:
      'A value that is in no row. BLANK is the honest answer; 0 would be a ' +
      'number that reads like a real total of nothing.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Atlantis")',
    expected: null,
  },
  {
    id: 'a-filter-on-the-blank-region',
    probes:
      'Filtering BY the blank. O15 is the only row whose Region is empty, so ' +
      'this is 200 if a blank can be filtered on at all. Ties this sheet to ' +
      'the empty-cell divergence already recorded in blank-expected.ts.',
    dax: 'CALCULATE(SUM(Sales[Amount]), FILTER(Sales, ISBLANK(Sales[Region])))',
    expected: null,
  },
  {
    id: 'grouped-with-the-filter-INSIDE-each-group',
    probes:
      'What the compiler emits: the predicate inside the per-group CALCULATE. ' +
      'Each product total should count only North rows. Compare with the next ' +
      'case, which is the same question with the filter in the wrong place.',
    dax:
      'CONCATENATEX(TOPN(3, ADDCOLUMNS(VALUES(Sales[Product]), "V", ' +
      'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North")), [V], DESC), ' +
      'Sales[Product] & "=" & [V], ">")',
    expected: null,
    returnsText: true,
  },
  {
    id: 'grouped-with-the-filter-OUTSIDE-the-grouping',
    probes:
      'The same question with the filter wrapped around the result instead. ' +
      'If this equals the case above, the placement does not matter and one ' +
      'of my comments is wrong. If it differs, the difference is exactly the ' +
      'silent error the compiler is written to avoid.',
    dax:
      'CONCATENATEX(TOPN(3, CALCULATETABLE(ADDCOLUMNS(VALUES(Sales[Product]), ' +
      '"V", CALCULATE(SUM(Sales[Amount]))), Sales[Region] = "North"), [V], DESC), ' +
      'Sales[Product] & "=" & [V], ">")',
    expected: null,
    returnsText: true,
  },
  {
    id: 'a-filter-on-a-number-column-value',
    probes:
      'Amount is a measure, and the compiler refuses to filter by one - ' +
      '"total Amount for 100" is not a question anyone asks. The DAX is still ' +
      'legal, so this records what Power BI does, in case that refusal is ' +
      'ever loosened.',
    dax: 'CALCULATE(COUNTROWS(Sales), Sales[Amount] = 100)',
    expected: null,
  },
  {
    id: 'two-filters-at-once',
    probes:
      'Not compiled yet - the parser takes one filter clause. Recorded now so ' +
      'that when it is, the expected answer is already here and was not ' +
      'invented to match whatever the engine then produced.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North", Sales[Product] = "Widget")',
    expected: null,
  },
];

export const pendingFilterCount = (): number =>
  FILTER_CASES.filter(entry => entry.expected === null).length;
