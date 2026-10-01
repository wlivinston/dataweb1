import type { ParityCase } from './expected';

/**
 * Ground truth from Power BI for filtered questions. ANSWERED 2026-09-30.
 *
 * Nine of ten agree. The tenth is the empty-cell divergence already recorded
 * in blank-expected.ts, arriving exactly where that sheet predicted it would.
 *
 * WHAT THIS SHEET PROVED ME WRONG ABOUT. I wrote that the placement of a
 * filter in a grouped question changes the numbers - "the same rows, with the
 * wrong numbers in them" - and built cases 7 and 8 to show it. Power BI
 * returned IDENTICAL answers for both, and so does this engine.
 *
 * The reason is that CALCULATETABLE propagates its filter into the whole
 * inner evaluation, including each per-group CALCULATE. The totals cannot
 * disagree. What actually differs is WHICH GROUPS EXIST: VALUES() inside
 * CALCULATETABLE is evaluated under the filter, so a group with no surviving
 * rows disappears, while the same filter inside the per-group CALCULATE
 * leaves that group present with a blank total.
 *
 * Cases 7 and 8 could never have shown that, because both products appear in
 * North - so the pair was vacuous, and it took Power BI to say so rather than
 * any test here. Cases 11 and 12 are the replacement: Gadget never appears on
 * the blank-region row, so the blank group survives one placement and not the
 * other. This engine already answers them differently
 * ("South=3000>North=1000>(blank)=" against "South=3000>North=1000"), which
 * is what makes them worth asking.
 *
 * Runs against sales.csv, already loaded. Region is blank on O15 and Amount
 * is blank on O16, so the filters cross a blank on both sides.
 */

/** The divergence this sheet inherited, unchanged, from blank-expected.ts. */
const EMPTY_CELL_NOTE =
  "Power BI's Text/CSV connector stores an empty text field as an empty " +
  'string, so ISBLANK(Sales[Region]) matches no row and the filter returns ' +
  'BLANK. This engine converts an empty cell to BLANK on purpose, so O15 ' +
  'matches and the total is 200. Same deliberate divergence as the three ' +
  'pinned in blank-expected.ts and the five in table-expected.ts, reached ' +
  'from a fourth direction. Reversible in one line of fromCell.';
