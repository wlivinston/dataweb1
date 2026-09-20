import type { ParityCase } from './expected';

/**
 * Ground truth from Power BI for table results.
 *
 * All 60 answers collected so far are single figures. The grouping
 * SEMANTICS are checked - which rows exist, what each group totals - but
 * nothing outside this repo has seen a table come out of the engine, and a
 * table is now the first thing an analyst looks at on the Ask Data tab.
 *
 * Comparing whole tables would need a harness that does not exist, so each
 * case flattens its table into one string with CONCATENATEX and compares
 * that. The string carries everything a table comparison would: which rows
 * are present, in what order, with what values, and how a blank renders.
 *
 * A blank group is written "(blank)" explicitly rather than left to
 * concatenate as an empty string, so a missing row and a blank row cannot
 * look the same in the answer. One case deliberately does the opposite, to
 * find out what Power BI does with a blank inside CONCATENATEX - this
 * engine drops empty strings, and if Power BI keeps them as empty slots the
 * two disagree about every list they build.
 *
 * Runs on sales.csv. Region totals are North 3600, South 3800, blank 200.
 */

/** The grouped table these cases rank and flatten. */
const GROUPED =
  'ADDCOLUMNS(VALUES(Sales[Region]), "T", CALCULATE(SUM(Sales[Amount])))';

/** A label that shows a blank group instead of hiding it. */
const LABEL = 'IF(ISBLANK(Sales[Region]), "(blank)", Sales[Region])';

/** The one disagreement this sheet found, shared by five cases. */
const BLANK_LABEL_NOTE =
  "EXPLAINED 2026-09-20. Power BI's Text/CSV connector stores an empty text " +
  'field as an empty string, not BLANK, so IF(ISBLANK(...)) falls through to ' +
  'the value and renders empty. This engine converts it to BLANK on purpose, ' +
  'so that missingness stays visible to completeness and null counts. The ' +
  'divergence is narrow and fully characterised: ISBLANK and COUNTA on a text ' +
  'column with empty cells, and nothing else. See blank-expected.ts.';

