import type { Expression, FunctionCall } from './ast';
import { parseDax } from './parser';
import { DaxRuntimeError, locate } from './errors';
import { lookupFunction, maxArity, minArity, formatSignature } from './registry';
import {
  cellValue,
  createVisibilityCache,
  distinctKeysOf,
  emptyFilterContext,
  visibleRows,
  withColumnFilter,
  withRowFilter,
  withRowPinned,
  withoutColumn,
  withoutTable,
  type EvalContext,
  type FilterContext,
  type VisibilityCache,
} from './context';
import {
  BLANK,
  compareScalars,
  expectScalar,
  isBlank,
  isTable,
  makeTable,
  toBoolean,
  toNumber,
  toText,
  valuesEqual,
  type DaxScalar,
  type DaxTable,
  type DaxValue,
} from './value';
import { findColumn, findTable, findMeasure, keyOf } from '../semantic/model';
import type { SemanticModel } from '../semantic/types';

/**
 * Evaluate DAX against a semantic model.
 *
 * The rule this engine is built around: anything it cannot do correctly, it
 * refuses to do at all. The implementation it replaces matched substrings, so
 * an expression it did not understand produced a plausible number rather than
 * an error - `formula.includes('COUNTROWS')` returned the whole row count
 * regardless of any filter. Every unsupported path here throws.
 */

export interface EvaluateOptions {
  /** Fixes TODAY() and NOW(), so a measure is reproducible in tests. */
  today?: Date;
  /** Filter context to evaluate under; defaults to no filters. */
  filter?: FilterContext;
}

const MAX_MEASURE_DEPTH = 32;

interface Scope {
  variables: Map<string, DaxValue>;
  parent: Scope | null;
}

const lookupVariable = (scope: Scope | null, name: string): DaxValue | undefined => {
  const wanted = name.toLowerCase();
  for (let current = scope; current; current = current.parent) {
    const found = current.variables.get(wanted);
    if (found !== undefined) return found;
  }
  return undefined;
};

class Evaluator {
  private readonly cache: VisibilityCache = createVisibilityCache();
  private readonly measureStack: string[] = [];

  constructor(
    private readonly model: SemanticModel,
    private readonly source: string,
    private readonly options: EvaluateOptions
  ) {}

  private fail(node: Expression, message: string): never {
    throw new DaxRuntimeError(message, this.source, node.start, node.length);
  }

  /** Run a step, tagging any position-less error with this node's span. */
  private at<T>(node: Expression, run: () => T): T {
    try {
      return run();
    } catch (error) {
      throw locate(error, this.source, node.start, node.length);
    }
  }

  private rows(table: string, context: EvalContext): number[] {
    return visibleRows(this.model, table, context.filter, this.cache);
  }

  evaluate(node: Expression, context: EvalContext, scope: Scope | null): DaxValue {
    return this.at(node, () => this.evaluateNode(node, context, scope));
  }

  private evaluateNode(node: Expression, context: EvalContext, scope: Scope | null): DaxValue {
    switch (node.kind) {
      case 'number':
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;

      case 'variable': {
        const found = lookupVariable(scope, node.name);
        if (found === undefined) {
          this.fail(node, `The variable ${node.name} is not defined here.`);
        }
        return found;
      }

      case 'let': {
        const inner: Scope = { variables: new Map(), parent: scope };
        for (const declaration of node.declarations) {
          // Each initialiser sees the variables declared before it, matching
          // DAX's sequential VAR scope.
          inner.variables.set(
            declaration.name.toLowerCase(),
            this.evaluate(declaration.value, context, inner)
          );
        }
        return this.evaluate(node.body, context, inner);
      }

      case 'column':
        return this.readColumn(node.table, node.column, node, context);

      case 'measure':
        return this.evaluateMeasure(node.name, node, context);

      case 'table': {
        const table = findTable(this.model, node.name);
        if (!table) {
          const names = this.model.tables.map(t => t.name).join(', ');
          this.fail(node, `There is no table called "${node.name}". Available: ${names}.`);
        }
        return makeTable(table.name, this.rows(table.name, context));
      }

      case 'unary': {
        if (node.operator === 'NOT') {
          return !toBoolean(this.evaluate(node.operand, context, scope), 'NOT');
        }
        const value = toNumber(this.evaluate(node.operand, context, scope), 'The - operator');
        return node.operator === '-' ? -value : value;
      }

      case 'binary':
        return this.evaluateBinary(node, context, scope);

      case 'in': {
        const value = expectScalar(this.evaluate(node.value, context, scope), 'IN');
        const candidates = node.candidates.map(candidate =>
          expectScalar(this.evaluate(candidate, context, scope), 'IN')
        );
        const found = candidates.some(candidate => valuesEqual(value, candidate));
        return node.negated ? !found : found;
      }

      case 'tableConstructor':
        this.fail(
          node,
          'A table constructor { } can only be used on the right of IN at the moment.'
        );
        break;

      case 'call':
        return this.evaluateCall(node, context, scope);
    }

    this.fail(node, 'This expression cannot be evaluated.');
  }

