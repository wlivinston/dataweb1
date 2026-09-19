import type { Expression } from './ast';
import { visit } from './ast';
import {
  formatSignature,
  lookupFunction,
  maxArity,
  minArity,
  suggestFunctionNames,
  type DaxFunctionSignature,
  type DaxType,
} from './registry';
import { findColumn, findMeasure, findTable } from '../semantic/model';
import type { SemanticModel } from '../semantic/types';

/**
 * Check a parsed expression against the registry and the model.
 *
 * This is the pass the parser deliberately does not do. Grammar is one
 * question - "is this well-formed DAX?" - and name resolution is another,
 * answerable only against a model. Keeping them apart is what lets the
 * product parse and re-export measures it cannot execute.
 *
 * Every issue carries a source position, so the UI can underline the exact
 * token rather than colouring the whole formula red.
 */

export type DaxIssueCode =
  /** The expression could not be parsed at all. */
  | 'syntax'
  | 'unknown_function'
  | 'arity'
  | 'argument_type'
  | 'unknown_table'
  | 'unknown_column'
  | 'ambiguous_column'
  | 'unknown_measure'
  | 'not_implemented';

export interface DaxIssue {
  code: DaxIssueCode;
  severity: 'error' | 'warning';
  message: string;
  start: number;
  length: number;
}

export interface ValidateOptions {
  /**
   * Report functions the evaluator cannot yet execute. Off by default: the
   * catalogue deliberately recognises more than it runs, so that measures
   * can be stored and exported before they can be evaluated.
   */
  requireImplemented?: boolean;
}

/**
 * What an expression yields, as far as can be told without evaluating it.
 *
 * Only accurate enough to catch the argument mistakes worth catching. A
 * variable holding a table is reported as 'any' rather than guessed at.
 */
const typeOf = (node: Expression): DaxType => {
  switch (node.kind) {
    case 'table':
    case 'tableConstructor':
      return 'table';
    case 'column':
      return 'columnRef';
    case 'call': {
      const signature = lookupFunction(node.name);
      return signature ? signature.returns : 'any';
    }
    case 'variable':
    case 'let':
      return 'any';
    default:
      return 'scalar';
  }
};

const ITERATOR_FOR: Record<string, string> = {
  SUM: 'SUMX',
  AVERAGE: 'AVERAGEX',
  MIN: 'MINX',
  MAX: 'MAXX',
  COUNT: 'COUNTX',
};

const describeArityProblem = (
  signature: DaxFunctionSignature,
  count: number
): string | null => {
  const min = minArity(signature);
  const max = maxArity(signature);

  if (count < min) {
    return `${signature.name} needs at least ${min} argument${min === 1 ? '' : 's'} but was given ${count}. Expected ${formatSignature(signature)}.`;
  }
  if (count > max) {
    return `${signature.name} takes at most ${max} argument${max === 1 ? '' : 's'} but was given ${count}. Expected ${formatSignature(signature)}.`;
  }
  return null;
};

/**
 * Whether this argument sits in a slot that takes a bare word.
 *
 * DAX has no keyword token, so YEAR in DATEADD(Date[Date], -1, YEAR) parses
 * as a table reference. Without this the validator reported two errors for
 * a perfectly ordinary expression: the wrong argument type, and a missing
 * table called YEAR.
 */
const keywordsFor = (
  signature: DaxFunctionSignature,
  index: number
): string[] | null => signature.parameters[index]?.keywords ?? null;

/** Keywords may also be written as text, as in DATEADD(d, -1, "YEAR"). */
const keywordTextOf = (argument: Expression): string | null => {
  if (argument.kind === 'table') return argument.name;
  if (argument.kind === 'string') return argument.value;
  return null;
};

const checkArgumentType = (
  signature: DaxFunctionSignature,
  index: number,
  argument: Expression,
  issues: DaxIssue[]
): void => {
  const parameter = signature.parameters[index];
  // Beyond the declared list the function is variadic, so there is no
  // per-position expectation to check against.
  if (!parameter) return;

  const keywords = keywordsFor(signature, index);
  if (keywords) {
    const written = keywordTextOf(argument);
    // Anything else - a number, a column, a nested call - is checked by the
    // ordinary rules below, because DAX does accept 0 and 1 for an order.
    if (written !== null) {
      if (!keywords.some(word => word.toLowerCase() === written.toLowerCase())) {
        issues.push({
          code: 'argument_type',
          severity: 'error',
          message: `${signature.name} does not understand "${written}" for "${parameter.name}". Expected one of ${keywords.join(', ')}.`,
          start: argument.start,
          length: argument.length,
        });
      }
      return;
    }
  }

  if (parameter.type === 'any') return;

  const actual = typeOf(argument);
  if (actual === 'any') return;

  if (parameter.type === 'columnRef' && actual !== 'columnRef') {
    const iterator = ITERATOR_FOR[signature.name];
    const hint = iterator
      ? ` To aggregate an expression rather than a column, use ${iterator}.`
      : '';
    issues.push({
      code: 'argument_type',
      severity: 'error',
      message: `${signature.name} expects a column reference like Table[Column] for "${parameter.name}".${hint}`,
      start: argument.start,
      length: argument.length,
    });
    return;
  }

  if (parameter.type === 'table' && actual !== 'table') {
    issues.push({
      code: 'argument_type',
      severity: 'error',
      message: `${signature.name} expects a table for "${parameter.name}", not a single value.`,
      start: argument.start,
      length: argument.length,
    });
    return;
  }

  if (parameter.type === 'scalar' && actual === 'table') {
    issues.push({
      code: 'argument_type',
      severity: 'error',
      message: `${signature.name} expects a single value for "${parameter.name}", not a table.`,
      start: argument.start,
      length: argument.length,
    });
  }
};

