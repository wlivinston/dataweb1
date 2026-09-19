import { parseDax } from './parser';
import { printDax } from './printer';
import { evaluateDax } from './evaluate';
import { validateDax, type DaxIssue } from './validate';
import { DaxError } from './errors';
import { isTable, type DaxScalar, type DaxValue } from './value';
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

export const runDax = (
  formula: string,
  model: SemanticModel,
  options: RunDaxOptions = {}
): DaxRunResult => {
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

  if (isTable(value)) {
    return {
      ok: false,
      message:
        'This expression returns a table. A calculation has to produce a single ' +
        'value - wrap it in an aggregation such as COUNTROWS or SUMX.',
      detail: null,
      issues,
    };
  }

  return {
    ok: true,
    value,
    normalised: printDax(expression),
    warnings: warningsOf(issues),
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
