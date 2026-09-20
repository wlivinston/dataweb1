import { tokeniseColumnName } from '../semantic/roles';
import { STOPWORDS } from './vocabulary';
import type { SemanticColumn, SemanticModel, SemanticTable } from '../semantic/types';

/**
 * Match the words of a question to the things in the model.
 *
 * The rule the old engine broke: when two columns fit a phrase equally
 * well, say so. `findMatchingColumn` returned the first and reported 95%
 * confidence, so a model with CustomerID in two tables answered questions
 * about whichever table happened to be first.
 */

const EXACT_BONUS = 10;
const TOKEN_POINTS = 3;

/**
 * Scoring is on the name alone, with no thumb on the scale for the fact
 * table.
 *
 * The first draft gave a fact-table column one extra point. That is enough
 * to break a tie, so "how many different CustomerID" against a model with
 * CustomerID in both Orders and Customers quietly answered about Orders -
 * the exact behaviour this module exists to stop. A preference small enough
 * to look harmless still decides, and it decides invisibly.
 */

export type Resolution<T> =
  | { kind: 'found'; value: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'none' };

const compact = (text: string): string => text.toLowerCase().replace(/[\s_\-./]+/g, '');

/** The words of a phrase that might name something, stopwords removed. */
export const meaningfulWords = (phrase: string): string[] =>
  phrase
    .split(' ')
    .map(word => word.trim())
    .filter(word => word.length > 0 && !STOPWORDS.has(word));

const scoreAgainst = (terms: string[], name: string): number => {
  if (terms.length === 0) return 0;
  const nameTokens = new Set(tokeniseColumnName(name));
  const joined = compact(terms.join(' '));
  let score = 0;

  if (compact(name) === joined) score += EXACT_BONUS;
  for (const term of terms) {
    if (nameTokens.has(term.toLowerCase())) score += TOKEN_POINTS;
  }
  return score;
};

/**
 * Pick the one thing a phrase names, or report that it names none or several.
 *
 * Ties are ambiguous rather than broken arbitrarily. Two columns called
 * CustomerID in different tables are a real question the asker has to
 * settle, not a coin to flip on their behalf.
 */
const bestOf = <T>(items: T[], nameOf: (item: T) => string, terms: string[]): Resolution<T> => {
  const scored = items
    .map(item => ({ item, score: scoreAgainst(terms, nameOf(item)) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return { kind: 'none' };

  const top = scored[0].score;
  const tied = scored.filter(entry => entry.score === top);
  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.map(entry => entry.item) };
  return { kind: 'found', value: scored[0].item };
};

export const resolveColumn = (
  model: SemanticModel,
  terms: string[]
): Resolution<SemanticColumn> => {
  const columns = model.tables.flatMap(table =>
    table.columns.map(column => ({ column, table }))
  );
  const resolved = bestOf(columns, entry => entry.column.name, terms);
  if (resolved.kind === 'found') return { kind: 'found', value: resolved.value.column };
  if (resolved.kind === 'ambiguous') {
    return { kind: 'ambiguous', candidates: resolved.candidates.map(entry => entry.column) };
  }
  return { kind: 'none' };
};

export const resolveTable = (model: SemanticModel, terms: string[]): Resolution<SemanticTable> =>
  bestOf(model.tables, table => table.name, terms);

/**
 * The key column of a table, when it has exactly one.
 *
 * "How many orders" means distinct orders, not rows: the fixture has O1 on
 * two lines, so COUNTROWS says 6 and DISTINCTCOUNT(OrderID) says 5. Five is
 * what the question asked for. Which one ran is always stated in the
 * interpretation, so a reader who meant rows can see that and say so.
 */
export const soleKeyOf = (table: SemanticTable): SemanticColumn | null => {
  const keys = table.columns.filter(column => column.role === 'key');
  return keys.length === 1 ? keys[0] : null;
};
