/**
 * Ground truth from Power BI.
 *
 * Every other test in this suite is checked against my own reading of DAX.
 * The invariant harness closed the mechanical half of that - filters commute,
 * totals equal the sum of their parts - but no property test can catch a
 * reading that is wrong CONSISTENTLY. If SAMEPERIODLASTYEAR is off by a day
 * in the same direction everywhere, every law still holds.
 *
 * So these are the cases where my interpretation is a judgement call rather
 * than a derivation, each one written so that different readings give
 * different numbers. `expected` stays null until someone reads the value off
 * Power BI; the parity test skips a null case and runs a filled one, so the
 * file is useful as soon as a single row is answered.
 *
 * See README.md in this folder for how to produce the numbers.
 */

export interface ParityCase {
  id: string;
  /** What is being probed, and why my answer might differ. */
  probes: string;
  /** Paste this into Power BI verbatim. */
  dax: string;
  /**
   * The same expression against this engine, when the text has to differ.
   * Left undefined when `dax` runs unchanged, which is the normal case.
   */
  engineDax?: string;
  /**
   * What Power BI showed. null = not yet answered.
   * Use the string 'BLANK' for an empty card, and 'ERROR' if it refuses.
   */
  expected: number | string | null;
  /**
   * This engine refuses the expression on purpose, and the case exists to
   * find out whether Power BI does too. A refusal here is the answer being
   * tested, not a gap in the sheet.
   */
  engineRefuses?: true;
  /**
   * The expression yields text rather than a number, so the generated Power
   * BI script must not push it through FORMAT.
   */
  returnsText?: true;
  /** Anything worth recording about how it behaved. */
  note?: string;
}

/**
 * Answered 2026-09-19 against Power BI Desktop, on the model described in
 * README.md: sales joined many-to-one, single direction, to a CALENDAR date
 * table covering 2023-01-01 to 2024-12-31.
 */
