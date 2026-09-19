import type { Expression, FunctionCall } from './ast';
import { parseDax } from './parser';
import { DaxRuntimeError, locate } from './errors';
import { lookupFunction, maxArity, minArity, formatSignature } from './registry';
import {
  andColumnFilter,
  andRowFilter,
  BLANK_KEY,
  cellValue,
  createVisibilityCache,
  isRelationshipActive,
  withRelationshipSwapped,
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
import { applyDaxFormat, DaxFormatError } from './format';
import {
  addDays,
  addMonths,
  dateDifference,
  endOfMonth,
  monthBounds,
  parseDifferenceInterval,
  weekNumber,
  parseInterval,
  parseKey,
  parseYearEnd,
  periodBounds,
  quarterBounds,
  shiftDate,
  yearBounds,
  CALENDAR_YEAR_END,
  type DateInterval,
  type DateRange,
} from './time';
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

  /**
   * The filter context this evaluation started from.
   *
   * Everything a measure adds with CALCULATE sits on top of this; ALLSELECTED
   * strips those back off and returns to what the caller asked for. That is
   * the closest honest equivalent to Power BI's "what the user selected",
   * which has no meaning without a report around it.
   */
  readonly externalFilter: FilterContext;

  constructor(
    private readonly model: SemanticModel,
    private readonly source: string,
    private readonly options: EvaluateOptions
  ) {
    this.externalFilter = options.filter ?? emptyFilterContext();
  }

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
      const related = this.followRelationship(
        context.rowContexts[i],
        owner,
        resolved.value.name,
        context.filter
      );
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
    targetColumn: string,
    filter: FilterContext
  ): DaxScalar | undefined {
    const relationship = this.model.relationships.find(
      candidate =>
        isRelationshipActive(filter, candidate) &&
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
    const filter = applyCalculateFilters(
      evaluator,
      node.args.slice(1),
      transitioned.filter,
      context,
      scope
    );
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

  ALLEXCEPT: (evaluator, node, context) => {
    const target = node.args[0];
    if (target.kind !== 'table') {
      throw evaluator.error(target, 'ALLEXCEPT needs a table as its first argument.');
    }
    const filter = allExceptFilter(evaluator, node, context.filter);
    return makeTable(
      target.name,
      evaluator.visibleRowsOf(target.name, { filter, rowContexts: [] })
    );
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
 * Apply a table-valued filter, replacing whatever filtered that table before.
 *
 * This is the DAX rule that a table filter argument overrides the filter
 * context on ALL columns of its table. Without it,
 * CALCULATE(..., SAMEPERIODLASTYEAR(Date[Date])) inside a slicer on 2024
 * would intersect last year's dates with "year = 2024" and return blank -
 * which is exactly what it did before this was fixed.
 *
 * It is safe for FILTER() too: FILTER evaluates its table argument in the
 * outer context, so the rows it returns already carry those filters.
 */
const replaceTableFilter = (
  filter: FilterContext,
  table: string,
  rows: number[]
): FilterContext => withRowFilter(withoutTable(filter, table), table, rows);

/**
 * Drop every filter on a table except those on the named columns.
 *
 * Shared by CALCULATE's filter-modifier path and the standalone ALLEXCEPT
 * handler, so the two cannot disagree about what ALLEXCEPT means.
 */
const allExceptFilter = (
  evaluator: Evaluator,
  call: FunctionCall,
  filter: FilterContext,
  keptFrom: FilterContext = filter
): FilterContext => {
  const model = evaluator.semanticModel;
  const target = call.args[0];
  if (target.kind !== 'table') {
    throw evaluator.error(target, 'ALLEXCEPT needs a table as its first argument.');
  }

  let next = withoutTable(filter, target.name);
  for (let i = 1; i < call.args.length; i += 1) {
    const kept = call.args[i];
    if (kept.kind !== 'column') {
      throw evaluator.error(kept, 'ALLEXCEPT needs column references after the table.');
    }
    const resolved = findColumn(model, kept.table ?? undefined, kept.column);
    if (!resolved.ok) throw evaluator.error(kept, resolved.error);
    const existing = keptFrom.columns
      .get(resolved.value.table.toLowerCase())
      ?.get(resolved.value.name.toLowerCase());
    if (existing) {
      next = withColumnFilter(next, resolved.value.table, resolved.value.name, existing);
    }
  }
  return next;
};

/**
 * What one CALCULATE filter argument does to the filter context.
 *
 * Split in two because DAX combines filter arguments differently from how it
 * combines them with the surrounding context. Each argument OVERRIDES the
 * outer filters on whatever it touches, but arguments within the same
 * CALCULATE are ANDed together. Applying them one after another - so a later
 * one replaces an earlier one - makes
 * CALCULATE(x, Date[Year] = 1999, DATESYTD(Date[Date])) quietly return the
 * whole of the latest year instead of nothing.
 *
 * So every argument is resolved against the outer context, then all the
 * clears run, then all the applies intersect.
 */
interface FilterContribution {
  clear: (filter: FilterContext) => FilterContext;
  apply: (filter: FilterContext) => FilterContext;
}

const identity = (filter: FilterContext): FilterContext => filter;

/**
 * Resolve one CALCULATE filter argument.
 *
 * Three shapes are understood, matching what DAX does with them:
 *
 *   ALL(...) / ALLEXCEPT(...)   filter modifiers; remove filters
 *   Table[Column] = value       overrides the filter on that column only
 *   a table expression          overrides the filters on its whole table
 *
 * Anything else throws. A filter argument that is silently ignored is the
 * most dangerous failure this engine could have: the number still arrives,
 * and it is the unfiltered one.
 */
const resolveCalculateFilter = (
  evaluator: Evaluator,
  argument: Expression,
  outerFilter: FilterContext,
  outer: EvalContext,
  scope: Scope | null
): FilterContribution => {
  const model = evaluator.semanticModel;

  if (argument.kind === 'call' && argument.name === 'ALL') {
    if (argument.args.length === 0) {
      return { clear: () => emptyFilterContext(), apply: identity };
    }
    const targets = argument.args;
    return {
      clear: filter => {
        let next = filter;
        for (const target of targets) {
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
      },
      apply: identity,
    };
  }

  if (argument.kind === 'call' && argument.name === 'ALLEXCEPT') {
    // The kept columns keep their OUTER filters, so those are read from the
    // context as it was before any clearing began.
    return {
      clear: filter => allExceptFilter(evaluator, argument, filter, outerFilter),
      apply: identity,
    };
  }

  if (argument.kind === 'call' && argument.name === 'USERELATIONSHIP') {
    const [first, second] = argument.args;
    const ends = [first, second].map(end => {
      if (end === undefined || end.kind !== 'column') {
        throw evaluator.error(argument, 'USERELATIONSHIP needs two column references.');
      }
      const resolved = findColumn(model, end.table ?? undefined, end.column);
      if (!resolved.ok) throw evaluator.error(end, resolved.error);
      return resolved.value;
    });

    const matches = (side: { table: string; column: string }, end: { table: string; name: string }) =>
      side.table.toLowerCase() === end.table.toLowerCase() &&
      side.column.toLowerCase() === end.name.toLowerCase();

    const wanted = model.relationships.find(
      relationship =>
        (matches(relationship.from, ends[0]) && matches(relationship.to, ends[1])) ||
        (matches(relationship.from, ends[1]) && matches(relationship.to, ends[0]))
    );
    if (!wanted) {
      throw evaluator.error(
        argument,
        `There is no relationship between ${ends[0].table}[${ends[0].name}] and ` +
          `${ends[1].table}[${ends[1].name}] to activate.`
      );
    }

    return {
      clear: filter => withRelationshipSwapped(filter, wanted, model.relationships),
      apply: identity,
    };
  }

  if (argument.kind === 'call' && argument.name === 'ALLSELECTED') {
    const target = argument.args[0];
    if (target === undefined || target.kind !== 'table') {
      throw evaluator.error(argument, 'ALLSELECTED needs a table name here.');
    }
    const external = evaluator.externalFilter;
    const name = target.name;
    return {
      // Put back exactly what the caller asked for on this table, dropping
      // whatever the surrounding measure added.
      clear: filter => {
        let next = withoutTable(filter, name);
        const columns = external.columns.get(name.toLowerCase());
        if (columns) {
          for (const [column, allowed] of columns) {
            next = withColumnFilter(next, name, column, allowed);
          }
        }
        const rows = external.rows.get(name.toLowerCase());
        if (rows) next = withRowFilter(next, name, rows);
        return next;
      },
      apply: identity,
    };
  }

  const simple = asColumnPredicate(evaluator, argument, outer, scope);
  if (simple) {
    return {
      clear: filter => withoutColumn(filter, simple.table, simple.column),
      apply: filter => andColumnFilter(filter, simple.table, simple.column, simple.allowed),
    };
  }

  const value = evaluator.evaluate(argument, outer, scope);
  if (isTable(value)) {
    return {
      clear: filter => withoutTable(filter, value.table),
      apply: filter => andRowFilter(filter, value.table, value.rows),
    };
  }

  throw evaluator.error(
    argument,
    'This CALCULATE filter is not supported yet. Use a comparison such as Sales[Region] = "Accra", ' +
      'a FILTER(...) expression, or ALL(...).'
  );
};

/** Resolve, clear, then intersect - the order DAX combines filters in. */
const applyCalculateFilters = (
  evaluator: Evaluator,
  args: Expression[],
  base: FilterContext,
  outer: EvalContext,
  scope: Scope | null
): FilterContext => {
  const contributions = args.map(argument =>
    resolveCalculateFilter(evaluator, argument, base, outer, scope)
  );

  let filter = base;
  for (const contribution of contributions) filter = contribution.clear(filter);
  for (const contribution of contributions) filter = contribution.apply(filter);
  return filter;
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
  argument: Expression,
  outer: EvalContext,
  scope: Scope | null
): { table: string; column: string; allowed: Set<string> } | null => {
  const model = evaluator.semanticModel;

  const resolveColumn = (node: Expression) => {
    if (node.kind !== 'column') return null;
    const resolved = findColumn(model, node.table ?? undefined, node.column);
    return resolved.ok ? resolved.value : null;
  };

  /**
   * The value on the right of a comparison, evaluated once.
   *
   * It used to accept only a literal, which quietly disqualified the whole
   * predicate and sent CALCULATE(x, Date[Year] = YEAR(TODAY())) down the
   * path that treats the comparison as a scalar - where a bare column has
   * no row to read from, so it failed with a misleading error. Every
   * year-on-year measure is written that way.
   *
   * DAX evaluates this side once, outside the row-by-row scan, in the
   * context surrounding the CALCULATE. So that is what happens here: no row
   * context, so a bare column reference still fails rather than silently
   * picking a row.
   *
   * Returning undefined means "not a constant I can use", and the caller
   * falls back to evaluating the whole argument - which raises the real
   * error rather than a filter that was quietly dropped.
   */
  const constantOf = (node: Expression): DaxScalar | undefined => {
    if (node.kind === 'number' || node.kind === 'string') return node.value;
    if (node.kind === 'boolean') return node.value;
    try {
      // Evaluated in the context SURROUNDING the CALCULATE, row context and
      // all. Power BI answers
      //   SUMX(Sales, CALCULATE(SUM(Sales[Amount]), Sales[Amount] = Sales[Amount] * 1))
      // with the grand total, which is only possible if the right-hand side
      // resolves against the iterated row. This engine read it with no row
      // context until 2026-09-19 and refused the expression outright; the
      // refusal was safe but wrong, and Power BI settled it.
      //
      // At the top level there is no row context, so a bare column still
      // throws here and is caught below - it cannot silently resolve against
      // an arbitrary row.
      const value = evaluator.evaluate(node, outer, scope);
      return isTable(value) ? undefined : value;
    } catch {
      return undefined;
    }
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
      // Blanks pass predicates like <> "North" - BLANK compares as the empty
      // string - so they have to be admissible, not silently dropped.
      allowed.add(key === null ? BLANK_KEY : key);
    }
    return allowed;
  };

  if (argument.kind === 'binary') {
    const operator = argument.operator;

    if (operator === '&&') {
      const left = asColumnPredicate(evaluator, argument.left, outer, scope);
      const right = asColumnPredicate(evaluator, argument.right, outer, scope);
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
    const literal = constantOf(argument.right);
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
    const literals = argument.candidates.map(constantOf);
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

// ============================================================
// Time intelligence
// ============================================================

/**
 * A date column and what is visible of it.
 *
 * Built once per call because these functions have to look OUTSIDE the
 * current filter context - SAMEPERIODLASTYEAR returns dates that are, by
 * definition, filtered out right now. So `rowsByDate` indexes every row of
 * the table, while `visibleDates` holds only what the context leaves.
 */
interface DateColumnScope {
  table: string;
  column: string;
  /** Sorted, and only what the current filter context leaves visible. */
  visibleDates: string[];
  /** Every row of the table, indexed by its date key. */
  rowsByDate: Map<string, number[]>;
}

const dateScope = (
  evaluator: Evaluator,
  node: FunctionCall,
  index: number,
  context: EvalContext
): DateColumnScope => {
  const reference = evaluator.columnArg(node, index);
  const model = evaluator.semanticModel;
  const table = findTable(model, reference.table);
  if (!table) throw evaluator.error(node.args[index], `There is no table called "${reference.table}".`);

  const column = table.columns.find(
    candidate => candidate.name.toLowerCase() === reference.column.toLowerCase()
  );
  if (!column || column.dataType !== 'date') {
    throw evaluator.error(
      node.args[index],
      `${node.name} needs a date column. ${reference.table}[${reference.column}] holds ` +
        `${column ? column.dataType : 'unknown'} values. Point it at the calendar, for example ` +
        `${model.dateTableName ?? 'Date'}[Date].`
    );
  }

  const rowsByDate = new Map<string, number[]>();
  for (let index_ = 0; index_ < table.rowCount; index_ += 1) {
    const value = cellValue(model, reference.table, reference.column, index_);
    if (typeof value !== 'string') continue;
    const existing = rowsByDate.get(value);
    if (existing) existing.push(index_);
    else rowsByDate.set(value, [index_]);
  }

  const visibleDates: string[] = [];
  for (const rowIndex of evaluator.visibleRowsOf(reference.table, context)) {
    const value = cellValue(model, reference.table, reference.column, rowIndex);
    if (typeof value === 'string') visibleDates.push(value);
  }
  visibleDates.sort();

  return { table: reference.table, column: reference.column, visibleDates, rowsByDate };
};

/**
 * Turn a set of date keys back into rows of the date table.
 *
 * Deduplicated, because shifting can collapse two dates onto one: moving
 * February 2024 back a year sends both the 28th and the 29th to 28 February
 * 2023, and counting that day twice would inflate every total using it.
 */
const tableOfDates = (scope: DateColumnScope, dates: Iterable<string>): DaxTable => {
  const rows = new Set<number>();
  for (const iso of new Set(dates)) {
    for (const rowIndex of scope.rowsByDate.get(iso) ?? []) rows.add(rowIndex);
  }
  return makeTable(scope.table, Array.from(rows).sort((a, b) => a - b));
};

/** Every date in the column that falls inside a range. Keys sort lexically. */
const datesWithin = (scope: DateColumnScope, range: DateRange): string[] =>
  Array.from(scope.rowsByDate.keys())
    .filter(iso => iso >= range.start && iso <= range.end)
    .sort();

/**
 * Resolve the optional year-end argument.
 *
 * Defaults to the calendar year, which is what DAX does even when the model
 * has a fiscal year configured. Matching Power BI matters more here than
 * being clever: a user who wants a fiscal year to date passes "6/30", and
 * that same expression then means the same thing in both tools.
 */
const yearEndArgument = (
  evaluator: Evaluator,
  node: FunctionCall,
  index: number,
  context: EvalContext,
  scope: Scope | null
): { month: number; day: number } => {
  if (node.args.length <= index) return CALENDAR_YEAR_END;
  const raw = evaluator.textArg(node, index, context, scope);
  const parsed = parseYearEnd(raw);
  if (!parsed) {
    throw evaluator.error(
      node.args[index],
      `"${raw}" is not a year end this can read. Use a form where the day is unambiguous, ` +
        `such as "6/30" or "12/31".`
    );
  }
  return parsed;
};

const requireInterval = (
  evaluator: Evaluator,
  node: FunctionCall,
  index: number,
  context: EvalContext,
  scope: Scope | null
): DateInterval => {
  const argument = node.args[index];
  // DAX writes the interval as a bare keyword - DATEADD(Date[Date], -1, MONTH).
  // The parser cannot tell that from a table name, so it is unwrapped here
  // rather than evaluated, which would fail with "no table called MONTH".
  const raw =
    argument.kind === 'table'
      ? argument.name
      : evaluator.textArg(node, index, context, scope);
  const interval = parseInterval(raw);
  if (!interval) {
    throw evaluator.error(
      node.args[index],
      `"${raw}" is not an interval. Use DAY, MONTH, QUARTER or YEAR.`
    );
  }
  return interval;
};

/** Dates from the opening of a period up to the latest date in context. */
const toDateSet = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  bounds: (last: string, yearEnd: { month: number; day: number }) => DateRange | null,
  yearEndIndex: number
): DaxTable => {
  const dateColumn = dateScope(evaluator, node, 0, context);
  if (dateColumn.visibleDates.length === 0) return makeTable(dateColumn.table, []);

  const last = dateColumn.visibleDates[dateColumn.visibleDates.length - 1];
  const yearEnd = yearEndArgument(evaluator, node, yearEndIndex, context, scope);
  const period = bounds(last, yearEnd);
  if (!period) return makeTable(dateColumn.table, []);

  // To date, so the period opens normally but stops at the latest date shown.
  return tableOfDates(dateColumn, datesWithin(dateColumn, { start: period.start, end: last }));
};

/**
 * The whole period immediately before or after the one holding the latest
 * date in context.
 *
 * Stepping one day off the current period's edge and asking which period
 * that day belongs to handles the awkward cases for free: the period before
 * January is December of the prior year, and month lengths never enter into
 * it.
 */
const adjacentPeriod = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  interval: DateInterval,
  direction: -1 | 1,
  yearEndIndex: number
): DaxTable => {
  const dateColumn = dateScope(evaluator, node, 0, context);
  if (dateColumn.visibleDates.length === 0) return makeTable(dateColumn.table, []);

  const anchor =
    direction === -1
      ? dateColumn.visibleDates[dateColumn.visibleDates.length - 1]
      : dateColumn.visibleDates[dateColumn.visibleDates.length - 1];
  const yearEnd = yearEndArgument(evaluator, node, yearEndIndex, context, scope);
  const current = periodBounds(anchor, interval, yearEnd);
  if (!current) return makeTable(dateColumn.table, []);

  const steppedDay = direction === -1 ? addDays(current.start, -1) : addDays(current.end, 1);
  const neighbour = periodBounds(steppedDay, interval, yearEnd);
  if (!neighbour) return makeTable(dateColumn.table, []);

  return tableOfDates(dateColumn, datesWithin(dateColumn, neighbour));
};

const previousPeriod = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  interval: DateInterval,
  yearEndIndex: number
): DaxTable =>
  adjacentPeriod(evaluator, node, context, scope, interval, -1, yearEndIndex);

/** The first or last date of the period holding the latest date in context. */
const periodEdge = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  interval: DateInterval,
  edge: 'start' | 'end'
): DaxValue => {
  const dateColumn = dateScope(evaluator, node, 0, context);
  if (dateColumn.visibleDates.length === 0) return BLANK;
  const last = dateColumn.visibleDates[dateColumn.visibleDates.length - 1];
  const bounds = periodBounds(last, interval, CALENDAR_YEAR_END);
  return bounds ? bounds[edge] : BLANK;
};

/** CALCULATE(expression, <date set>, [extra filter]) - the TOTAL* family. */
const totalOverPeriod = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  bounds: (last: string, yearEnd: { month: number; day: number }) => DateRange | null
): DaxValue => {
  // TOTALYTD(expression, dates, [filter], [yearEnd]). A string in the third
  // position is the year end; anything else is a filter.
  const third = node.args[2];
  const thirdIsYearEnd = third !== undefined && third.kind === 'string';
  const yearEndIndex = thirdIsYearEnd ? 2 : 3;

  const dates = toDateSetForTotal(evaluator, node, context, scope, bounds, yearEndIndex);

  let filter = replaceTableFilter(
    evaluator.transition(context).filter,
    dates.table,
    dates.rows
  );

  if (third !== undefined && !thirdIsYearEnd) {
    filter = applyCalculateFilters(evaluator, [third], filter, context, scope);
  }

  return evaluator.evaluate(node.args[0], { filter, rowContexts: [] }, scope);
};

/** As toDateSet, but reading the date column from argument 1 rather than 0. */
const toDateSetForTotal = (
  evaluator: Evaluator,
  node: FunctionCall,
  context: EvalContext,
  scope: Scope | null,
  bounds: (last: string, yearEnd: { month: number; day: number }) => DateRange | null,
  yearEndIndex: number
): DaxTable => {
  const dateColumn = dateScope(evaluator, node, 1, context);
  if (dateColumn.visibleDates.length === 0) return makeTable(dateColumn.table, []);

  const last = dateColumn.visibleDates[dateColumn.visibleDates.length - 1];
  const yearEnd = yearEndArgument(evaluator, node, yearEndIndex, context, scope);
  const period = bounds(last, yearEnd);
  if (!period) return makeTable(dateColumn.table, []);

  return tableOfDates(dateColumn, datesWithin(dateColumn, { start: period.start, end: last }));
};

const TIME_HANDLERS: Record<string, Handler> = {
  DATESYTD: (evaluator, node, context, scope) =>
    toDateSet(evaluator, node, context, scope, (last, yearEnd) =>
      yearBounds(last, yearEnd.month, yearEnd.day), 1),

  DATESQTD: (evaluator, node, context, scope) =>
    toDateSet(evaluator, node, context, scope, last => quarterBounds(last), 99),

  DATESMTD: (evaluator, node, context, scope) =>
    toDateSet(evaluator, node, context, scope, last => monthBounds(last), 99),

  TOTALYTD: (evaluator, node, context, scope) =>
    totalOverPeriod(evaluator, node, context, scope, (last, yearEnd) =>
      yearBounds(last, yearEnd.month, yearEnd.day)),

  TOTALQTD: (evaluator, node, context, scope) =>
    totalOverPeriod(evaluator, node, context, scope, last => quarterBounds(last)),

  TOTALMTD: (evaluator, node, context, scope) =>
    totalOverPeriod(evaluator, node, context, scope, last => monthBounds(last)),

  SAMEPERIODLASTYEAR: (evaluator, node, context) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    // Every visible day, moved back a year. 29 February becomes 28 February,
    // which is the clamping in addMonths doing its job.
    return tableOfDates(
      dateColumn,
      dateColumn.visibleDates.map(iso => shiftDate(iso, -1, 'YEAR'))
    );
  },

  DATEADD: (evaluator, node, context, scope) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    const count = evaluator.numberArg(node, 1, context, scope);
    const interval = requireInterval(evaluator, node, 2, context, scope);
    return tableOfDates(
      dateColumn,
      dateColumn.visibleDates.map(iso => shiftDate(iso, count, interval))
    );
  },

  PREVIOUSYEAR: (evaluator, node, context, scope) =>
    previousPeriod(evaluator, node, context, scope, 'YEAR', 1),

  PREVIOUSQUARTER: (evaluator, node, context, scope) =>
    previousPeriod(evaluator, node, context, scope, 'QUARTER', 99),

  PREVIOUSMONTH: (evaluator, node, context, scope) =>
    previousPeriod(evaluator, node, context, scope, 'MONTH', 99),

  PARALLELPERIOD: (evaluator, node, context, scope) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    if (dateColumn.visibleDates.length === 0) return makeTable(dateColumn.table, []);

    const count = evaluator.numberArg(node, 1, context, scope);
    const interval = requireInterval(evaluator, node, 2, context, scope);

    // Unlike DATEADD, this returns WHOLE periods: one month of context shifted
    // back a year gives all of that month last year, not the same day count.
    const first = shiftDate(dateColumn.visibleDates[0], count, interval);
    const last = shiftDate(
      dateColumn.visibleDates[dateColumn.visibleDates.length - 1],
      count,
      interval
    );
    const opening = periodBounds(first, interval, CALENDAR_YEAR_END);
    const closing = periodBounds(last, interval, CALENDAR_YEAR_END);
    if (!opening || !closing) return makeTable(dateColumn.table, []);

    return tableOfDates(
      dateColumn,
      datesWithin(dateColumn, { start: opening.start, end: closing.end })
    );
  },

  DATESINPERIOD: (evaluator, node, context, scope) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    const startValue = evaluator.scalarArg(node, 1, context, scope);
    if (typeof startValue !== 'string' || !parseKey(startValue)) {
      throw evaluator.error(
        node.args[1],
        `DATESINPERIOD needs a start date, for example LASTDATE(${dateColumn.table}[${dateColumn.column}]).`
      );
    }
    const count = evaluator.numberArg(node, 2, context, scope);
    const interval = requireInterval(evaluator, node, 3, context, scope);

    // A negative count means the period ENDING at the start date, so the far
    // end moves one day inside the shifted boundary.
    const far = shiftDate(startValue, count, interval);
    const range =
      count >= 0
        ? { start: startValue, end: addDays(far, -1) }
        : { start: addDays(far, 1), end: startValue };

    return tableOfDates(dateColumn, datesWithin(dateColumn, range));
  },

  FIRSTDATE: (evaluator, node, context) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    return dateColumn.visibleDates.length === 0 ? BLANK : dateColumn.visibleDates[0];
  },

  LASTDATE: (evaluator, node, context) => {
    const dateColumn = dateScope(evaluator, node, 0, context);
    return dateColumn.visibleDates.length === 0
      ? BLANK
      : dateColumn.visibleDates[dateColumn.visibleDates.length - 1];
  },
};

