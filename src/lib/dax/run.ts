import { parseDax } from './parser';
import { printDax } from './printer';
import { evaluateDax } from './evaluate';
import { validateDax, type DaxIssue } from './validate';
import { DaxError } from './errors';
import { isDerived, isTable, type DaxScalar, type DaxTable, type DaxValue } from './value';
import { findTable } from '../semantic/model';
import { cellValue } from './context';
import type { SemanticModel } from '../semantic/types';

/**
 * The single entry point the UI uses to run a DAX expression.
 *
 * It exists so that no caller has to remember the order of parse, validate
 * and evaluate, and - more importantly - so that no caller can accidentally
 * turn a failure into a number. The result is a discriminated union: there is
 * no shape of it that carries both a value and an error, and no shape that
 * carries neither.
 *
 * This replaces `executeDAXCalculation`, which matched substrings against the
 * formula text and returned `null` for everything it did not recognise. A
 * `null` is indistinguishable from a genuine BLANK, so a misunderstood
 * formula and an empty result looked identical in the UI.
 */

export interface DaxRunSuccess {
  ok: true;
  value: DaxScalar;
  /** The expression as the parser understood it, for display. */
  normalised: string;
  /** Non-fatal remarks, e.g. a function the catalogue knows but cannot run. */
  warnings: DaxIssue[];
}

export interface DaxRunFailure {
  ok: false;
  /** One line, safe to show to a non-technical user. */
  message: string;
  /** The caret-underlined rendering, when a position is known. */
  detail: string | null;
  issues: DaxIssue[];
}

export type DaxRunResult = DaxRunSuccess | DaxRunFailure;

export interface RunDaxOptions {
  /** Fixes TODAY() and NOW(), so a result is reproducible. */
  today?: Date;
  /**
   * Refuse expressions using functions the catalogue lists but the evaluator
   * cannot run, before attempting them. On by default here: the UI wants the
   * explanation up front rather than an exception part-way through.
   */
  requireImplemented?: boolean;
}

/** Errors only. Warnings never block evaluation. */
const errorsOf = (issues: DaxIssue[]): DaxIssue[] =>
  issues.filter(issue => issue.severity === 'error');

const warningsOf = (issues: DaxIssue[]): DaxIssue[] =>
  issues.filter(issue => issue.severity !== 'error');

/**
 * Underline a span of the source, the way DaxError.format does.
 *
 * Validation issues carry positions but are not thrown, so they need the
 * same rendering built for them.
 */
const underline = (source: string, start: number, length: number, message: string): string => {
  const safeStart = Math.max(0, Math.min(start, source.length));
  const safeLength = Math.max(1, length);
  return `${source}\n${' '.repeat(safeStart)}${'^'.repeat(safeLength)} ${message}`;
};

/** Everything both entry points share: parse, validate, evaluate. */
interface Evaluated {
  ok: true;
  value: DaxValue;
  normalised: string;
  issues: DaxIssue[];
}

const evaluateOnce = (
  formula: string,
  model: SemanticModel,
  options: RunDaxOptions = {}
): Evaluated | DaxRunFailure => {
  const source = formula.trim();

  if (source.length === 0) {
    return {
      ok: false,
      message: 'The formula is empty.',
      detail: null,
      issues: [],
    };
  }

  let expression;
  try {
    expression = parseDax(source);
  } catch (error) {
    if (error instanceof DaxError) {
      return {
        ok: false,
        message: error.message,
        detail: error.format(),
        issues: [
          {
            code: 'syntax',
            severity: 'error',
            message: error.message,
            start: error.position,
            length: error.length,
          },
        ],
      };
    }
    throw error;
  }

  const issues = validateDax(expression, model, {
    requireImplemented: options.requireImplemented ?? true,
  });

  const errors = errorsOf(issues);
  if (errors.length > 0) {
    const first = errors[0];
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
    return {
      ok: false,
      message: `${first.message}${more}`,
      detail: underline(source, first.start, first.length, first.message),
      issues,
    };
  }

  // A function the catalogue recognises but the evaluator cannot run is
  // reported by validateDax as a warning, because a measure may legitimately
  // be stored and exported before it can be evaluated. Asking for a number is
  // the one moment where that distinction stops being academic.
  const notImplemented = issues.filter(issue => issue.code === 'not_implemented');
  if (notImplemented.length > 0) {
    const first = notImplemented[0];
    return {
      ok: false,
      message: first.message,
      detail: underline(source, first.start, first.length, first.message),
      issues,
    };
  }

  let value: DaxValue;
  try {
    value = evaluateDax(source, model, { today: options.today });
  } catch (error) {
    if (error instanceof DaxError) {
      return {
        ok: false,
        message: error.message,
        detail: error.source.length > 0 ? error.format() : null,
        issues,
      };
    }
    // Not a DAX error, so it is a defect in this engine rather than in the
    // user's formula. Say so plainly instead of dressing it up as a syntax
    // problem, and keep the original text.
    const text = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `The engine failed while evaluating this expression: ${text}`,
      detail: null,
      issues,
    };
  }

  return { ok: true, value, normalised: printDax(expression), issues };
};

