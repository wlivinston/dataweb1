import { PARITY_CASES } from './expected';

/**
 * Generate a single Power BI calculated table that answers every parity case
 * at once.
 *
 * The alternative is 25 measures and 25 card visuals, which is 25 chances to
 * paste the wrong thing next to the wrong label. One table, one visual, and
 * the case id travels with its own answer.
 *
 * Every row is wrapped in IFERROR, so an expression Power BI refuses - a
 * fiscal year end its locale cannot read, say - yields "ERROR" for that row
 * instead of failing the whole table. A refusal is itself an answer worth
 * recording.
 *
 * Generated rather than hand-written so the expressions cannot drift from
 * the ones the parity test actually runs; a test asserts the committed
 * .dax file still matches this.
 */

/** Full precision, no thousands separators, so nothing is lost to rounding. */
const NUMBER_FORMAT = '0.##########';

const answerExpression = (dax: string, returnsText: boolean): string =>
  returnsText
    ? `IFERROR(${dax}, "ERROR")`
    : `IFERROR(IF(ISBLANK(${dax}), "BLANK", FORMAT(${dax}, "${NUMBER_FORMAT}")), "ERROR")`;

export const buildPowerBiScript = (): string => {
  const rows = PARITY_CASES.map((entry, index) => {
    // Numbered so the table visual sorts the way the sheet reads.
    const position = String(index + 1).padStart(2, '0');
    const answer = answerExpression(entry.dax, entry.returnsText === true);
    return `    ROW("Case", "${position} ${entry.id}", "Answer", ${answer})`;
  });

  return [
    '// Paste this into Power BI Desktop: Modeling > New table.',
    '// It creates a table called ParityResults with one row per case.',
    '// Put Case and Answer into a Table visual and send the result back.',
    '//',
    `// Generated from expected.ts - ${PARITY_CASES.length} cases.`,
    '',
    'ParityResults =',
    'UNION(',
    rows.join(',\n'),
    ')',
    '',
  ].join('\n');
};