export const TABLE_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes:
      'A check that the sheet is worth reading. An empty Sales table answers ' +
      'BLANK to everything, and a column of blanks reads as answers until you ' +
      'notice they are all the same. If this is not 18, nothing below it means ' +
      'anything.',
    dax: 'COUNTROWS(Sales)',
    expected: 18,
  },
  {
    id: 'ranked-rows-in-order',
    probes:
      'The whole result as one string: which groups, in which order. South ' +
      '3800, North 3600, blank 200. Order is the part no scalar case has ever ' +
      'checked, and it is the order an analyst reads down the screen.',
    dax: `CONCATENATEX(TOPN(3, ${GROUPED}, [T], DESC), ${LABEL}, ">")`,
    expected: 'North>South>',
    returnsText: true,
    divergence: {
      engine: 'South>North>(blank)',
      note: BLANK_LABEL_NOTE,
    },
    unorderedText: true,
  },
  {
    id: 'ranked-rows-with-their-figures',
    probes:
      'The same table with the values attached, so a right answer in the wrong ' +
      'order and a wrong answer in the right order cannot both pass.',
    dax: `CONCATENATEX(TOPN(3, ${GROUPED}, [T], DESC), ${LABEL} & "=" & [T], ">")`,
    expected: 'North=3600>South=3800>=200',
    returnsText: true,
    divergence: {
      engine: 'South=3800>North=3600>(blank)=200',
      note: BLANK_LABEL_NOTE,
    },
    unorderedText: true,
  },
  {
    id: 'ranked-the-other-way',
    probes:
      'ASC should exactly reverse the DESC order. If it does not, one of the ' +
      'two is not sorting by the column it claims to.',
    dax: `CONCATENATEX(TOPN(3, ${GROUPED}, [T], ASC), ${LABEL} & "=" & [T], ">")`,
    expected: 'North=3600>South=3800>=200',
    returnsText: true,
    divergence: {
      engine: '(blank)=200>North=3600>South=3800',
      note: BLANK_LABEL_NOTE,
    },
    unorderedText: true,
  },
  {
    id: 'top-one-group',
    probes:
      'A single row, so the answer cannot depend on order at all. Isolates ' +
      '"did TOPN pick the right group" from "did it keep them in order".',
    dax: `CONCATENATEX(TOPN(1, ${GROUPED}, [T], DESC), ${LABEL}, ">")`,
    expected: 'South',
    returnsText: true,
  },
  {
    id: 'bottom-one-group-is-the-blank-one',
    probes:
      'The smallest group is the blank region at 200. Answering "North" would ' +
      'mean blank is not being treated as a group when ranking, even though it ' +
      'is when counting.',
    dax: `CONCATENATEX(TOPN(1, ${GROUPED}, [T], ASC), ${LABEL}, ">")`,
    expected: '',
    returnsText: true,
    divergence: {
      engine: '(blank)',
      note: BLANK_LABEL_NOTE,
    },
  },
  {
    id: 'asking-for-more-groups-than-exist',
    probes:
      'Three groups exist. TOPN(10) should return three, not pad, not error. ' +
      'Counted rather than flattened: the flattened form is character-for-' +
      'character identical to the TOPN(3) case, so it could not have told ' +
      'the two apart and would have been a case that proves nothing.',
    dax: `COUNTROWS(TOPN(10, ${GROUPED}, [T], DESC))`,
    expected: 3,
  },
  {
    id: 'a-tie-keeps-both-rows',
    probes:
      'Grouped by Amount and counted: 200 and 600 each appear on two rows, ' +
      'everything else on one. TOPN(1) should return both tied groups, which ' +
      'Power BI already confirmed for a table of model rows - this asks ' +
      'whether it holds for a computed one.',
    dax:
      'COUNTROWS(TOPN(1, ADDCOLUMNS(VALUES(Sales[Amount]), "C", ' +
      'CALCULATE(COUNTROWS(Sales))), [C], DESC))',
    expected: 2,
  },
  {
    id: 'ordering-by-text-puts-blank-where',
    probes:
      'Sorted by Region rather than by a figure. Where a blank sorts in text ' +
      'order decides whether a breakdown opens or closes with the unlabelled ' +
      'group, which is the first thing a reader sees.',
    dax: `CONCATENATEX(TOPN(3, VALUES(Sales[Region]), Sales[Region], ASC), ${LABEL}, ">")`,
    expected: 'North>South>',
    returnsText: true,
    divergence: {
      engine: '(blank)>North>South',
      note: BLANK_LABEL_NOTE,
    },
    unorderedText: true,
  },
  {
    id: 'grouping-by-a-different-column',
    probes:
      'Gadget 4000, Widget 3600, and no blank product. Confirms the ranking is ' +
      'not accidentally specific to Region.',
    dax:
      'CONCATENATEX(TOPN(2, ADDCOLUMNS(VALUES(Sales[Product]), "T", ' +
      'CALCULATE(SUM(Sales[Amount]))), [T], DESC), Sales[Product] & "=" & [T], ">")',
    expected: 'Widget=3600>Gadget=4000',
    returnsText: true,
    unorderedText: true,
  },
  {
    id: 'blank-inside-concatenatex',
    probes:
      'The one case that does NOT dress the blank up. This engine drops empty ' +
      'strings, so it builds "North|South" - 11 characters. If Power BI keeps ' +
      'the blank as an empty slot it builds something 12 characters long, and ' +
      'the two disagree about every list either of them ever produces. Length ' +
      'rather than the text itself, so the answer does not depend on order.',
    dax: 'LEN(CONCATENATEX(VALUES(Sales[Region]), Sales[Region], "|"))',
    expected: 12,
  },
];

export const pendingTableCount = (): number =>
  TABLE_CASES.filter(entry => entry.expected === null).length;