  private evaluateBinary(
    node: Extract<Expression, { kind: 'binary' }>,
    context: EvalContext,
    scope: Scope | null
  ): DaxValue {
    const operator = node.operator;

    if (operator === '&&') {
      return (
        toBoolean(this.evaluate(node.left, context, scope), '&&') &&
        toBoolean(this.evaluate(node.right, context, scope), '&&')
      );
    }
    if (operator === '||') {
      return (
        toBoolean(this.evaluate(node.left, context, scope), '||') ||
        toBoolean(this.evaluate(node.right, context, scope), '||')
      );
    }

    const left = this.evaluate(node.left, context, scope);
    const right = this.evaluate(node.right, context, scope);

    if (operator === '&') {
      return toText(left, 'The & operator') + toText(right, 'The & operator');
    }

    if (operator === '=' || operator === '<>') {
      const equal = valuesEqual(
        expectScalar(left, 'A comparison'),
        expectScalar(right, 'A comparison')
      );
      return operator === '=' ? equal : !equal;
    }

    if (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') {
      const order = compareScalars(
        expectScalar(left, 'A comparison'),
        expectScalar(right, 'A comparison')
      );
      switch (operator) {
        case '<':
          return order < 0;
        case '>':
          return order > 0;
        case '<=':
          return order <= 0;
        default:
          return order >= 0;
      }
    }

    const a = toNumber(left, `The ${operator} operator`);
    const b = toNumber(right, `The ${operator} operator`);
    switch (operator) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        // DAX returns Infinity rather than erroring; DIVIDE is the guarded form.
        return a / b;
      case '^':
        return a ** b;
      default:
        return this.fail(node, `The operator ${operator} is not supported.`);
    }
  }

  private readColumn(
    tableName: string | null,
    columnName: string,
    node: Expression,
    context: EvalContext
  ): DaxScalar {
    const resolved = findColumn(this.model, tableName ?? undefined, columnName);
    if (!resolved.ok) this.fail(node, resolved.error);
    const owner = resolved.value.table;

    // A bare column reference only means something for a particular row.
    for (let i = context.rowContexts.length - 1; i >= 0; i -= 1) {
      const rowContext = context.rowContexts[i];
      if (rowContext.table.toLowerCase() === owner.toLowerCase()) {
        return cellValue(this.model, owner, resolved.value.name, rowContext.rowIndex);
      }
    }

    // Available through a relationship from the row being iterated.
    for (let i = context.rowContexts.length - 1; i >= 0; i -= 1) {
      const related = this.followRelationship(context.rowContexts[i], owner, resolved.value.name);
      if (related !== undefined) return related;
    }

    this.fail(
      node,
      `${owner}[${resolved.value.name}] needs a row to read from. Wrap it in an aggregation such as SUM, or use an iterator like SUMX.`
    );
  }

  /** Read a one-side column from a row on the many side, as RELATED does. */
  private followRelationship(
    rowContext: { table: string; rowIndex: number },
    targetTable: string,
    targetColumn: string
  ): DaxScalar | undefined {
    const relationship = this.model.relationships.find(
      candidate =>
        candidate.isActive &&
        candidate.from.table.toLowerCase() === rowContext.table.toLowerCase() &&
        candidate.to.table.toLowerCase() === targetTable.toLowerCase()
    );
    if (!relationship) return undefined;

    const near = findTable(this.model, relationship.from.table);
    const far = findTable(this.model, relationship.to.table);
    if (!near || !far) return undefined;

    const wanted = keyOf(near.rows[rowContext.rowIndex][relationship.from.column]);
    if (wanted === null) return null;

    const match = far.rows.findIndex(row => keyOf(row[relationship.to.column]) === wanted);
    if (match === -1) return null;

    return cellValue(this.model, far.name, targetColumn, match);
  }

  private evaluateMeasure(name: string, node: Expression, context: EvalContext): DaxValue {
    const measure = findMeasure(this.model, name);
    if (!measure) {
      this.fail(node, `There is no measure called [${name}].`);
    }

    const key = name.toLowerCase();
    if (this.measureStack.includes(key)) {
      this.fail(
        node,
        `[${name}] refers to itself, directly or through ${this.measureStack.join(' -> ')}.`
      );
    }
    if (this.measureStack.length >= MAX_MEASURE_DEPTH) {
      this.fail(node, `Measures are nested more than ${MAX_MEASURE_DEPTH} deep.`);
    }

    this.measureStack.push(key);
    try {
      const parsed = parseDax(measure.expression);
      // Referencing a measure applies context transition, exactly as wrapping
      // it in CALCULATE would.
      const transitioned = this.applyContextTransition(context);
      return this.evaluate(parsed, transitioned, null);
    } finally {
      this.measureStack.pop();
    }
  }

  /**
   * Turn the rows being iterated into filters, and drop the row contexts.
   *
   * Without this, SUMX(Sales, CALCULATE(SUM(Sales[Amount]))) would return the
   * grand total on every row instead of that row's amount.
   */
  private applyContextTransition(context: EvalContext): EvalContext {
    let filter = context.filter;
    const pinned = new Set<string>();

    for (let i = context.rowContexts.length - 1; i >= 0; i -= 1) {
      const rowContext = context.rowContexts[i];
      const key = rowContext.table.toLowerCase();
      if (pinned.has(key)) continue; // Innermost row context wins.
      pinned.add(key);
      filter = withRowPinned(filter, rowContext.table, rowContext.rowIndex);
    }

    return { filter, rowContexts: [] };
  }

  // ============================================================
  // Function dispatch
  // ============================================================

  private evaluateCall(node: FunctionCall, context: EvalContext, scope: Scope | null): DaxValue {
    const signature = lookupFunction(node.name);
    if (!signature) {
      this.fail(node, `There is no DAX function called ${node.name}.`);
    }

    const count = node.args.length;
    if (count < minArity(signature) || count > maxArity(signature)) {
      this.fail(
        node,
        `${signature.name} was given ${count} argument${count === 1 ? '' : 's'}. Expected ${formatSignature(signature)}.`
      );
    }

    const handler = HANDLERS[signature.name];
    if (!handler) {
      this.fail(
        node,
        `${signature.name} is recognised but not implemented yet, so this measure cannot be calculated. It can still be saved and exported.`
      );
    }

    return handler(this, node, context, scope);
  }

  // -- helpers used by the handlers ---------------------------------------

  scalarArg(node: FunctionCall, index: number, context: EvalContext, scope: Scope | null): DaxScalar {
    return expectScalar(this.evaluate(node.args[index], context, scope), node.name);
  }

  numberArg(node: FunctionCall, index: number, context: EvalContext, scope: Scope | null): number {
    return toNumber(this.evaluate(node.args[index], context, scope), node.name);
  }

  textArg(node: FunctionCall, index: number, context: EvalContext, scope: Scope | null): string {
    return toText(this.evaluate(node.args[index], context, scope), node.name);
  }

  /** Resolve an argument that must be a bare column reference. */
  columnArg(node: FunctionCall, index: number): { table: string; column: string } {
    const argument = node.args[index];
    if (argument.kind !== 'column') {
      this.fail(
        argument,
        `${node.name} needs a column reference like Table[Column] here.`
      );
    }
    const resolved = findColumn(this.model, argument.table ?? undefined, argument.column);
    if (!resolved.ok) this.fail(argument, resolved.error);
    return { table: resolved.value.table, column: resolved.value.name };
  }

  tableArg(node: FunctionCall, index: number, context: EvalContext, scope: Scope | null): DaxTable {
    const value = this.evaluate(node.args[index], context, scope);
    if (!isTable(value)) {
      this.fail(node.args[index], `${node.name} needs a table here, not a single value.`);
    }
    return value;
  }

  /** Every visible value of a column, as scalars. */
  columnValues(
    reference: { table: string; column: string },
    context: EvalContext
  ): DaxScalar[] {
    const rows = this.rows(reference.table, context);
    return rows.map(index => cellValue(this.model, reference.table, reference.column, index));
  }

  iterate(
    table: DaxTable,
    context: EvalContext,
    scope: Scope | null,
    body: Expression
  ): DaxValue[] {
    const results: DaxValue[] = [];
    for (const rowIndex of table.rows) {
      const inner: EvalContext = {
        filter: context.filter,
        rowContexts: [...context.rowContexts, { table: table.table, rowIndex }],
      };
      results.push(this.evaluate(body, inner, scope));
    }
    return results;
  }

  get semanticModel(): SemanticModel {
    return this.model;
  }

  get evaluateOptions(): EvaluateOptions {
    return this.options;
  }

  visibleRowsOf(table: string, context: EvalContext): number[] {
    return this.rows(table, context);
  }

  failAt(node: Expression, message: string): never {
    this.fail(node, message);
  }

  /**
   * Build a positioned error for the caller to throw.
   *
   * Handlers use `throw evaluator.error(...)` rather than a never-returning
   * call, because only an explicit throw narrows the types that follow.
   */
  error(node: Expression, message: string): DaxRuntimeError {
    return new DaxRuntimeError(message, this.source, node.start, node.length);
  }

  transition(context: EvalContext): EvalContext {
    return this.applyContextTransition(context);
  }
}