/**
 * Period edges and the NEXT* family.
 *
 * The STARTOF and ENDOF functions return a single date rather than the
 * one-row table DAX uses, matching FIRSTDATE and LASTDATE here; that is the
 * form they are almost always wanted in, and it composes with DATESINPERIOD.
 * The NEXT functions return tables, like the PREVIOUS ones, because they
 * exist to be used as filters.
 */
const PERIOD_HANDLERS: Record<string, Handler> = {
  STARTOFMONTH: (e, n, c, s) => periodEdge(e, n, c, s, 'MONTH', 'start'),
  STARTOFQUARTER: (e, n, c, s) => periodEdge(e, n, c, s, 'QUARTER', 'start'),
  STARTOFYEAR: (e, n, c, s) => periodEdge(e, n, c, s, 'YEAR', 'start'),
  ENDOFMONTH: (e, n, c, s) => periodEdge(e, n, c, s, 'MONTH', 'end'),
  ENDOFQUARTER: (e, n, c, s) => periodEdge(e, n, c, s, 'QUARTER', 'end'),
  ENDOFYEAR: (e, n, c, s) => periodEdge(e, n, c, s, 'YEAR', 'end'),

  NEXTMONTH: (e, n, c, s) => adjacentPeriod(e, n, c, s, 'MONTH', 1, 99),
  NEXTQUARTER: (e, n, c, s) => adjacentPeriod(e, n, c, s, 'QUARTER', 1, 99),
  NEXTYEAR: (e, n, c, s) => adjacentPeriod(e, n, c, s, 'YEAR', 1, 1),
  NEXTDAY: (e, n, c, s) => adjacentPeriod(e, n, c, s, 'DAY', 1, 99),
  PREVIOUSDAY: (e, n, c, s) => adjacentPeriod(e, n, c, s, 'DAY', -1, 99),
};

