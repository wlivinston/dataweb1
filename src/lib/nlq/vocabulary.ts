/**
 * The words that pick an aggregation, and the words that carry no meaning.
 *
 * Kept as data rather than a chain of regexes. The engine this replaces had
 * 62 separate string-match sites, so the answer to "which phrasings work?"
 * could only be found by reading all of them - and adding a synonym meant
 * finding the right branch among them.
 */

export type AggregationFunction =
  | 'SUM'
  | 'AVERAGE'
  | 'MIN'
  | 'MAX'
  | 'COUNTROWS'
  | 'DISTINCTCOUNT';

export interface AggregationWord {
  dax: AggregationFunction;
  /** Longest first, so "how many distinct" beats "how many". */
  phrases: string[];
  /** Whether the column it applies to has to hold numbers. */
  needsNumeric: boolean;
  /** Used when explaining what the question was taken to mean. */
  describes: string;
}

export const AGGREGATIONS: AggregationWord[] = [
  {
    dax: 'DISTINCTCOUNT',
    phrases: [
      'how many distinct',
      'how many different',
      'how many unique',
      'number of distinct',
      'number of unique',
      'distinct count of',
      'unique count of',
      'distinct count',
      'unique count',
      'how many',
      'number of',
      'count of',
      'count',
    ],
    needsNumeric: false,
    describes: 'the number of different values in',
  },
  {
    dax: 'AVERAGE',
    phrases: ['average of', 'mean of', 'avg of', 'average', 'mean', 'avg', 'typical'],
    needsNumeric: true,
    describes: 'the average of',
  },
  {
    dax: 'SUM',
    phrases: ['total of', 'sum of', 'total', 'sum', 'combined', 'altogether'],
    needsNumeric: true,
    describes: 'the sum of',
  },
  {
    dax: 'MIN',
    phrases: [
      'minimum of',
      'lowest of',
      'smallest of',
      'minimum',
      'lowest',
      'smallest',
      'min',
      'cheapest',
    ],
    needsNumeric: true,
    describes: 'the smallest value of',
  },
  {
    dax: 'MAX',
    phrases: [
      'maximum of',
      'highest of',
      'largest of',
      'maximum',
      'highest',
      'largest',
      'biggest',
      'max',
      'most expensive',
    ],
    needsNumeric: true,
    describes: 'the largest value of',
  },
];

/**
 * Words that carry no meaning once the aggregation is known.
 *
 * Deliberately short. Stripping too much turns "number of orders" into
 * "orders" and then matches a column nobody named - the old engine's
 * findMatchingColumn did exactly that and reported 95% confidence about it.
 */
export const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'what',
  'whats',
  'which',
  'show',
  'tell',
  'give',
  'find',
  'get',
  'me',
  'my',
  'our',
  'us',
  'please',
  'there',
  'do',
  'does',
  'we',
  'have',
  'has',
  'in',
  'on',
  'at',
  'of',
  'for',
  'from',
  'across',
  'all',
]);

/**
 * Not stopwords, however much they read like filler: `Amount`, `Value` and
 * `Total` are among the commonest column names there are. The first draft of
 * this list had `amount` in it, directly below a comment warning against
 * stripping too much, and "average Amount" lost its subject entirely.
 */

/** Words that mean "a row", so a count of them is a count of the table. */
export const ROW_WORDS = new Set([
  'row',
  'rows',
  'record',
  'records',
  'entry',
  'entries',
  'item',
  'items',
  'line',
  'lines',
  'datapoint',
  'datapoints',
]);

export const normalise = (question: string): string =>
  question
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const words = (text: string): string[] =>
  normalise(text)
    .split(' ')
    .filter(word => word.length > 0);