/**
 * Run an expression that must produce a single value.
 *
 * A table is refused here rather than rendered, because a calculation tile
 * showing three columns where a number was asked for is a worse answer than
 * a refusal. `runDaxTable` is the entry point for expressions that are
 * meant to return a table.
 */
export const runDax = (
  formula: string,
  model: SemanticModel,
  options: RunDaxOptions = {}
): DaxRunResult => {
  const outcome = evaluateOnce(formula, model, options);
  if (!outcome.ok) return outcome;

  if (isTable(outcome.value)) {
    return {
      ok: false,
      message:
        'This expression returns a table. A calculation has to produce a single ' +
        'value - wrap it in an aggregation such as COUNTROWS or SUMX.',
      detail: null,
      issues: outcome.issues,
    };
  }

  return {
    ok: true,
    value: outcome.value,
    normalised: outcome.normalised,
    warnings: warningsOf(outcome.issues),
  };
};

/**
 * Check an expression without running it.
 *
 * Used while the user is typing, where evaluating on every keystroke would
 * be wasteful and, on a large model, slow.
 */
export const checkDax = (formula: string, model: SemanticModel): DaxIssue[] => {
  const source = formula.trim();
  if (source.length === 0) return [];
  try {
    return validateDax(parseDax(source), model, { requireImplemented: true });
  } catch (error) {
    if (error instanceof DaxError) {
      return [
        {
          code: 'syntax',
          severity: 'error',
          message: error.message,
          start: error.position,
          length: error.length,
        },
      ];
    }
    throw error;
  }
};

/**
 * Render a result for display.
 *
 * BLANK is shown as the word, not as an empty cell and not as 0. "No rows
 * matched" and "the total is zero" are different answers, and the whole point
 * of the rewrite is that the UI stops conflating them.
 */
/** The three outcomes a calculation can have, as a caller must handle them. */
export interface CalculationOutcome {
  result?: DaxScalar;
  error?: string;
  /** True once evaluation was attempted, whatever came back. */
  evaluated?: boolean;
}

/**
 * Describe a calculation's outcome in one line.
 *
 * Three outcomes, three different things to say. Exported so the screen and
 * the exported report cannot drift apart: the PDF versions of this printed
 * "Not executed" for a failure, a blank and a genuinely unevaluated card
 * alike, which is the same conflation in the one artefact that gets
 * forwarded to someone without the app in front of them.
 */
export const describeCalculationOutcome = (calculation: CalculationOutcome): string => {
  if (calculation.error) return `Failed: ${calculation.error}`;
  if (!calculation.evaluated) return 'Not executed';
  return formatDaxValue(calculation.result ?? null);
};

export const formatDaxValue = (value: DaxScalar): string => {
  if (value === null) return 'BLANK';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return value;
};

// ============================================================
// Expressions that return a table
// ============================================================

/**
 * A column of a table result.
 *
 * `origin` survives from the engine's data lineage, so a caller can tell a
 * grouping column apart from a figure computed over it - which is what a
 * renderer needs in order to right-align one and not the other, and what an
 * export needs in order to say where a value came from.
 */