Object.assign(HANDLERS, TIME_HANDLERS, PERIOD_HANDLERS);

// ============================================================
// Statistics, ranking, lookup and formatting
// ============================================================

/**
 * Read an argument that DAX writes as a bare keyword - ASC, DESC, DENSE,
 * MONTH and so on. The parser can only see those as table references, so
 * they are unwrapped here rather than evaluated.
 */
const keywordArg = (
  evaluator: Evaluator,
  node: FunctionCall,
  index: number,
  context: EvalContext,
  scope: Scope | null
): string => {
  const argument = node.args[index];
  if (argument === undefined) return '';
  if (argument.kind === 'table') return argument.name.toUpperCase();
  const value = evaluator.evaluate(argument, context, scope);
  if (typeof value === 'number') return String(value);
  return toText(value, node.name).toUpperCase();
};

const sortedNumbers = (values: DaxScalar[]): number[] =>
  numericValues(values).sort((a, b) => a - b);

/** Excel's PERCENTILE.INC: linear interpolation across (n-1) intervals. */
const percentileInclusive = (sorted: number[], fraction: number): number => {
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
};

const meanOf = (numbers: number[]): number =>
  numbers.reduce((total, value) => total + value, 0) / numbers.length;

const sumSquaredDeviations = (numbers: number[]): number => {
  const mean = meanOf(numbers);
  return numbers.reduce((total, value) => total + (value - mean) ** 2, 0);
};

