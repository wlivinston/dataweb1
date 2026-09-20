import { PARITY_CASES } from './expected';
import { GROUPING_CASES } from './grouping-expected';
import type { ResolvedMeasure } from '../../../measures';

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

/**
 * The table name has to be the FIRST line, before any comment.
 *
 * Power BI's New Table box reads everything up to the first `=` as the name.
 * A comment header above the assignment is therefore not a header at all -
 * it becomes part of the table name, and the model ends up with a table
 * called `// Paste this into Power BI Desktop: ...`. Found by pasting, not by
 * any test here; DAX itself is perfectly happy either way.
 *
 * Comments after the `=` are fine, so the guidance survives - it just has to
 * sit below the name rather than above it.
 */
const assignTo = (tableName: string, comments: string[], body: string[]): string =>
  [`${tableName} =`, ...comments.map(line => `// ${line}`.trimEnd()), ...body, ''].join('\n');

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

  return assignTo(
    'ParityResults',
    [
      'Paste this into Power BI Desktop: Modeling > New table.',
      'Put Case and Answer into a Table visual and send the result back.',
      '',
      `Generated from expected.ts - ${PARITY_CASES.length} cases.`,
    ],
    ['UNION(', rows.join(',\n'), ')']
  );
};

// ============================================================
// The measure library, as one pasteable table
// ============================================================

/**
 * Wrap an expression so it can sit inside ROW().
 *
 * Two of the measures are VAR/RETURN blocks. Those are expressions, but they
 * need parentheses to nest inside a function call - and IFERROR cannot
 * rescue a syntax error, it would take the whole table down with it.
 */
const asArgument = (dax: string): string =>
  dax.includes('\n') ? `(\n${dax}\n    )` : dax;

/**
 * A calculated table answering every resolved measure at once.
 *
 * The DAX embedded here is exactly what the library emits - not a
 * re-rendering of it. Verifying a paraphrase would prove nothing about what
 * the product actually runs.
 */
export const buildMeasureScript = (measures: ResolvedMeasure[]): string => {
  const rows = measures.map((measure, index) => {
    const position = String(index + 1).padStart(2, '0');
    const expression = asArgument(measure.dax);
    return (
      `    ROW("Measure", "${position} ${measure.template.id}", "Answer", ` +
      `IFERROR(IF(ISBLANK(${expression}), "BLANK", FORMAT(${expression}, "${NUMBER_FORMAT}")), "ERROR"))`
    );
  });

  return assignTo(
    'MeasureResults',
    [
      'Paste into Power BI Desktop: Modeling > New table.',
      'Needs the Orders table from orders.csv, joined to Date, and a Year',
      'column on Date. See README.md.',
      '',
      `Generated from the measure library - ${measures.length} measures.`,
    ],
    ['UNION(', rows.join(',\n'), ')']
  );
};

// ============================================================
// Grouping, as one pasteable table
// ============================================================

/**
 * The grouping cases, against sales.csv from the first parity round.
 *
 * Deliberately all scalar. Comparing whole tables needs a harness that does
 * not exist, and the risky part is the semantics rather than the shape - a
 * single number settles whether context transition through data lineage is
 * right, and settling it before anything is built on top is the cheap order
 * to do it in.
 */
export const buildGroupingScript = (): string => {
  const rows = GROUPING_CASES.map((entry, index) => {
    const position = String(index + 1).padStart(2, '0');
    const answer = answerExpression(entry.dax, entry.returnsText === true);
    return `    ROW("Case", "${position} ${entry.id}", "Answer", ${answer})`;
  });

  return assignTo(
    'GroupingResults',
    [
      'Paste into Power BI Desktop: Modeling > New table.',
      'Runs against the Sales table from sales.csv - already loaded.',
      'Put Case and Answer into a Table visual and send the result back.',
      '',
      `Generated from grouping-expected.ts - ${GROUPING_CASES.length} cases.`,
    ],
    ['UNION(', rows.join(',\n'), ')']
  );
};