export const validateDax = (
  expression: Expression,
  model: SemanticModel,
  options: ValidateOptions = {}
): DaxIssue[] => {
  const issues: DaxIssue[] = [];

  // Collect keyword arguments first, in a pass of their own. The main walk
  // reaches a bare YEAR through the generic `table` branch, which would
  // report it as a missing table; a separate pass means that cannot depend
  // on whether the walk happens to reach parents before children.
  const keywordNodes = new Set<Expression>();
  visit(expression, node => {
    if (node.kind !== 'call') return;
    const signature = lookupFunction(node.name);
    if (!signature) return;
    node.args.forEach((argument, index) => {
      if (argument.kind === 'table' && signature.parameters[index]?.keywords) {
        keywordNodes.add(argument);
      }
    });
  });

  visit(expression, node => {
    switch (node.kind) {
      case 'call': {
        const signature = lookupFunction(node.name);

        if (!signature) {
          const suggestions = suggestFunctionNames(node.name);
          const hint = suggestions.length
            ? ` Did you mean ${suggestions.join(', ')}?`
            : '';
          issues.push({
            code: 'unknown_function',
            severity: 'error',
            message: `There is no DAX function called ${node.name}.${hint}`,
            start: node.nameStart,
            length: node.nameLength,
          });
          return;
        }

        const arity = describeArityProblem(signature, node.args.length);
        if (arity) {
          issues.push({
            code: 'arity',
            severity: 'error',
            message: arity,
            start: node.nameStart,
            length: node.nameLength,
          });
        }

        node.args.forEach((argument, index) =>
          checkArgumentType(signature, index, argument, issues)
        );

        if (options.requireImplemented && !signature.implemented) {
          issues.push({
            code: 'not_implemented',
            severity: 'warning',
            message: `${signature.name} is recognised but cannot be calculated yet. The measure can be saved and exported, but will not return a value here.`,
            start: node.nameStart,
            length: node.nameLength,
          });
        }
        return;
      }

      case 'column': {
        const resolved = findColumn(model, node.table ?? undefined, node.column);
        if (!resolved.ok) {
          issues.push({
            code: resolved.error.includes('ambiguous')
              ? 'ambiguous_column'
              : node.table && !findTable(model, node.table)
                ? 'unknown_table'
                : 'unknown_column',
            severity: 'error',
            message: resolved.error,
            start: node.start,
            length: node.length,
          });
        }
        return;
      }

      case 'measure': {
        if (!findMeasure(model, node.name)) {
          // Square brackets on their own mean a measure in DAX. Writing
          // [Amount] when Sales[Amount] was meant is the commonest way to
          // land here, so say that outright rather than listing measures.
          const owners = model.tables
            .filter(t => t.columns.some(c => c.name.toLowerCase() === node.name.toLowerCase()))
            .map(t => `${t.name}[${node.name}]`);

          const hint = owners.length
            ? ` Bare brackets mean a measure; for the column write ${owners.join(' or ')}.`
            : model.measures.length
              ? ` Defined measures: ${model.measures.map(m => m.name).join(', ')}.`
              : ' No measures are defined on this model yet.';

          issues.push({
            code: 'unknown_measure',
            severity: 'error',
            message: `There is no measure called [${node.name}].${hint}`,
            start: node.start,
            length: node.length,
          });
        }
        return;
      }

      case 'table': {
        // A bare word in a keyword slot is not a table reference at all.
        if (keywordNodes.has(node)) return;
        if (!findTable(model, node.name)) {
          const names = model.tables.map(t => t.name).join(', ');
          issues.push({
            code: 'unknown_table',
            severity: 'error',
            message: `There is no table called "${node.name}". Available: ${names}.`,
            start: node.start,
            length: node.length,
          });
        }
        return;
      }

      default:
        return;
    }
  });

  return issues;
};

/** True when nothing found would stop the expression being evaluated. */
export const isValid = (issues: DaxIssue[]): boolean =>
  !issues.some(issue => issue.severity === 'error');
