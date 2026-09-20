import type { Expression, BinaryOperator } from './ast';
import { lookupFunction } from './registry';

/**
 * Render an AST back to DAX text.
 *
 * Two jobs. It gives the UI a normalised form to show, and it is what Phase 3
 * needs to emit portable measure text for export to Power BI.
 *
 * It also buys a strong correctness check on the parser: parse -> print ->
 * parse must produce an identical tree. A precedence bug in either direction
 * breaks that round trip, which is much harder to fool than a hand-written
 * expectation.
 */

/** Must mirror BINDING_POWER in the parser, or printing will mis-parenthesise. */
const PRECEDENCE: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  '=': 3,
  '<>': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  '&': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '^': 7,
};

const RIGHT_ASSOCIATIVE = new Set<BinaryOperator>(['^']);
const UNARY_PRECEDENCE = 6.5;
const IN_PRECEDENCE = 3;
const NOT_PRECEDENCE = 2.5;

/**
 * A table name needs quoting unless it is a plain identifier that cannot be
 * mistaken for something else.
 *
 * The "something else" is a function name. A calendar called `Date` is the
 * commonest table in any model, and DATE is also a DAX function, so bare
 * `Date[Date]` reads ambiguously - some tools take it, others refuse, and a
 * refusal in exported text surfaces as a broken paste rather than an error
 * anyone can trace. Quoting costs nothing and removes the question.
 */
const formatTableName = (name: string): string => {
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !lookupFunction(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
};

const formatBracketName = (name: string): string => `[${name.replace(/]/g, ']]')}]`;

const formatString = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const formatNumber = (value: number): string => {
  if (Number.isFinite(value)) return String(value);
  // The parser cannot produce these, but a synthesised tree might.
  throw new Error(`Cannot print a non-finite number: ${value}`);
};

/** Precedence of a node when it appears as an operand. Atoms bind tightest. */
const precedenceOf = (node: Expression): number => {
  switch (node.kind) {
    case 'binary':
      return PRECEDENCE[node.operator];
    case 'unary':
      return node.operator === 'NOT' ? NOT_PRECEDENCE : UNARY_PRECEDENCE;
    case 'in':
      return IN_PRECEDENCE;
    case 'let':
      // VAR/RETURN always needs wrapping when nested in an operator expression.
      return 0;
    default:
      return Infinity;
  }
};

const wrap = (text: string, needsParens: boolean) => (needsParens ? `(${text})` : text);

export const printDax = (node: Expression): string => {
  switch (node.kind) {
    case 'number':
      return formatNumber(node.value);

    case 'string':
      return formatString(node.value);

    case 'boolean':
      return node.value ? 'TRUE' : 'FALSE';

    case 'column':
      return node.table
        ? `${formatTableName(node.table)}${formatBracketName(node.column)}`
        : formatBracketName(node.column);

    case 'measure':
      return formatBracketName(node.name);

    case 'table':
      return formatTableName(node.name);

    case 'variable':
      return node.name;

    case 'call':
      return `${node.name}(${node.args.map(printDax).join(', ')})`;

    case 'tableConstructor':
      return `{${node.rows.map(printDax).join(', ')}}`;

    case 'unary': {
      const operandPrecedence = precedenceOf(node.operand);
      if (node.operator === 'NOT') {
        return `NOT ${wrap(printDax(node.operand), operandPrecedence < NOT_PRECEDENCE)}`;
      }
      // `- -5` needs the space, or `--` would re-lex as a line comment.
      const inner = printDax(node.operand);
      const needsParens = operandPrecedence < UNARY_PRECEDENCE;
      const text = wrap(inner, needsParens);
      const separator = !needsParens && text.startsWith('-') ? ' ' : '';
      return `${node.operator}${separator}${text}`;
    }

    case 'binary': {
      const precedence = PRECEDENCE[node.operator];
      const rightAssociative = RIGHT_ASSOCIATIVE.has(node.operator);

      // A child of equal precedence needs parentheses on the side associativity
      // does not favour, or `10 - (4 - 3)` would print as `10 - 4 - 3`.
      const leftText = wrap(
        printDax(node.left),
        precedenceOf(node.left) < precedence ||
          (precedenceOf(node.left) === precedence && rightAssociative)
      );
      const rightText = wrap(
        printDax(node.right),
        precedenceOf(node.right) < precedence ||
          (precedenceOf(node.right) === precedence && !rightAssociative)
      );

      return `${leftText} ${node.operator} ${rightText}`;
    }

    case 'in': {
      const valueText = wrap(printDax(node.value), precedenceOf(node.value) < IN_PRECEDENCE);
      const list = node.candidates.map(printDax).join(', ');
      return `${valueText} ${node.negated ? 'NOT IN' : 'IN'} {${list}}`;
    }

    case 'let': {
      const declarations = node.declarations
        .map(d => `VAR ${d.name} = ${printDax(d.value)}`)
        .join('\n');
      return `${declarations}\nRETURN ${printDax(node.body)}`;
    }
  }
};

/**
 * Build a column reference that is guaranteed to parse back.
 *
 * Anything assembling DAX text has to quote table names and escape brackets
 * exactly as the printer does, so the rules live in one place. A column
 * called `Margin [%]` or a table called `Q1'24` breaks naive concatenation,
 * and the UI generates references from user data where both are possible.
 */
export const columnRef = (table: string, column: string): string =>
  `${formatTableName(table)}${formatBracketName(column)}`;

/** Build a table reference that is guaranteed to parse back. */
export const tableRef = (table: string): string => formatTableName(table);
