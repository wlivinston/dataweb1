// What a column's name and values say it is - for the analysis panels that
// pick columns on their own (Time Series, Advanced Stats).
//
// Picking the first numeric or first text column produced analyses with no
// meaning: a Pareto of participant ids by total age, a regression predicting
// age, a daily "total" of ages. These rules are shared so each panel decides
// the same way. Deliberately dependency-free.

const ADDITIVE_WORDS = [
  'amount', 'revenue', 'sales', 'sale', 'total', 'turnover', 'cost', 'costs', 'expense', 'expenses',
  'spend', 'profit', 'income', 'quantity', 'qty', 'units', 'count', 'volume', 'orders', 'visits',
  'minutes', 'hours', 'seconds', 'duration', 'days', 'held', 'pieces', 'calls', 'tickets',
];

const IDENTIFIER_WORDS = ['id', 'key', 'code', 'uuid', 'guid', 'number', 'no', 'num', 'ref', 'sku'];

const tokens = (name: string): string[] =>
  name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Whether a column's values add up to something meaningful over a group or a
 * period. Money, quantities, counts and durations do; ages, scores, ratings,
 * rates and prices do not - their "total" only measures how many rows there
 * were. Decided from whole words of the name; callers say on screen which
 * they chose, so a wrong guess is visible rather than silent.
 */
export const isAdditiveColumn = (name: string): boolean =>
  tokens(name).some(token => ADDITIVE_WORDS.includes(token));

/**
 * Whether a column identifies rows rather than describing them: an id-like
 * name, or values that are (nearly) all different. Grouping by one gives a
 * group per row, which no Pareto or bar chart can say anything useful about.
 */
export const isIdentifierLike = (name: string, values: readonly unknown[]): boolean => {
  if (tokens(name).some(token => IDENTIFIER_WORDS.includes(token))) return true;
  const present = values.filter(value => value !== null && value !== undefined && String(value).trim() !== '');
  if (present.length < 10) return false;
  const distinct = new Set(present.map(value => String(value).trim().toLowerCase())).size;
  return distinct / present.length > 0.9;
};