export const PARITY_CASES: ParityCase[] = [
  // ----------------------------------------------------------
  // Setup checks. If any of these three disagree, the model was
  // loaded differently and nothing below can be trusted.
  // ----------------------------------------------------------
  {
    id: 'setup-total',
    probes: 'The data loaded identically. Any mismatch means a bad import, not a DAX difference.',
    dax: 'SUM(Sales[Amount])',
    expected: 7600,
  },
  {
    id: 'setup-rows',
    probes: 'Row count, including the row with no Amount.',
    dax: 'COUNTROWS(Sales)',
    expected: 18,
  },
  {
    id: 'setup-count',
    probes: 'COUNT skips blanks; COUNTROWS does not. Confirms the blank Amount survived the import.',
    dax: 'COUNT(Sales[Amount])',
    expected: 17,
  },

  // ----------------------------------------------------------
  // Blank semantics. DAX is genuinely strange here and I reproduced
  // the strangeness deliberately rather than correcting it.
  // ----------------------------------------------------------
  {
    id: 'blank-distinctcount',
    probes: 'Whether DISTINCTCOUNT counts BLANK as one of the distinct values. Two named regions plus one blank.',
    dax: 'DISTINCTCOUNT(Sales[Region])',
    expected: 3,
  },
  {
    id: 'blank-not-equal',
    probes: 'Whether a blank Region satisfies <> "North". If it does, the 200 from O15 is included.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] <> "North")',
    expected: 4000,
  },
  {
    id: 'blank-average-denominator',
    probes: 'Whether AVERAGE divides by 17 (non-blank) or 18 (all rows).',
    dax: 'AVERAGE(Sales[Amount])',
    expected: 447.0588235294,
  },
  {
    id: 'blank-divide-by-zero',
    probes: 'DIVIDE guards division by zero and returns BLANK.',
    dax: 'DIVIDE(1, 0)',
    expected: 'BLANK',
  },
  {
    id: 'blank-slash-by-zero',
    probes: 'The / operator does NOT guard, and differs from DIVIDE. Expect Infinity or an error.',
    dax: '1 / 0',
    expected: 'Infinity',
    note: 'Power BI returned an infinity; FORMAT rendered it as "inf".',
  },
  {
    id: 'blank-equals-zero',
    probes: 'BLANK() = 0 is TRUE in DAX, which surprises everyone. Confirming I kept it.',
    dax: 'IF(BLANK() = 0, "YES", "NO")',
    returnsText: true,
    expected: 'YES',
  },
  {
    id: 'blank-empty-aggregation',
    probes: 'An aggregation over no rows returns BLANK, not 0.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Nowhere")',
    expected: 'BLANK',
  },

  // ----------------------------------------------------------
  // Time intelligence on the calendar year. The month-end and
  // leap-day rows exist precisely for these.
  // ----------------------------------------------------------
  {
    id: 'time-totalytd-calendar',
    probes: 'Year to date at 30 June 2024 on a calendar year.',
    dax: "CALCULATE(TOTALYTD(SUM(Sales[Amount]), 'Date'[Date]), 'Date'[Date] = DATE(2024, 6, 30))",
    expected: 3500,
  },
  {
    id: 'time-sameperiodlastyear-leap-day',
    probes:
      '29 February 2024 shifted back a year. There is no 29 February 2023, so this is entirely a judgement call: 28 Feb 2023, or blank.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR('Date'[Date])), 'Date'[Date] = DATE(2024, 2, 29))",
    expected: 150,
  },
  {
    id: 'time-dateadd-month-end',
    probes:
      '31 March 2024 shifted back one month. February has no 31st, so this tests whether the day clamps to the 29th, the 28th, or vanishes.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), DATEADD('Date'[Date], -1, MONTH)), 'Date'[Date] = DATE(2024, 3, 31))",
    expected: 500,
  },
  {
    id: 'time-previousmonth',
    probes: 'PREVIOUSMONTH returns the WHOLE previous month, not the same day of it.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), PREVIOUSMONTH('Date'[Date])), 'Date'[Date] = DATE(2024, 3, 15))",
    expected: 950,
  },
  {
    id: 'time-previousyear',
    probes: 'PREVIOUSYEAR returns the whole of 2023 from a single day in 2024.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), PREVIOUSYEAR('Date'[Date])), 'Date'[Date] = DATE(2024, 3, 15))",
    expected: 1000,
  },
  {
    id: 'time-datesinperiod-boundary',
    probes:
      'Whether the start date is included in the span. Three months back from 31 March 2024.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), DATESINPERIOD('Date'[Date], DATE(2024, 3, 31), -3, MONTH)), ALL(Sales))",
    expected: 2850,
  },

  // ----------------------------------------------------------
  // Fiscal year. This is the judgement call I flagged as most
  // likely to be wrong, because I default to the calendar year
  // even when a fiscal year is configured.
  // ----------------------------------------------------------
  {
    id: 'fiscal-datesytd-june-end',
    probes:
      'Year to date at 30 September 2024 for a fiscal year ending 30 June. Should cover 1 July to 30 September only.',
    dax: "CALCULATE(CALCULATE(SUM(Sales[Amount]), DATESYTD('Date'[Date], \"6/30\")), 'Date'[Date] = DATE(2024, 9, 30))",
    expected: 1450,
  },
  {
    id: 'fiscal-totalytd-june-end',
    probes: 'The same fiscal year at 31 December 2024, through TOTALYTD rather than DATESYTD.',
    dax: "CALCULATE(TOTALYTD(SUM(Sales[Amount]), 'Date'[Date], \"6/30\"), 'Date'[Date] = DATE(2024, 12, 31))",
    expected: 3100,
  },

  // ----------------------------------------------------------
  // How a CALCULATE filter's right-hand side is evaluated.
  // ----------------------------------------------------------
  {
    id: 'filter-rhs-measure',
    probes:
      'A measure on the right of a boolean filter. Sums only the rows above the overall average.',
    dax: 'CALCULATE(SUM(Sales[Amount]), Sales[Amount] > AVERAGE(Sales[Amount]))',
    expected: 5650,
  },
  {
    id: 'filter-rhs-row-context',
    probes:
      'Inside SUMX there IS a row context. Whether DAX resolves the right-hand side against the iterated row, or refuses, decides this. This engine refuses rather than guess. If Power BI returns a number, my reading is too strict and should change.',
    dax: 'SUMX(Sales, CALCULATE(SUM(Sales[Amount]), Sales[Amount] = Sales[Amount] * 1))',
    expected: 7600,
    note:
      'Power BI DOES resolve the right-hand side against the iterated row, and returns the ' +
      'grand total. This engine refused it until 2026-09-19; the refusal was too strict.',
  },

  // ----------------------------------------------------------
  // Ranking, ties and statistics.
  // ----------------------------------------------------------
  {
    id: 'topn-includes-ties',
    probes:
      'Two rows share 600. TOPN is documented to return every tied row, so asking for 5 should give 6.',
    dax: 'COUNTROWS(TOPN(5, ALL(Sales), Sales[Amount], DESC))',
    expected: 6,
  },
  {
    id: 'stats-median',
    probes: 'Median over 17 non-blank values.',
    dax: 'MEDIAN(Sales[Amount])',
    expected: 450,
  },
  {
    id: 'stats-percentile-interpolation',
    probes:
      'PERCENTILE.INC interpolates between values. The exact convention is the thing being checked.',
    dax: 'PERCENTILE.INC(Sales[Amount], 0.9)',
    expected: 720,
  },

  // ----------------------------------------------------------
  // Week numbering. ISO weeks do not agree with the calendar year
  // at the boundary, which is the whole point.
  // ----------------------------------------------------------
  {
    id: 'week-iso-jan-1-monday',
    probes: '1 January 2024 is a Monday, so ISO week 1 starts exactly there.',
    dax: 'WEEKNUM(DATE(2024, 1, 1), 21)',
    expected: 1,
  },
  {
    id: 'week-iso-jan-1-sunday',
    probes:
      '1 January 2023 is a Sunday, which ISO assigns to the last week of 2022. A naive implementation says 1.',
    dax: 'WEEKNUM(DATE(2023, 1, 1), 21)',
    expected: 52,
  },
];

/** How many still need an answer. */
export const pendingCount = (): number =>
  PARITY_CASES.filter(entry => entry.expected === null).length;
