import type { ParityCase } from './expected';

/**
 * What an empty cell becomes on import. ANSWERED 2026-09-20.
 *
 * The table sheet turned up one disagreement repeated across five cases:
 * IF(ISBLANK(Sales[Region]), "(blank)", ...) labelled the O15 row "(blank)"
 * here and empty in Power BI, on the same file.
 *
 * Power BI's Text/CSV connector stores an empty text field as an EMPTY
 * STRING, not BLANK. Three answers say so together and none of them says it
 * alone:
 *
 *   COUNTA(Sales[Region])                       18 there, 17 here
 *   COUNTROWS(FILTER(Sales, ISBLANK(Region)))   no rows there, 1 here
 *   LOOKUPVALUE at O15, through ISBLANK         NOT-BLANK there, BLANK here
 *
 * COUNTBLANK was written as the decisive case and was nothing of the kind:
 * it counts empty strings as well as blanks, so its answer of 1 fits either
 * reading. The sheet only came out right because the other cases were added
 * on the principle that no single odd answer should decide anything.
 *
 * The divergence is kept rather than fixed. An empty cell in a CSV means
 * "missing", and this product reports missingness - null counts,
 * completeness, and the "N blank rows are left out" note in an answer.
 * Treating "" as a value would make completeness report 100% on data with
 * empty cells: a quieter and worse failure than disagreeing about ISBLANK.
 *
 * Nothing already verified is affected. Filters agree, because BLANK = "" is
 * TRUE in DAX. DISTINCTCOUNT and grouping agree, because either way it is
 * one distinct value. Numeric columns are BLANK in both. What differs is
 * ISBLANK and COUNTA on a text column with empty cells, and nothing else.
 */
/** The deliberate divergence these cases pinned down. */
const EMPTY_CELL_NOTE =
  "Power BI's Text/CSV connector stores an empty text field as an empty " +
  'string; this engine converts it to BLANK on purpose, so that missingness ' +
  'stays visible to completeness and null counts. Deliberate, narrow, and ' +
  'reversible in one line of fromCell if matching the raw connector ever ' +
  'matters more than reporting what is missing.';

export const BLANK_CASES: ParityCase[] = [
  {
    id: 'canary-the-table-actually-has-rows',
    probes: 'If this is not 18, nothing below it means anything.',
    dax: 'COUNTROWS(Sales)',
    expected: 18,
  },
  {
    id: 'countblank-on-the-text-column',
    probes:
      'Billed as the decisive case, and it was not. The claim written here - ' +
      'that COUNTBLANK counts blanks and not empty strings - is false: it ' +
      'counts both, so 1 is consistent with either reading and settles ' +
      'nothing. The cases below settled it instead, which is the only reason ' +
      'the sheet was not read the wrong way round.',
    dax: 'COUNTBLANK(Sales[Region])',
    expected: 1,
  },
  {
    id: 'countblank-on-the-numeric-column',
    probes:
      'The same question for Amount, whose O16 cell is also empty. A number ' +
      'column has no empty string to fall back on, so this should be 1 ' +
      'whatever the answer above is - and if it is not, the disagreement is ' +
      'bigger than text handling.',
    dax: 'COUNTBLANK(Sales[Amount])',
    expected: 1,
  },
  {
    id: 'rows-where-the-region-is-blank',
    probes:
      'ISBLANK used as a filter rather than a label, in case the label case ' +
      'was really about how IF or CONCATENATEX behaves rather than about the ' +
      'value. 1 if the cell is blank, 0 if it is an empty string.',
    dax: 'COUNTROWS(FILTER(Sales, ISBLANK(Sales[Region])))',
    expected: 'BLANK',
    divergence: {
      engine: '1',
      note: EMPTY_CELL_NOTE,
    },
  },
  {
    id: 'rows-where-the-region-equals-empty-text',
    probes:
      'BLANK = "" is TRUE in DAX, so this should be 1 under either reading. ' +
      'It is the control: an answer of 0 would mean the row is neither blank ' +
      'nor empty, and the third value is something else again.',
    dax: 'COUNTROWS(FILTER(Sales, Sales[Region] = ""))',
    expected: 1,
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
    expected: 'NOT-BLANK',
    divergence: {
      engine: 'BLANK',
      note: EMPTY_CELL_NOTE,
    },
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
    expected: 18,
    divergence: {
      engine: '17',
      note: EMPTY_CELL_NOTE,
    },
  },
  {
    id: 'distinct-values-including-the-empty-one',
    probes:
      'Already known to be 3 from the grouping sheet, and repeated here as a ' +
      'consistency check: whatever the empty cell is, it is one distinct ' +
      'value. An answer of 2 would contradict an answer already recorded.',
    dax: 'DISTINCTCOUNT(Sales[Region])',
    expected: 3,
  },
];

export const pendingBlankCount = (): number =>
  BLANK_CASES.filter(entry => entry.expected === null).length;