type Handler = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null
) => DaxValue;

const numericValues = (values: DaxScalar[]): number[] => {
  const numbers: number[] = [];
  for (const value of values) {
    if (value === null) continue;
    if (typeof value === 'number') {
      numbers.push(value);
      continue;
    }
    if (typeof value === 'boolean') {
      numbers.push(value ? 1 : 0);
      continue;
    }
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) numbers.push(parsed);
  }
  return numbers;
};

/** An aggregation over a column, ignoring blanks as DAX does. */
const columnAggregate = (
  compute: (values: DaxScalar[]) => DaxValue
): Handler => (evaluator, node, context) => {
  const reference = evaluator.columnArg(node, 0);
  return compute(evaluator.columnValues(reference, context));
};

const HANDLERS: Record<string, Handler> = {
  // -- aggregation --------------------------------------------------------
  SUM: columnAggregate(values => {
    const numbers = numericValues(values);
    // An empty set is BLANK, not zero: "no sales" and "sales of zero" are
    // different answers and DAX keeps them apart.
    return numbers.length === 0 ? BLANK : numbers.reduce((a, b) => a + b, 0);
  }),

  AVERAGE: columnAggregate(values => {
    const numbers = numericValues(values);
    return numbers.length === 0
      ? BLANK
      : numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }),

  MIN: columnAggregate(values => {
    const present = values.filter(value => value !== null);
    if (present.length === 0) return BLANK;
    return present.reduce((best, value) => (compareScalars(value, best) < 0 ? value : best));
  }),

  MAX: columnAggregate(values => {
    const present = values.filter(value => value !== null);
    if (present.length === 0) return BLANK;
    return present.reduce((best, value) => (compareScalars(value, best) > 0 ? value : best));
  }),

  COUNT: columnAggregate(values => {
    // COUNT is numeric-only; COUNTA is the one that counts text.
    const numbers = numericValues(values);
    return numbers.length === 0 ? BLANK : numbers.length;
  }),

  COUNTA: columnAggregate(values => {
    const present = values.filter(value => value !== null).length;
    return present === 0 ? BLANK : present;
  }),

  COUNTBLANK: columnAggregate(values => values.filter(value => value === null).length),

  DISTINCTCOUNT: columnAggregate(values => {
    const keys = new Set<string>();
    let sawBlank = false;
    for (const value of values) {
      if (value === null) {
        sawBlank = true;
        continue;
      }
      keys.add(String(value).trim().toLowerCase());
    }
    // DAX counts BLANK as one of the distinct values.
    return keys.size + (sawBlank ? 1 : 0);
  }),

  COUNTROWS: (evaluator, node, context, scope) => {
    if (node.args.length === 0) {
      throw evaluator.error(node, 'COUNTROWS needs a table, for example COUNTROWS(Sales).');
    }
    const table = evaluator.tableArg(node, 0, context, scope);
    return table.rows.length === 0 ? BLANK : table.rows.length;
  },

  // -- iterators ----------------------------------------------------------
  SUMX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const numbers = numericValues(
      evaluator.iterate(table, context, scope, node.args[1]).map(v => expectScalar(v, 'SUMX'))
    );
    return numbers.length === 0 ? BLANK : numbers.reduce((a, b) => a + b, 0);
  },

  AVERAGEX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const numbers = numericValues(
      evaluator.iterate(table, context, scope, node.args[1]).map(v => expectScalar(v, 'AVERAGEX'))
    );
    return numbers.length === 0 ? BLANK : numbers.reduce((a, b) => a + b, 0) / numbers.length;
  },

  MINX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const present = evaluator
      .iterate(table, context, scope, node.args[1])
      .map(v => expectScalar(v, 'MINX'))
      .filter(v => v !== null);
    if (present.length === 0) return BLANK;
    return present.reduce((best, value) => (compareScalars(value, best) < 0 ? value : best));
  },

  MAXX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const present = evaluator
      .iterate(table, context, scope, node.args[1])
      .map(v => expectScalar(v, 'MAXX'))
      .filter(v => v !== null);
    if (present.length === 0) return BLANK;
    return present.reduce((best, value) => (compareScalars(value, best) > 0 ? value : best));
  },

  COUNTX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const numbers = numericValues(
      evaluator.iterate(table, context, scope, node.args[1]).map(v => expectScalar(v, 'COUNTX'))
    );
    return numbers.length === 0 ? BLANK : numbers.length;
  },

  // -- filter context -----------------------------------------------------
  CALCULATE: (evaluator, node, context, scope) => {
    const transitioned = evaluator.transition(context);
    let filter = transitioned.filter;

    for (let i = 1; i < node.args.length; i += 1) {
      filter = applyCalculateFilter(evaluator, node.args[i], filter, context, scope);
    }

    return evaluator.evaluate(node.args[0], { filter, rowContexts: [] }, scope);
  },

  FILTER: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const kept: number[] = [];
    for (const rowIndex of table.rows) {
      const inner: EvalContext = {
        filter: context.filter,
        rowContexts: [...context.rowContexts, { table: table.table, rowIndex }],
      };
      if (toBoolean(evaluator.evaluate(node.args[1], inner, scope), 'FILTER')) {
        kept.push(rowIndex);
      }
    }
    return makeTable(table.table, kept);
  },

  ALL: (evaluator, node, context, scope) => {
    if (node.args.length === 0) {
      throw evaluator.error(node, 'ALL with no arguments is not supported yet; name a table.');
    }
    const argument = node.args[0];
    if (argument.kind === 'table') {
      const table = findTable(evaluator.semanticModel, argument.name);
      if (!table) throw evaluator.error(argument, `There is no table called "${argument.name}".`);
      return makeTable(table.name, Array.from({ length: table.rowCount }, (_, i) => i));
    }
    if (argument.kind === 'column') {
      // As a value, ALL(Table[Column]) is the unfiltered table. It is more
      // often used as a CALCULATE modifier, which is handled separately.
      const resolved = findColumn(
        evaluator.semanticModel,
        argument.table ?? undefined,
        argument.column
      );
      if (!resolved.ok) throw evaluator.error(argument, resolved.error);
      const table = findTable(evaluator.semanticModel, resolved.value.table)!;
      return makeTable(table.name, Array.from({ length: table.rowCount }, (_, i) => i));
    }
    return evaluator.tableArg(node, 0, context, scope);
  },

  VALUES: (evaluator, node, context, scope) => {
    const argument = node.args[0];
    if (argument.kind === 'table') {
      return makeTable(argument.name, evaluator.visibleRowsOf(argument.name, context));
    }
    throw evaluator.error(
      argument,
      'VALUES over a single column is not supported yet. Use VALUES(Table), or DISTINCTCOUNT for a count.'
    );
  },

  DISTINCT: (evaluator, node, context, scope) => HANDLERS.VALUES(evaluator, node, context, scope),

  RELATED: (evaluator, node, context) => {
    const reference = evaluator.columnArg(node, 0);
    if (context.rowContexts.length === 0) {
      throw evaluator.error(
        node,
        'RELATED needs a row to work from. Use it inside an iterator such as SUMX or FILTER.'
      );
    }
    // readColumn already walks relationships from the active row contexts.
    return evaluator.evaluate(node.args[0], context, null);
  },

  // -- logic --------------------------------------------------------------
  IF: (evaluator, node, context, scope) => {
    const condition = toBoolean(evaluator.evaluate(node.args[0], context, scope), 'IF');
    if (condition) return evaluator.evaluate(node.args[1], context, scope);
    return node.args.length > 2 ? evaluator.evaluate(node.args[2], context, scope) : BLANK;
  },

  SWITCH: (evaluator, node, context, scope) => {
    const subject = expectScalar(evaluator.evaluate(node.args[0], context, scope), 'SWITCH');
    let index = 1;
    for (; index + 1 < node.args.length; index += 2) {
      const candidate = expectScalar(evaluator.evaluate(node.args[index], context, scope), 'SWITCH');
      if (valuesEqual(subject, candidate)) {
        return evaluator.evaluate(node.args[index + 1], context, scope);
      }
    }
    // A final unpaired argument is the else branch.
    return index < node.args.length
      ? evaluator.evaluate(node.args[index], context, scope)
      : BLANK;
  },

  AND: (evaluator, node, context, scope) =>
    toBoolean(evaluator.evaluate(node.args[0], context, scope), 'AND') &&
    toBoolean(evaluator.evaluate(node.args[1], context, scope), 'AND'),

  OR: (evaluator, node, context, scope) =>
    toBoolean(evaluator.evaluate(node.args[0], context, scope), 'OR') ||
    toBoolean(evaluator.evaluate(node.args[1], context, scope), 'OR'),

  NOT: (evaluator, node, context, scope) =>
    !toBoolean(evaluator.evaluate(node.args[0], context, scope), 'NOT'),

  IFERROR: (evaluator, node, context, scope) => {
    try {
      return evaluator.evaluate(node.args[0], context, scope);
    } catch (error) {
      if (!(error instanceof DaxRuntimeError)) throw error;
      return evaluator.evaluate(node.args[1], context, scope);
    }
  },

  ISBLANK: (evaluator, node, context, scope) =>
    isBlank(evaluator.evaluate(node.args[0], context, scope) as DaxScalar),

  ISERROR: (evaluator, node, context, scope) => {
    try {
      evaluator.evaluate(node.args[0], context, scope);
      return false;
    } catch (error) {
      if (!(error instanceof DaxRuntimeError)) throw error;
      return true;
    }
  },

  COALESCE: (evaluator, node, context, scope) => {
    for (const argument of node.args) {
      const value = evaluator.evaluate(argument, context, scope);
      if (!isTable(value) && !isBlank(value)) return value;
    }
    return BLANK;
  },

  BLANK: () => BLANK,

  // -- arithmetic ---------------------------------------------------------
  DIVIDE: (evaluator, node, context, scope) => {
    const numerator = evaluator.numberArg(node, 0, context, scope);
    const denominator = evaluator.numberArg(node, 1, context, scope);
    if (denominator === 0) {
      return node.args.length > 2 ? evaluator.evaluate(node.args[2], context, scope) : BLANK;
    }
    return numerator / denominator;
  },

  ROUND: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const digits = evaluator.numberArg(node, 1, context, scope);
    const factor = 10 ** digits;
    // Round half away from zero, as DAX does; Math.round breaks ties upward.
    return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  },

  ROUNDUP: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const factor = 10 ** evaluator.numberArg(node, 1, context, scope);
    return (Math.sign(value) * Math.ceil(Math.abs(value) * factor)) / factor;
  },

  ROUNDDOWN: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const factor = 10 ** evaluator.numberArg(node, 1, context, scope);
    return (Math.sign(value) * Math.floor(Math.abs(value) * factor)) / factor;
  },

  ABS: (evaluator, node, context, scope) => Math.abs(evaluator.numberArg(node, 0, context, scope)),
  INT: (evaluator, node, context, scope) => Math.trunc(evaluator.numberArg(node, 0, context, scope)),
  SQRT: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    if (value < 0) throw evaluator.error(node, 'SQRT cannot take the root of a negative number.');
    return Math.sqrt(value);
  },
  POWER: (evaluator, node, context, scope) =>
    evaluator.numberArg(node, 0, context, scope) ** evaluator.numberArg(node, 1, context, scope),
  MOD: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const divisor = evaluator.numberArg(node, 1, context, scope);
    if (divisor === 0) throw evaluator.error(node, 'MOD cannot divide by zero.');
    return value % divisor;
  },
  CEILING: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const significance = evaluator.numberArg(node, 1, context, scope);
    if (significance === 0) throw evaluator.error(node, 'CEILING needs a non-zero significance.');
    return Math.ceil(value / significance) * significance;
  },
  FLOOR: (evaluator, node, context, scope) => {
    const value = evaluator.numberArg(node, 0, context, scope);
    const significance = evaluator.numberArg(node, 1, context, scope);
    if (significance === 0) throw evaluator.error(node, 'FLOOR needs a non-zero significance.');
    return Math.floor(value / significance) * significance;
  },

  // -- text ---------------------------------------------------------------
  CONCATENATE: (evaluator, node, context, scope) =>
    evaluator.textArg(node, 0, context, scope) + evaluator.textArg(node, 1, context, scope),
  LEN: (evaluator, node, context, scope) => evaluator.textArg(node, 0, context, scope).length,
  UPPER: (evaluator, node, context, scope) =>
    evaluator.textArg(node, 0, context, scope).toUpperCase(),
  LOWER: (evaluator, node, context, scope) =>
    evaluator.textArg(node, 0, context, scope).toLowerCase(),
  TRIM: (evaluator, node, context, scope) => evaluator.textArg(node, 0, context, scope).trim(),
  LEFT: (evaluator, node, context, scope) => {
    const text = evaluator.textArg(node, 0, context, scope);
    const count = node.args.length > 1 ? evaluator.numberArg(node, 1, context, scope) : 1;
    return text.slice(0, Math.max(0, count));
  },
  RIGHT: (evaluator, node, context, scope) => {
    const text = evaluator.textArg(node, 0, context, scope);
    const count = node.args.length > 1 ? evaluator.numberArg(node, 1, context, scope) : 1;
    return count <= 0 ? '' : text.slice(-count);
  },
  MID: (evaluator, node, context, scope) => {
    const text = evaluator.textArg(node, 0, context, scope);
    // DAX counts from 1.
    const start = evaluator.numberArg(node, 1, context, scope);
    const count = evaluator.numberArg(node, 2, context, scope);
    return text.slice(Math.max(0, start - 1), Math.max(0, start - 1) + Math.max(0, count));
  },
  SUBSTITUTE: (evaluator, node, context, scope) => {
    const text = evaluator.textArg(node, 0, context, scope);
    const oldText = evaluator.textArg(node, 1, context, scope);
    const newText = evaluator.textArg(node, 2, context, scope);
    return oldText === '' ? text : text.split(oldText).join(newText);
  },

  // -- dates --------------------------------------------------------------
  YEAR: (evaluator, node, context, scope) =>
    datePart(evaluator, node, context, scope, date => date.getUTCFullYear()),
  MONTH: (evaluator, node, context, scope) =>
    datePart(evaluator, node, context, scope, date => date.getUTCMonth() + 1),
  DAY: (evaluator, node, context, scope) =>
    datePart(evaluator, node, context, scope, date => date.getUTCDate()),
  QUARTER: (evaluator, node, context, scope) =>
    datePart(evaluator, node, context, scope, date => Math.ceil((date.getUTCMonth() + 1) / 3)),

  TODAY: evaluator => {
    const today = evaluator.evaluateOptions.today ?? new Date();
    return toIsoDay(today);
  },
  NOW: evaluator => {
    const now = evaluator.evaluateOptions.today ?? new Date();
    return now.toISOString();
  },
  DATE: (evaluator, node, context, scope) => {
    const year = evaluator.numberArg(node, 0, context, scope);
    const month = evaluator.numberArg(node, 1, context, scope);
    const day = evaluator.numberArg(node, 2, context, scope);
    return toIsoDay(new Date(Date.UTC(year, month - 1, day)));
  },
};

