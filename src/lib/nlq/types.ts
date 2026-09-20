import type { DaxScalar } from '../dax/value';
import type { DaxResultColumn } from '../dax/run';
import type { SemanticColumn } from '../semantic/types';

/**
 * A question asked in English, answered through the verified DAX engine.
 *
 * The engine this replaces computed every answer inline. Its AVERAGE read
 * `Number(null)` as 0, kept it past an isNaN filter, and divided by a row
 * count that included the blanks - 15 where the truth was 20. SUM agreed,
 * because adding zero is harmless, which is why it survived so long.
 *
 * So there is one implementation, and it is the same one Power BI checked:
 * a question compiles to DAX or it is refused. Nothing here computes an
 * answer of its own.
 */

/** No confidence score. The old one was the constant 0.95, on every answer,
 *  including the wrong ones. A number that is always the same measures
 *  nothing, and attaching it to a wrong answer is worse than saying nothing. */

export interface NlqAnswered {
  ok: true;
  /** One figure. */
  shape: 'scalar';
  question: string;
  /** The exact text the engine ran, so the answer can be checked. */
  dax: string;
  value: DaxScalar;
  formatted: string;
  /** What the question was taken to mean, in the model's own names. */
  interpretation: string;
  /** The column the answer is about, when there is one. */
  column?: SemanticColumn;
}

/**
 * A figure per group: "average revenue by region".
 *
 * Always ranked, even when the question did not ask for a ranking. An
 * unranked result that hits the row cap shows an arbitrary slice, and an
 * arbitrary 500 rows is indistinguishable on screen from the top 500 - a
 * true answer that invites a false conclusion. Ranking makes the rows that
 * come back the ones worth seeing, and makes the cap honest.
 */
export interface NlqTableAnswered {
  ok: true;
  shape: 'table';
  question: string;
  /** The exact text the engine ran, so the answer can be checked. */
  dax: string;
  columns: DaxResultColumn[];
  rows: DaxScalar[][];
  /** How many groups there were, before any cap. */
  totalRows: number;
  truncated: boolean;
  /** What the question was taken to mean, in the model's own names. */
  interpretation: string;
  /** The column grouped by, and the one measured. */
  groupColumn: SemanticColumn;
  measureColumn: SemanticColumn;
}

export interface NlqRefused {
  ok: false;
  question: string;
  /** Why, in a sentence someone can act on. Never "I didn't understand". */
  reason: string;
  /** Questions this model can actually answer, as a way forward. */
  suggestions: string[];
}

/**
 * Answered or refused, never both and never neither.
 *
 * Same shape as DaxRunResult, for the same reason: a result that can carry a
 * value and an error at once will eventually carry both, and the UI will
 * show the wrong one.
 */
export type NlqAnswer = NlqAnswered | NlqTableAnswered | NlqRefused;