export const FILTER_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes: 'If this is not 18, nothing below it means anything.',
    dax: 'COUNTROWS(Sales)',
    expected: 18,
  },
  {
    id: 'a-plain-text-filter',
    probes:
      'The simplest filtered question there is, and the one an analyst asks ' +
      'first. North has 8 rows; O16 among them has a blank Amount, so this ' +
      'also says whether a blank row drags a filtered total anywhere.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North")',
    expected: 3600,
  },
  {
    id: 'the-same-filter-averaged',
    probes:
      'Same filter, different aggregation. North has 8 rows and 7 Amounts, so ' +
      'this is 2600/7 if the blank is excluded and 2600/8 if it is counted - ' +
      'the exact mistake the KPI tiles were making in production.',
    dax: 'CALCULATE(AVERAGE(Sales[Amount]), Sales[Region] = "North")',
    expected: 450,
  },
  {
    id: 'a-filter-on-a-second-column',
    probes:
      'Product rather than Region, to check the compiler is not quietly ' +
      'specialised to one column. Widget includes O15, whose Region is blank.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Product] = "Widget")',
    expected: 3600,
  },
  {
    id: 'a-filter-matching-nothing',
    probes:
      'A value that is in no row. BLANK is the honest answer; 0 would be a ' +
      'number that reads like a real total of nothing.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Atlantis")',
    expected: 'BLANK',
  },
  {
    id: 'a-filter-on-the-blank-region',
    probes:
      'Filtering BY the blank. O15 is the only row whose Region is empty, so ' +
      'this is 200 if a blank can be filtered on at all. Ties this sheet to ' +
      'the empty-cell divergence already recorded in blank-expected.ts.',
    dax: 'CALCULATE(SUM(Sales[Amount]), FILTER(Sales, ISBLANK(Sales[Region])))',
    expected: 'BLANK',
    divergence: {
      engine: '200',
      note: EMPTY_CELL_NOTE,
    },
  },
  {
    id: 'grouped-with-the-filter-INSIDE-each-group',
    probes:
      'What the compiler emits: the predicate inside the per-group CALCULATE. ' +
      'Each product total counts only North rows. ANSWERED: identical to the ' +
      'next case, which I had predicted would differ. Kept as the record of ' +
      'that, not as a live question - see the note at the top of this file.',
    dax:
      'CONCATENATEX(TOPN(3, ADDCOLUMNS(VALUES(Sales[Product]), "V", ' +
      'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North")), [V], DESC), ' +
      'Sales[Product] & "=" & [V], ">")',
    expected: 'Widget=2600>Gadget=1000',
    returnsText: true,
  },
  {
    id: 'grouped-with-the-filter-OUTSIDE-the-grouping',
    probes:
      'The same question with the filter wrapped around the grouping instead. ' +
      'It equals the case above, so the placement did NOT matter here and the ' +
      'comment claiming it changed the numbers was wrong. CALCULATETABLE ' +
      'pushes its filter into the inner CALCULATE too, so the totals cannot ' +
      'disagree. Both products appear in North, so this pair could never have ' +
      'shown the real difference - cases 11 and 12 do.',
    dax:
      'CONCATENATEX(TOPN(3, CALCULATETABLE(ADDCOLUMNS(VALUES(Sales[Product]), ' +
      '"V", CALCULATE(SUM(Sales[Amount]))), Sales[Region] = "North"), [V], DESC), ' +
      'Sales[Product] & "=" & [V], ">")',
    expected: 'Widget=2600>Gadget=1000',
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
    expected: 1,
  },
  {
    id: 'two-filters-at-once',
    probes:
      'Not compiled yet - the parser takes one filter clause. Recorded now so ' +
      'that when it is, the expected answer is already here and was not ' +
      'invented to match whatever the engine then produced.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "North", Sales[Product] = "Widget")',
    expected: 2600,
  },
  {
    id: 'placement-INSIDE-where-it-can-actually-differ',
    probes:
      'The replacement for the vacuous 7/8 pair. Group by Region, filter by ' +
      'Product = Gadget. O15 is the only blank-region row and it is a Widget, ' +
      'so the blank group has no Gadget rows at all. With the filter inside ' +
      'the per-group CALCULATE, VALUES(Region) is unfiltered and the blank ' +
      'group should still be listed, with an empty total. This engine says ' +
      '"South=3000>North=1000>(blank)=".',
    dax:
      'CONCATENATEX(TOPN(5, ADDCOLUMNS(VALUES(Sales[Region]), "V", ' +
      'CALCULATE(SUM(Sales[Amount]), Sales[Product] = "Gadget")), [V], DESC), ' +
      'IF(ISBLANK(Sales[Region]), "(blank)", Sales[Region]) & "=" & [V], ">")',
    expected: null,
    returnsText: true,
  },
  {
    id: 'placement-OUTSIDE-where-it-can-actually-differ',
    probes:
      'Same question, filter around the grouping. Here VALUES(Region) is ' +
      'evaluated under the Gadget filter, so the blank group has no rows to ' +
      'come from and should vanish entirely rather than appear empty. This ' +
      'engine says "South=3000>North=1000". If Power BI agrees, the real ' +
      'difference between the placements is WHICH GROUPS EXIST, which is what ' +
      'the compiler choice actually rests on.',
    dax:
      'CONCATENATEX(TOPN(5, CALCULATETABLE(ADDCOLUMNS(VALUES(Sales[Region]), ' +
      '"V", CALCULATE(SUM(Sales[Amount]))), Sales[Product] = "Gadget"), [V], DESC), ' +
      'IF(ISBLANK(Sales[Region]), "(blank)", Sales[Region]) & "=" & [V], ">")',
    expected: null,
    returnsText: true,
  },
];

export const pendingFilterCount = (): number =>
  FILTER_CASES.filter(entry => entry.expected === null).length;