export interface DaxResultColumn {
  name: string;
  origin?: { table: string; column: string };
}

export interface DaxTableSuccess {
  ok: true;
  columns: DaxResultColumn[];
  /** Row-major, each row the same length as `columns`. */
  rows: DaxScalar[][];
  /** How many rows the expression produced, before any cap. */
  totalRows: number;
  /** True when `rows` holds fewer than `totalRows`. */
  truncated: boolean;
  normalised: string;
  warnings: DaxIssue[];
}

export type DaxTableRunResult = DaxTableSuccess | DaxRunFailure;

/**
 * How many rows come back unless a caller says otherwise.
 *
 * A grouping over a high-cardinality column can produce as many rows as the
 * table has, and handing a hundred thousand of them to a React render is a
 * hang rather than an answer. The cap is reported rather than hidden, so a
 * caller can say "showing 500 of 40,000" instead of quietly lying about how
 * much there was.
 */
export const DEFAULT_ROW_LIMIT = 500;

export interface RunDaxTableOptions extends RunDaxOptions {
  limit?: number;
}

/**
 * Run an expression that must produce a table.
 *
 * The mirror of `runDax`: a scalar is refused here for the same reason a
 * table is refused there. Both return the same failure shape, so a caller
 * that does not know which it will get can report either the same way.
 */
export const runDaxTable = (
  formula: string,
  model: SemanticModel,
  options: RunDaxTableOptions = {}
): DaxTableRunResult => {
  const outcome = evaluateOnce(formula, model, options);
  if (!outcome.ok) return outcome;

  if (!isTable(outcome.value)) {
    return {
      ok: false,
      message:
        'This expression returns a single value rather than a table. Use it as a ' +
        'calculation, or group it with VALUES to get one row per value.',
      detail: null,
      issues: outcome.issues,
    };
  }

  const limit = Math.max(0, options.limit ?? DEFAULT_ROW_LIMIT);
  const materialised = materialise(outcome.value, model, limit);

  const warnings = warningsOf(outcome.issues);
  if (materialised.truncated) {
    // Which rows were kept depends on the order the expression produced,
    // and an expression that did not rank anything has no meaningful
    // order. Saying so is the difference between "the top 500" and "500 of
    // them, arbitrarily" - and only one of those is true here.
    warnings.push({
      code: 'truncated',
      severity: 'warning',
      message:
        `Showing ${materialised.rows.length} of ${materialised.totalRows} rows. ` +
        'These are the first rows the expression produced, not the largest - ' +
        'rank it with TOPN to choose which ones you get.',
      start: 0,
      length: Math.max(1, formula.trim().length),
    });
  }

  return {
    ok: true,
    columns: materialised.columns,
    rows: materialised.rows,
    totalRows: materialised.totalRows,
    truncated: materialised.truncated,
    normalised: outcome.normalised,
    warnings,
  };
};

/**
 * Turn an engine table into plain columns and values.
 *
 * A row set holds indices into a model table and a derived table holds its
 * own values, so this is where that distinction stops mattering: callers
 * outside the engine see one shape either way.
 */
const materialise = (
  table: DaxTable,
  model: SemanticModel,
  limit: number
): { columns: DaxResultColumn[]; rows: DaxScalar[][]; totalRows: number; truncated: boolean } => {
  const totalRows = table.rows.length;
  const truncated = totalRows > limit;

  if (isDerived(table)) {
    return {
      columns: table.columns.map(column => ({ name: column.name, origin: column.origin })),
      rows: table.rows.slice(0, limit),
      totalRows,
      truncated,
    };
  }

  const owner = findTable(model, table.table);
  if (!owner) return { columns: [], rows: [], totalRows: 0, truncated: false };

  const columns: DaxResultColumn[] = owner.columns.map(column => ({
    name: column.name,
    origin: { table: owner.name, column: column.name },
  }));

  const rows = table.rows
    .slice(0, limit)
    .map(rowIndex =>
      owner.columns.map(column => cellValue(model, owner.name, column.name, rowIndex))
    );

  return { columns, rows, totalRows, truncated };
};
