import { runDax, formatDaxValue } from '../dax/run';
import { columnRef, tableRef } from '../dax/printer';
import { AGGREGATIONS, ROW_WORDS, normalise } from './vocabulary';
import { meaningfulWords, resolveColumn, resolveTable, soleKeyOf } from './resolve';
import type { AggregationWord } from './vocabulary';
import type { NlqAnswer } from './types';
import type { SemanticColumn, SemanticModel, SemanticTable } from '../semantic/types';

export * from './types';
export { AGGREGATIONS } from './vocabulary';

/**
 * Answer a question by compiling it to DAX and running it through the
 * engine Power BI checked.
 *
 * Nothing here adds up a column. If a question cannot be expressed as DAX it
 * is refused, with the reason and a way forward - which loses some answers
 * the old engine gave, including ones that happened to be right. That trade
 * was made deliberately: the old engine's AVERAGE divided by a row count
 * that counted blanks as zeros, and reported 95% confidence in the result.
 */

/** The table a bare "how many rows" is about. */
const defaultTable = (model: SemanticModel): SemanticTable | null => {
  const facts = model.tables.filter(table => table.role === 'fact');
  if (facts.length === 1) return facts[0];
  const real = model.tables.filter(table => table.name !== model.dateTableName);
  return real.length === 1 ? real[0] : null;
};

/** Questions this model can answer, offered whenever one is refused. */
export const suggestQuestions = (model: SemanticModel): string[] => {
  const out: string[] = [];
  const measures = model.tables
    .filter(table => table.name !== model.dateTableName)
    .flatMap(table => table.columns)
    .filter(column => column.role === 'measure');

  if (measures[0]) out.push(`What is the total ${measures[0].name}?`);
  if (measures[1]) out.push(`What is the average ${measures[1].name}?`);
  else if (measures[0]) out.push(`What is the average ${measures[0].name}?`);

  const table = defaultTable(model);
  const key = table ? soleKeyOf(table) : null;
  if (key) out.push(`How many ${key.name}?`);
  else if (table) out.push(`How many rows are there in ${table.name}?`);

  return out.slice(0, 3);
};

const refuse = (model: SemanticModel, question: string, reason: string): NlqAnswer => ({
  ok: false,
  question,
  reason,
  suggestions: suggestQuestions(model),
});

/** The aggregation a question asks for, and the words left over. */
interface Parsed {
  aggregation: AggregationWord;
  subject: string[];
}

const parse = (question: string): Parsed | null => {
  const text = normalise(question);
  const candidates = AGGREGATIONS.flatMap(aggregation =>
    aggregation.phrases.map(phrase => ({ aggregation, phrase }))
  )
    // Longest first, so "how many distinct" is not read as "how many".
    .sort((left, right) => right.phrase.length - left.phrase.length);

  for (const { aggregation, phrase } of candidates) {
    const at = text.indexOf(phrase);
    if (at === -1) continue;
    // Whole words only: "counterparty" does not contain the word "count".
    const before = at === 0 ? ' ' : text[at - 1];
    const afterAt = at + phrase.length;
    const after = afterAt >= text.length ? ' ' : text[afterAt];
    if (before !== ' ' || after !== ' ') continue;

    const rest = `${text.slice(0, at)} ${text.slice(afterAt)}`;
    return { aggregation, subject: meaningfulWords(rest) };
  }
  return null;
};

const describeColumn = (column: SemanticColumn): string => `${column.table}[${column.name}]`;

/**
 * Say which blanks were left out.
 *
 * The bug that prompted this rewrite was an average that silently counted
 * blanks as zeros. Stating the exclusion means the same disagreement, if it
 * ever happens again, is visible in the answer rather than buried.
 */
const blankNote = (column: SemanticColumn, dax: string): string => {
  if (column.nullCount === 0) return '';
  if (dax.startsWith('AVERAGE') || dax.startsWith('MIN') || dax.startsWith('MAX')) {
    return ` ${column.nullCount} blank ${column.nullCount === 1 ? 'row is' : 'rows are'} left out, as DAX leaves them out.`;
  }
  return '';
};