const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

const parseDateScalar = (value: DaxScalar): Date | null => {
  if (value === null) return null;
  if (typeof value === 'number') return null;
  if (typeof value === 'boolean') return null;
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const datePart = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  read: (date: Date) => number
): DaxValue => {
  const value = evaluator.scalarArg(node, 0, context, scope);
  if (value === null) return BLANK;
  const date = parseDateScalar(value);
  if (!date) {
    throw evaluator.error(node.args[0], `${node.name} cannot read "${String(value)}" as a date.`);
  }
  return read(date);
};

/**
 * Apply one CALCULATE filter argument.
 *
 * Three shapes are understood, matching what DAX actually does with them:
 *
 *   ALL(...)                a filter modifier; removes filters
 *   Table[Column] = value   replaces the filter on that column only
 *   a table expression      replaces the row restriction on its table
 *
 * Anything else throws. A filter argument that is silently ignored is the
 * most dangerous failure this engine could have: the number still arrives,
 * and it is the unfiltered one.
 */
const applyCalculateFilter = (
  evaluator: Evaluator,
  argument: Expression,
  filter: FilterContext,
  outer: EvalContext,
  scope: Scope | null
): FilterContext => {
  const model = evaluator.semanticModel;

  if (argument.kind === 'call' && argument.name === 'ALL') {
    if (argument.args.length === 0) return emptyFilterContext();
    let next = filter;
    for (const target of argument.args) {
      if (target.kind === 'table') {
        next = withoutTable(next, target.name);
      } else if (target.kind === 'column') {
        const resolved = findColumn(model, target.table ?? undefined, target.column);
        if (!resolved.ok) throw evaluator.error(target, resolved.error);
        next = withoutColumn(next, resolved.value.table, resolved.value.name);
      } else {
        throw evaluator.error(target, 'ALL needs a table or a column here.');
      }
    }
    return next;
  }

  if (argument.kind === 'call' && argument.name === 'ALLEXCEPT') {
    const target = argument.args[0];
    if (target.kind !== 'table') {
      throw evaluator.error(target, 'ALLEXCEPT needs a table as its first argument.');
    }
    // Drop everything on the table, then put back the named columns.
    let next = withoutTable(filter, target.name);
    for (let i = 1; i < argument.args.length; i += 1) {
      const kept = argument.args[i];
      if (kept.kind !== 'column') {
        throw evaluator.error(kept, 'ALLEXCEPT needs column references after the table.');
      }
      const resolved = findColumn(model, kept.table ?? undefined, kept.column);
      if (!resolved.ok) throw evaluator.error(kept, resolved.error);
      const existing = filter.columns
        .get(resolved.value.table.toLowerCase())
        ?.get(resolved.value.name.toLowerCase());
      if (existing) {
        next = withColumnFilter(next, resolved.value.table, resolved.value.name, existing);
      }
    }
    return next;
  }

  const simple = asColumnPredicate(evaluator, argument);
  if (simple) {
    return withColumnFilter(filter, simple.table, simple.column, simple.allowed);
  }

  // A table expression: evaluate it in the outer context and use its rows.
  const value = evaluator.evaluate(argument, outer, scope);
  if (isTable(value)) {
    return withRowFilter(filter, value.table, value.rows);
  }

  throw evaluator.error(
    argument,
    'This CALCULATE filter is not supported yet. Use a comparison such as Sales[Region] = "Accra", ' +
      'a FILTER(...) expression, or ALL(...).'
  );
};

