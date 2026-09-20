/**
 * DAX abstract syntax tree.
 *
 * Every node carries `start`/`length` so a runtime failure deep inside an
 * expression can still point at the sub-expression that caused it.
 */

export interface NodeBase {
  start: number;
  length: number;
}

export interface NumberLiteral extends NodeBase {
  kind: 'number';
  value: number;
}

export interface StringLiteral extends NodeBase {
  kind: 'string';
  value: string;
}

export interface BooleanLiteral extends NodeBase {
  kind: 'boolean';
  value: boolean;
}

/**
 * `Sales[Amount]` - a column, qualified by its table.
 * `[Amount]` with no table is ambiguous at parse time; the binder resolves it
 * against the semantic model, which is also where it decides whether the name
 * refers to a column or a measure.
 */
export interface ColumnRef extends NodeBase {
  kind: 'column';
  table: string | null;
  column: string;
}

/** `[Total Revenue]` used where a measure is expected. */
export interface MeasureRef extends NodeBase {
  kind: 'measure';
  name: string;
}

/** A bare table name, e.g. the first argument to COUNTROWS or FILTER. */
export interface TableRef extends NodeBase {
  kind: 'table';
  name: string;
}

export interface FunctionCall extends NodeBase {
  kind: 'call';
  /** Upper-cased function name. */
  name: string;
  args: Expression[];
  /** Position of the name alone, for error underlining. */
  nameStart: number;
  nameLength: number;
}

export type UnaryOperator = '-' | '+' | 'NOT';

export interface UnaryExpression extends NodeBase {
  kind: 'unary';
  operator: UnaryOperator;
  operand: Expression;
}

export type BinaryOperator =
  | '+' | '-' | '*' | '/' | '^'
  | '&'
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | '&&' | '||';

export interface BinaryExpression extends NodeBase {
  kind: 'binary';
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

/** `Sales[Region] IN { "Accra", "Kumasi" }` - modelled as a call to IN. */
export interface InExpression extends NodeBase {
  kind: 'in';
  value: Expression;
  candidates: Expression[];
  negated: boolean;
}

/**
 * `{ 1, 2, 3 }` - a literal table. DAX writes IN lists this way, so an
 * expression copied out of Power BI depends on this parsing.
 */
export interface TableConstructor extends NodeBase {
  kind: 'tableConstructor';
  rows: Expression[];
}

export interface VariableRef extends NodeBase {
  kind: 'variable';
  name: string;
}

export interface VariableDeclaration {
  name: string;
  value: Expression;
  start: number;
  length: number;
}

/** `VAR x = ... VAR y = ... RETURN expr` */
export interface LetExpression extends NodeBase {
  kind: 'let';
  declarations: VariableDeclaration[];
  body: Expression;
}

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | ColumnRef
  | MeasureRef
  | TableRef
  | FunctionCall
  | UnaryExpression
  | BinaryExpression
  | InExpression
  | TableConstructor
  | VariableRef
  | LetExpression;

/** Walk every node in an expression tree, parents before children. */
export const visit = (node: Expression, fn: (n: Expression) => void): void => {
  fn(node);
  switch (node.kind) {
    case 'call':
      node.args.forEach(a => visit(a, fn));
      break;
    case 'unary':
      visit(node.operand, fn);
      break;
    case 'binary':
      visit(node.left, fn);
      visit(node.right, fn);
      break;
    case 'in':
      visit(node.value, fn);
      node.candidates.forEach(c => visit(c, fn));
      break;
    case 'tableConstructor':
      node.rows.forEach(r => visit(r, fn));
      break;
    case 'let':
      node.declarations.forEach(d => visit(d.value, fn));
      visit(node.body, fn);
      break;
    default:
      break;
  }
};

/** Every function name referenced anywhere in the tree, upper-cased. */
export const collectFunctionNames = (node: Expression): string[] => {
  const names: string[] = [];
  visit(node, n => {
    if (n.kind === 'call') names.push(n.name);
  });
  return names;
};

/** Every column reference in the tree, for dependency analysis. */
export const collectColumnRefs = (node: Expression): ColumnRef[] => {
  const refs: ColumnRef[] = [];
  visit(node, n => {
    if (n.kind === 'column') refs.push(n);
  });
  return refs;
};