const STATISTICAL_HANDLERS: Record<string, Handler> = {
  MEDIAN: columnAggregate(values => {
    const sorted = sortedNumbers(values);
    if (sorted.length === 0) return BLANK;
    return percentileInclusive(sorted, 0.5);
  }),

  'PERCENTILE.INC': (evaluator, node, context, scope) => {
    const reference = evaluator.columnArg(node, 0);
    const fraction = evaluator.numberArg(node, 1, context, scope);
    if (fraction < 0 || fraction > 1) {
      throw evaluator.error(node.args[1], 'PERCENTILE.INC needs a value from 0 to 1.');
    }
    const sorted = sortedNumbers(evaluator.columnValues(reference, context));
    return sorted.length === 0 ? BLANK : percentileInclusive(sorted, fraction);
  },

  // Population forms divide by n, sample forms by n-1. A sample of one has
  // no spread to estimate, so it is BLANK rather than zero.
  'VAR.P': columnAggregate(values => {
    const numbers = numericValues(values);
    return numbers.length === 0 ? BLANK : sumSquaredDeviations(numbers) / numbers.length;
  }),

  'VAR.S': columnAggregate(values => {
    const numbers = numericValues(values);
    return numbers.length < 2 ? BLANK : sumSquaredDeviations(numbers) / (numbers.length - 1);
  }),

  'STDEV.P': columnAggregate(values => {
    const numbers = numericValues(values);
    return numbers.length === 0
      ? BLANK
      : Math.sqrt(sumSquaredDeviations(numbers) / numbers.length);
  }),

  'STDEV.S': columnAggregate(values => {
    const numbers = numericValues(values);
    return numbers.length < 2
      ? BLANK
      : Math.sqrt(sumSquaredDeviations(numbers) / (numbers.length - 1));
  }),

  CONCATENATEX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const delimiter =
      node.args.length > 2 ? evaluator.textArg(node, 2, context, scope) : '';
    const parts = evaluator
      .iterate(table, context, scope, node.args[1])
      .map(value => toText(value, 'CONCATENATEX'))
      .filter(text => text.length > 0);
    return parts.length === 0 ? BLANK : parts.join(delimiter);
  },

  RANKX: (evaluator, node, context, scope) => {
    const table = evaluator.tableArg(node, 0, context, scope);
    const expression = node.args[1];

    const values = evaluator
      .iterate(table, context, scope, expression)
      .map(value => expectScalar(value, 'RANKX'))
      .filter((value): value is Exclude<DaxScalar, null> => value !== null);

    // Without an explicit value, rank whatever the expression gives in the
    // context we are already in - which inside an iterator is this row.
    const subject =
      node.args.length > 2
        ? expectScalar(evaluator.evaluate(node.args[2], context, scope), 'RANKX')
        : expectScalar(evaluator.evaluate(expression, context, scope), 'RANKX');
    if (subject === null) return BLANK;

    const order = keywordArg(evaluator, node, 3, context, scope);
    // DAX defaults to descending: the largest value ranks first.
    const ascending = order === 'ASC' || order === 'TRUE' || order === '1';
    const dense = keywordArg(evaluator, node, 4, context, scope) === 'DENSE';

    let ahead = 0;
    const distinctAhead = new Set<string>();
    for (const value of values) {
      const comparison = compareScalars(value, subject);
      const beats = ascending ? comparison < 0 : comparison > 0;
      if (!beats) continue;
      ahead += 1;
      distinctAhead.add(String(value).toLowerCase());
    }

    return (dense ? distinctAhead.size : ahead) + 1;
  },

  TOPN: (evaluator, node, context, scope) => {
    const count = evaluator.numberArg(node, 0, context, scope);
    const table = evaluator.tableArg(node, 1, context, scope);
    if (count <= 0) return makeTable(table.table, []);

    if (node.args.length < 3) {
      return makeTable(table.table, table.rows.slice(0, count));
    }

    const order = keywordArg(evaluator, node, 3, context, scope);
    const ascending = order === 'ASC' || order === 'TRUE' || order === '1';

    const scored = table.rows.map(rowIndex => ({
      rowIndex,
      value: expectScalar(
        evaluator.evaluate(node.args[2], {
          filter: context.filter,
          rowContexts: [...context.rowContexts, { table: table.table, rowIndex }],
        }, scope),
        'TOPN'
      ),
    }));

    scored.sort((a, b) => {
      const comparison = compareScalars(a.value, b.value);
      return ascending ? comparison : -comparison;
    });

    // DAX keeps every row tied with the last one included, so TOPN can
    // return more rows than asked for rather than cutting arbitrarily.
    const cut = Math.min(count, scored.length);
    let end = cut;
    while (end < scored.length && compareScalars(scored[end].value, scored[cut - 1].value) === 0) {
      end += 1;
    }

    return makeTable(table.table, scored.slice(0, end).map(entry => entry.rowIndex));
  },

  LOOKUPVALUE: (evaluator, node, context, scope) => {
    const result = evaluator.columnArg(node, 0);
    const model = evaluator.semanticModel;
    const owner = findTable(model, result.table);
    if (!owner) throw evaluator.error(node.args[0], `There is no table called "${result.table}".`);

    if ((node.args.length - 1) % 2 !== 0) {
      throw evaluator.error(
        node,
        'LOOKUPVALUE needs the search columns and values in pairs, for example ' +
          'LOOKUPVALUE(Customers[Name], Customers[CustomerID], "C1").'
      );
    }

    const pairs: { column: string; value: DaxScalar }[] = [];
    for (let i = 1; i + 1 < node.args.length; i += 2) {
      const searchColumn = evaluator.columnArg(node, i);
      if (searchColumn.table.toLowerCase() !== result.table.toLowerCase()) {
        throw evaluator.error(
          node.args[i],
          `LOOKUPVALUE searches one table at a time. ${searchColumn.table}[${searchColumn.column}] ` +
            `is not in ${result.table}.`
        );
      }
      pairs.push({
        column: searchColumn.column,
        value: evaluator.scalarArg(node, i + 1, context, scope),
      });
    }

    // Deliberately scans the whole table: LOOKUPVALUE is a lookup, not an
    // aggregation, and is not meant to move with the filter context.
    const found: DaxScalar[] = [];
    for (let rowIndex = 0; rowIndex < owner.rowCount; rowIndex += 1) {
      const matches = pairs.every(pair =>
        valuesEqual(cellValue(model, result.table, pair.column, rowIndex), pair.value)
      );
      if (matches) found.push(cellValue(model, result.table, result.column, rowIndex));
    }

    if (found.length === 0) return BLANK;
    const distinct = new Set(found.map(value => String(value).toLowerCase()));
    if (distinct.size > 1) {
      throw evaluator.error(
        node,
        `LOOKUPVALUE found ${distinct.size} different values for ${result.table}[${result.column}]. ` +
          'Add another search column, or use an aggregation if more than one row is expected.'
      );
    }
    return found[0];
  },

  SELECTEDVALUE: (evaluator, node, context, scope) => {
    const reference = evaluator.columnArg(node, 0);
    const values = evaluator.columnValues(reference, context);

    const distinct = new Map<string, DaxScalar>();
    for (const value of values) {
      if (value === null) continue;
      distinct.set(String(value).toLowerCase(), value);
    }

    if (distinct.size === 1) return Array.from(distinct.values())[0];
    return node.args.length > 1 ? evaluator.evaluate(node.args[1], context, scope) : BLANK;
  },

  CALCULATETABLE: (evaluator, node, context, scope) => {
    const transitioned = evaluator.transition(context);
    const filter = applyCalculateFilters(
      evaluator,
      node.args.slice(1),
      transitioned.filter,
      context,
      scope
    );
    const value = evaluator.evaluate(node.args[0], { filter, rowContexts: [] }, scope);
    if (!isTable(value)) {
      throw evaluator.error(node.args[0], 'CALCULATETABLE needs a table expression.');
    }
    return value;
  },

  RELATEDTABLE: (evaluator, node, context) => {
    const target = node.args[0];
    if (target.kind !== 'table') {
      throw evaluator.error(target, 'RELATEDTABLE needs a table name.');
    }
    if (context.rowContexts.length === 0) {
      throw evaluator.error(
        node,
        'RELATEDTABLE needs a row to work from. Use it inside an iterator such as SUMX.'
      );
    }
    // Context transition turns the current row into a filter, which then
    // propagates down the relationship to the rows on the many side.
    const transitioned = evaluator.transition(context);
    return makeTable(target.name, evaluator.visibleRowsOf(target.name, transitioned));
  },

  ALLSELECTED: (evaluator, node, context) => {
    const target = node.args[0];
    if (target === undefined || target.kind !== 'table') {
      throw evaluator.error(
        node,
        'ALLSELECTED needs a table name here, for example ALLSELECTED(Sales).'
      );
    }
    return makeTable(
      target.name,
      evaluator.visibleRowsOf(target.name, {
        filter: evaluator.externalFilter,
        rowContexts: [],
      })
    );
  },

  USERELATIONSHIP: (evaluator, node) => {
    throw evaluator.error(
      node,
      'USERELATIONSHIP only works as a CALCULATE filter, for example ' +
        'CALCULATE(SUM(Sales[Amount]), USERELATIONSHIP(Sales[ShipDate], Date[Date])).'
    );
  },

  FORMAT: (evaluator, node, context, scope) => {
    const value = evaluator.scalarArg(node, 0, context, scope);
    if (value === null) return BLANK;
    const pattern = evaluator.textArg(node, 1, context, scope);
    try {
      return applyDaxFormat(value as string | number | boolean, pattern);
    } catch (error) {
      if (error instanceof DaxFormatError) throw evaluator.error(node, error.message);
      throw error;
    }
  },

  DATEDIFF: (evaluator, node, context, scope) => {
    const start = evaluator.scalarArg(node, 0, context, scope);
    const end = evaluator.scalarArg(node, 1, context, scope);
    if (start === null || end === null) return BLANK;

    const raw = keywordArg(evaluator, node, 2, context, scope);
    const interval = parseDifferenceInterval(raw);
    if (!interval) {
      throw evaluator.error(
        node.args[2],
        `"${raw}" is not an interval. Use DAY, WEEK, MONTH, QUARTER or YEAR.`
      );
    }

    const difference = dateDifference(String(start), String(end), interval);
    if (difference === null) {
      throw evaluator.error(node, `DATEDIFF cannot read "${String(start)}" and "${String(end)}" as dates.`);
    }
    return difference;
  },

  EDATE: (evaluator, node, context, scope) => {
    const value = evaluator.scalarArg(node, 0, context, scope);
    if (value === null) return BLANK;
    const months = evaluator.numberArg(node, 1, context, scope);
    if (!parseKey(String(value))) {
      throw evaluator.error(node.args[0], `EDATE cannot read "${String(value)}" as a date.`);
    }
    return addMonths(String(value), months);
  },

  EOMONTH: (evaluator, node, context, scope) => {
    const value = evaluator.scalarArg(node, 0, context, scope);
    if (value === null) return BLANK;
    const months = evaluator.numberArg(node, 1, context, scope);
    const result = endOfMonth(String(value), months);
    if (!result) {
      throw evaluator.error(node.args[0], `EOMONTH cannot read "${String(value)}" as a date.`);
    }
    return result;
  },

  WEEKNUM: (evaluator, node, context, scope) => {
    const value = evaluator.scalarArg(node, 0, context, scope);
    if (value === null) return BLANK;
    const returnType =
      node.args.length > 1 ? evaluator.numberArg(node, 1, context, scope) : 1;
    const week = weekNumber(String(value), returnType);
    if (week === null) {
      throw evaluator.error(
        node,
        `WEEKNUM cannot compute a week for "${String(value)}" with return type ${returnType}. ` +
          'Supported return types are 1 (weeks start Sunday), 2 (Monday) and 21 (ISO 8601).'
      );
    }
    return week;
  },
};

Object.assign(HANDLERS, STATISTICAL_HANDLERS);

/**
 * Every function the evaluator can actually execute.
 *
 * The registry declares `implemented` as static data - it cannot import this
 * module without a cycle - so a test compares the two. That check is the
 * whole reason for having one catalogue rather than two lists that drift.
 */
export const implementedFunctionNames = (): string[] => Object.keys(HANDLERS).sort();

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