/**
 * Recognise `Table[Column] <op> value` and `Table[Column] IN {...}`, plus
 * conjunctions of those over a single column.
 *
 * The allowed values are computed across ALL rows of the table, not the
 * visible ones, because a CALCULATE filter replaces the existing filter on
 * that column rather than narrowing it.
 */
const asColumnPredicate = (
  evaluator: Evaluator,
  argument: Expression
): { table: string; column: string; allowed: Set<string> } | null => {
  const model = evaluator.semanticModel;

  const resolveColumn = (node: Expression) => {
    if (node.kind !== 'column') return null;
    const resolved = findColumn(model, node.table ?? undefined, node.column);
    return resolved.ok ? resolved.value : null;
  };

  const literalOf = (node: Expression): DaxScalar | undefined => {
    if (node.kind === 'number' || node.kind === 'string') return node.value;
    if (node.kind === 'boolean') return node.value;
    return undefined;
  };

  const allKeysWhere = (
    table: string,
    column: string,
    keep: (value: DaxScalar) => boolean
  ): Set<string> => {
    const owner = findTable(model, table)!;
    const allowed = new Set<string>();
    for (let index = 0; index < owner.rowCount; index += 1) {
      const value = cellValue(model, table, column, index);
      if (!keep(value)) continue;
      const key = keyOf(owner.rows[index][column]);
      if (key !== null) allowed.add(key);
    }
    return allowed;
  };

  if (argument.kind === 'binary') {
    const operator = argument.operator;

    if (operator === '&&') {
      const left = asColumnPredicate(evaluator, argument.left);
      const right = asColumnPredicate(evaluator, argument.right);
      if (
        left &&
        right &&
        left.table.toLowerCase() === right.table.toLowerCase() &&
        left.column.toLowerCase() === right.column.toLowerCase()
      ) {
        const allowed = new Set([...left.allowed].filter(key => right.allowed.has(key)));
        return { table: left.table, column: left.column, allowed };
      }
      return null;
    }

    const column = resolveColumn(argument.left);
    const literal = literalOf(argument.right);
    if (!column || literal === undefined) return null;

    const comparators: Record<string, (order: number) => boolean> = {
      '=': order => order === 0,
      '<>': order => order !== 0,
      '<': order => order < 0,
      '>': order => order > 0,
      '<=': order => order <= 0,
      '>=': order => order >= 0,
    };
    const test = comparators[operator];
    if (!test) return null;

    return {
      table: column.table,
      column: column.name,
      allowed: allKeysWhere(column.table, column.name, value =>
        test(compareScalars(value, literal))
      ),
    };
  }

  if (argument.kind === 'in' && !argument.negated) {
    const column = resolveColumn(argument.value);
    if (!column) return null;
    const literals = argument.candidates.map(literalOf);
    if (literals.some(value => value === undefined)) return null;
    return {
      table: column.table,
      column: column.name,
      allowed: allKeysWhere(column.table, column.name, value =>
        literals.some(candidate => valuesEqual(value, candidate as DaxScalar))
      ),
    };
  }

  return null;
};

/**
 * Evaluate a DAX expression against a model.
 *
 * Throws DaxSyntaxError for malformed input and DaxRuntimeError for anything
 * it cannot compute. It never returns a fallback value.
 */
export const evaluateDax = (
  source: string,
  model: SemanticModel,
  options: EvaluateOptions = {}
): DaxValue => {
  const expression = parseDax(source);
  const evaluator = new Evaluator(model, source, options);
  const context: EvalContext = {
    filter: options.filter ?? emptyFilterContext(),
    rowContexts: [],
  };
  return evaluator.evaluate(expression, context, null);
};

/** Evaluate and require a single value, which is what a measure must return. */
export const evaluateScalar = (
  source: string,
  model: SemanticModel,
  options: EvaluateOptions = {}
): DaxScalar => {
  const value = evaluateDax(source, model, options);
  if (isTable(value)) {
    throw new DaxRuntimeError(
      'This expression returns a table, but a measure has to return a single value.',
      source,
      0,
      source.length
    );
  }
  return value;
};

export { distinctKeysOf };