export const answerQuestion = (
  question: string,
  model: SemanticModel | null
): NlqAnswer => {
  if (!model || model.tables.length === 0) {
    return {
      ok: false,
      question,
      reason: 'There is no data loaded yet, so there is nothing to ask about.',
      suggestions: [],
    };
  }

  const parsed = parse(question);
  if (!parsed) {
    return refuse(
      model,
      question,
      'I could not tell what to work out from that. Questions start with what to ' +
        'compute - a total, an average, a smallest or largest, or how many.'
    );
  }

  const { aggregation, subject } = parsed;

  // ---- counting rows -------------------------------------------------
  const countingRows =
    aggregation.dax === 'DISTINCTCOUNT' && subject.some(word => ROW_WORDS.has(word));

  if (countingRows) {
    const named = resolveTable(model, subject);
    const table = named.kind === 'found' ? named.value : defaultTable(model);
    if (!table) {
      return refuse(
        model,
        question,
        'There is more than one table, so I cannot tell which one you want the rows of. ' +
          'Name it in the question.'
      );
    }
    const dax = `COUNTROWS(${tableRef(table.name)})`;
    return finish(model, question, dax, `The number of rows in ${table.name}.`);
  }

  if (subject.length === 0) {
    return refuse(
      model,
      question,
      `I could not tell what to take ${aggregation.describes.replace(/^the /, '')}. ` +
        'Name a column in the question.'
    );
  }

  // ---- how many <entity> ---------------------------------------------
  // A table name with a key is an entity count, not a row count.
  if (aggregation.dax === 'DISTINCTCOUNT') {
    const named = resolveTable(model, subject);
    if (named.kind === 'found') {
      const key = soleKeyOf(named.value);
      if (key) {
        const dax = `DISTINCTCOUNT(${columnRef(key.table, key.name)})`;
        return finish(
          model,
          question,
          dax,
          `The number of different ${describeColumn(key)} values. Rows can repeat a ` +
            `${key.name}, so this counts each one once.`,
          key
        );
      }
      // No column identifies one of these on its own, so the question has
      // two honest readings with different answers - the fixture has O1 on
      // two rows, where counting rows says 6 and counting orders says 5.
      // Choosing one silently is how a report ends up off by one forever.
      const identifiers = named.value.columns
        .filter(column => column.role === 'key' || column.role === 'foreignKey')
        .map(column => column.name);
      const byColumn = identifiers.length
        ? ` or the number of different values in one column (${identifiers.join(', ')})`
        : '';
      return refuse(
        model,
        question,
        `No column identifies one row of ${named.value.name} on its own, so that could ` +
          `mean the number of rows${byColumn}. Ask "how many rows in ${named.value.name}", ` +
          `or name the column, for example "how many different ${named.value.columns[0].name}".`
      );
    }
  }

  // ---- an aggregation over one column --------------------------------
  const resolved = resolveColumn(model, subject);

  if (resolved.kind === 'none') {
    return refuse(
      model,
      question,
      `Nothing in this data is called "${subject.join(' ')}".`
    );
  }

  if (resolved.kind === 'ambiguous') {
    const names = resolved.candidates.map(describeColumn).join(' and ');
    return refuse(
      model,
      question,
      `"${subject.join(' ')}" could mean ${names}. Say which table you mean.`
    );
  }

  const column = resolved.value;

  if (aggregation.needsNumeric && column.dataType !== 'number') {
    return refuse(
      model,
      question,
      `${describeColumn(column)} does not hold numbers, so ${aggregation.describes} it ` +
        `is not something I can work out. ${column.roleReason}`
    );
  }

  // A key is a label that happens to be numeric. Summing invoice numbers
  // produces a figure with no meaning, which is worse than a refusal.
  if (
    aggregation.needsNumeric &&
    (column.role === 'key' || column.role === 'foreignKey')
  ) {
    return refuse(
      model,
      question,
      `${describeColumn(column)} identifies rows rather than measuring anything, so ` +
        `${aggregation.describes} it would not mean much. ${column.roleReason}`
    );
  }

  const dax = `${aggregation.dax}(${columnRef(column.table, column.name)})`;
  const interpretation =
    `${aggregation.describes.charAt(0).toUpperCase()}${aggregation.describes.slice(1)} ` +
    `${describeColumn(column)}.${blankNote(column, dax)}`;

  return finish(model, question, dax, interpretation, column);
};

/** Run the compiled DAX and shape the result. */
const finish = (
  model: SemanticModel,
  question: string,
  dax: string,
  interpretation: string,
  column?: SemanticColumn
): NlqAnswer => {
  const outcome = runDax(dax, model);
  if (!outcome.ok) {
    return {
      ok: false,
      question,
      // The engine's own words. Rephrasing them here would create a second
      // description of the same failure, free to drift from the first.
      reason: outcome.message,
      suggestions: suggestQuestions(model),
    };
  }
  return {
    ok: true,
    question,
    dax,
    value: outcome.value,
    formatted: formatDaxValue(outcome.value),
    interpretation,
    column,
  };
};
