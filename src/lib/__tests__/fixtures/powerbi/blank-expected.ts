import type { ParityCase } from './expected';

/**
 * What an empty cell becomes on import.
 *
 * The table sheet turned up one disagreement, repeated across five cases:
 * IF(ISBLANK(Sales[Region]), "(blank)", Sales[Region]) labels the O15 row
 * "(blank)" here and empty in Power BI. ISBLANK is therefore FALSE over
 * there and TRUE here, on the same CSV.
 *
 * The likely explanation is that Power BI imported the empty Region field as
 * an EMPTY STRING rather than BLANK. This engine converts it to BLANK in
 * fromCell, under a comment claiming that is what Power BI does. If that
 * claim is wrong it is wrong everywhere - COUNT, AVERAGE, DISTINCTCOUNT and
 * every filter on a text column - and no sheet so far could have caught it,
 * because all three tested BLANK() the literal rather than an imported
 * empty cell.
 *
 * These cases separate the possibilities. Each is scalar, and each answers
 * differently depending on which reading is right, so no case is decoration.
 */
export const BLANK_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes: 'If this is not 18, nothing below it means anything.',
    dax: 'COUNTROWS(Sales)',
    expected: null,
  },
  {
    id: 'countblank-on-the-text-column',
    probes:
      'THE decisive one. COUNTBLANK counts blanks and not empty strings. 1 ' +
      'means Power BI stored the empty Region as BLANK and the disagreement ' +
      'is somewhere else entirely. 0 means it stored an empty string, and ' +
      'this engine converts empty cells to BLANK when it should not.',
    dax: 'COUNTBLANK(Sales[Region])',
    expected: null,
  },
  {
    id: 'countblank-on-the-numeric-column',
    probes:
      'The same question for Amount, whose O16 cell is also empty. A number ' +
      'column has no empty string to fall back on, so this should be 1 ' +
      'whatever the answer above is - and if it is not, the disagreement is ' +
      'bigger than text handling.',
    dax: 'COUNTBLANK(Sales[Amount])',
    expected: null,
  },
  {
    id: 'rows-where-the-region-is-blank',
    probes:
      'ISBLANK used as a filter rather than a label, in case the label case ' +
      'was really about how IF or CONCATENATEX behaves rather than about the ' +
      'value. 1 if the cell is blank, 0 if it is an empty string.',
    dax: 'COUNTROWS(FILTER(Sales, ISBLANK(Sales[Region])))',
    expected: null,
  },
  {
    id: 'rows-where-the-region-equals-empty-text',
    probes:
      'BLANK = "" is TRUE in DAX, so this should be 1 under either reading. ' +
      'It is the control: an answer of 0 would mean the row is neither blank ' +
      'nor empty, and the third value is something else again.',
    dax: 'COUNTROWS(FILTER(Sales, Sales[Region] = ""))',
    expected: null,
  },
  {
    id: 'the-blank-row-looked-up-directly',
    probes:
      'Straight at the O15 row, with no grouping, no iterator and no derived ' +
      'table in the way. If this says NOT-BLANK the value really is an empty ' +
      'string; if it says BLANK then everything upstream of it is suspect ' +
      'rather than the import.',
    dax:
      'IF(ISBLANK(LOOKUPVALUE(Sales[Region], Sales[OrderID], "O15")), ' +
      '"BLANK", "NOT-BLANK")',
    expected: null,
    returnsText: true,
  },
  {
    id: 'non-blank-count-of-the-text-column',
    probes:
      'COUNTA counts non-blank values. 17 means the empty cell is blank; 18 ' +
      'means it counts as a value, which is the empty-string reading. Reaches ' +
      'the same question from the other side, so a single odd answer does not ' +
      'decide it on its own.',
    dax: 'COUNTA(Sales[Region])',
    expected: null,
  },
  {
    id: 'distinct-values-including-the-empty-one',
    probes:
      'Already known to be 3 from the grouping sheet, and repeated here as a ' +
      'consistency check: whatever the empty cell is, it is one distinct ' +
      'value. An answer of 2 would contradict an answer already recorded.',
    dax: 'DISTINCTCOUNT(Sales[Region])',
    expected: null,
  },
];

export const pendingBlankCount = (): number =>
  BLANK_CASES.filter(entry => entry.expected === null).length;
