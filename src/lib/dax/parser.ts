import { tokenize, type Token } from './tokenizer';
import { DaxSyntaxError } from './errors';
import type {
  Expression,
  BinaryOperator,
  VariableDeclaration,
} from './ast';

/**
 * Binding powers for DAX's binary operators, loosest first.
 *
 * DAX precedence, from loosest to tightest:
 *   ||  ->  &&  ->  comparison (= <> < > <= >=)  ->  &  ->  + -  ->  * /  ->  ^
 *
 * `^` is right-associative (2^3^2 is 2^9, not 8^2); everything else is left.
 */
const BINDING_POWER: Record<string, number> = {
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

const RIGHT_ASSOCIATIVE = new Set(['^']);

/** Unary minus binds tighter than * and / but looser than ^. */
const UNARY_BINDING_POWER = 6.5;

/**
 * Recursion is bounded so a pathological expression fails as a DaxSyntaxError
 * rather than a RangeError. Without this, deeply nested input blew the stack
 * and tryParseDax re-threw it, so the UI got an unhandled crash instead of a
 * message. 200 is far beyond any hand-written measure.
 */
const MAX_DEPTH = 200;

class Parser {
  private tokens: Token[];
  private pos = 0;
  private depth = 0;
  /**
   * Names currently bound by an enclosing VAR, innermost scope last.
   *
   * Without this a bare name after RETURN parsed as a table reference, so
   * `VAR Sales = 1 RETURN Sales` was indistinguishable from the table `Sales` -
   * the evaluator would silently read the table instead of the variable.
   */
  private scopes: Set<string>[] = [];

  constructor(private source: string) {
    this.tokens = tokenize(source);
  }

  private isVariableInScope(name: string): boolean {
    const lower = name.toLowerCase();
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(lower)) return true;
    }
    return false;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const token = this.peek();
    if (token.type !== 'eof') this.pos++;
    return token;
  }

  private error(message: string, token: Token = this.peek()): never {
    throw new DaxSyntaxError(message, this.source, token.start, Math.max(1, token.length));
  }

  private expectPunct(value: string, context: string): Token {
    const token = this.peek();
    if (token.type !== 'punct' || token.value !== value) {
      const found = token.type === 'eof' ? 'end of expression' : `"${token.value}"`;
      this.error(`Expected "${value}" ${context}, but found ${found}.`, token);
    }
    return this.next();
  }

  parse(): Expression {
    if (this.peek().type === 'eof') {
      throw new DaxSyntaxError('Expression is empty.', this.source, 0, 1);
    }

    const expression = this.parseExpression(0);

    const trailing = this.peek();
    if (trailing.type !== 'eof') {
      this.error(
        `Unexpected "${trailing.value}" after a complete expression. ` +
          `If you meant to combine two expressions, use an operator between them.`,
        trailing
      );
    }

    return expression;
  }

  /** Pratt loop: parse a prefix, then absorb infix operators while they bind tightly enough. */
  private parseExpression(minBindingPower: number): Expression {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      this.error(
        `Expression is nested too deeply (limit ${MAX_DEPTH}). This usually means unbalanced parentheses.`
      );
    }
    try {
      return this.parseExpressionInner(minBindingPower);
    } finally {
      this.depth--;
    }
  }

  private parseExpressionInner(minBindingPower: number): Expression {
    let left = this.parsePrefix();

    for (;;) {
      const token = this.peek();

      // `IN` is an infix keyword rather than an operator token.
      if (token.type === 'keyword' && token.value === 'IN' && 3 >= minBindingPower) {
        left = this.parseIn(left, false);
        continue;
      }
      if (
        token.type === 'keyword' &&
        token.value === 'NOT' &&
        this.peek(1).type === 'keyword' &&
        this.peek(1).value === 'IN' &&
        3 >= minBindingPower
      ) {
        this.next(); // consume NOT
        left = this.parseIn(left, true);
        continue;
      }

      if (token.type !== 'operator') break;

      const power = BINDING_POWER[token.value];
      if (power === undefined || power < minBindingPower) break;

      this.next();
      const nextMin = RIGHT_ASSOCIATIVE.has(token.value) ? power : power + 1;
      const right = this.parseExpression(nextMin);

      left = {
        kind: 'binary',
        operator: token.value as BinaryOperator,
        left,
        right,
        start: left.start,
        length: right.start + right.length - left.start,
      };
    }

    return left;
  }

  private parseIn(value: Expression, negated: boolean): Expression {
    const inToken = this.next(); // consume IN
    const candidates: Expression[] = [];

    // DAX writes the list as { a, b, c }. A parenthesised list and a bare
    // single value are both accepted too, since users reach for those.
    if (this.peek().type === 'punct' && this.peek().value === '{') {
      const table = this.parseTableConstructor();
      if (table.kind === 'tableConstructor') candidates.push(...table.rows);
      if (candidates.length === 0) {
        this.error('IN needs at least one value to compare against.', inToken);
      }
      return {
        kind: 'in',
        value,
        candidates,
        negated,
        start: value.start,
        length: table.start + table.length - value.start,
      };
    }

    if (this.peek().type === 'punct' && this.peek().value === '(') {
      this.next();
      if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
        candidates.push(this.parseExpression(0));
        while (this.peek().type === 'punct' && this.peek().value === ',') {
          this.next();
          candidates.push(this.parseExpression(0));
        }
      }
      this.expectPunct(')', 'to close the IN list');
    } else {
      candidates.push(this.parseExpression(4));
    }

    if (candidates.length === 0) {
      this.error('IN needs at least one value to compare against.', inToken);
    }

    const last = candidates[candidates.length - 1];
    return {
      kind: 'in',
      value,
      candidates,
      negated,
      start: value.start,
      length: last.start + last.length - value.start,
    };
  }

  private parseTableConstructor(): Expression {
    const open = this.next(); // consume "{"
    const rows: Expression[] = [];

    if (!(this.peek().type === 'punct' && this.peek().value === '}')) {
      rows.push(this.parseExpression(0));
      while (this.peek().type === 'punct' && this.peek().value === ',') {
        this.next();
        if (this.peek().type === 'punct' && this.peek().value === '}') {
          this.error('Trailing comma in the table constructor - remove it or add another value.', this.peek());
        }
        rows.push(this.parseExpression(0));
      }
    }

    const close = this.peek();
    if (!(close.type === 'punct' && close.value === '}')) {
      const found = close.type === 'eof' ? 'end of expression' : `"${close.value}"`;
      this.error(`Expected "}" to close the table constructor, but found ${found}.`, close);
    }
    this.next();

    return {
      kind: 'tableConstructor',
      rows,
      start: open.start,
      length: close.start + close.length - open.start,
    };
  }

  private parsePrefix(): Expression {
    const token = this.peek();

    switch (token.type) {
      case 'number': {
        this.next();
        const value = Number(token.value);
        if (!Number.isFinite(value)) {
          this.error(`"${token.value}" is not a valid number.`, token);
        }
        return { kind: 'number', value, start: token.start, length: token.length };
      }

      case 'string':
        this.next();
        return { kind: 'string', value: token.value, start: token.start, length: token.length };

      case 'bracket':
        this.next();
        // An unqualified [Name] could be a measure or a column in the current
        // table. The binder decides; the parser records it as a measure
        // reference because that is the common case in a measure expression.
        return { kind: 'measure', name: token.value, start: token.start, length: token.length };

      case 'keyword':
        return this.parseKeywordPrefix(token);

      case 'operator':
        if (token.value === '-' || token.value === '+') {
          this.next();
          const operand = this.parseExpression(UNARY_BINDING_POWER);
          return {
            kind: 'unary',
            operator: token.value,
            operand,
            start: token.start,
            length: operand.start + operand.length - token.start,
          };
        }
        this.error(
          `"${token.value}" cannot start an expression. It needs a value on its left.`,
          token
        );
        break;

      case 'punct':
        if (token.value === '{') {
          return this.parseTableConstructor();
        }
        if (token.value === '(') {
          this.next();
          const inner = this.parseExpression(0);
          this.expectPunct(')', 'to close the group');
          return inner;
        }
        this.error(`Unexpected "${token.value}".`, token);
        break;

      case 'identifier':
        return this.parseIdentifier(token);

      case 'eof':
        this.error('Expression ended unexpectedly - something is missing here.', token);
        break;
    }

    this.error(`Unexpected "${token.value}".`, token);
  }

  private parseKeywordPrefix(token: Token): Expression {
    switch (token.value) {
      case 'TRUE':
      case 'FALSE': {
        this.next();
        // DAX allows TRUE() and FALSE() as calls too.
        if (this.peek().type === 'punct' && this.peek().value === '(') {
          this.next();
          this.expectPunct(')', `to close ${token.value}()`);
        }
        return {
          kind: 'boolean',
          value: token.value === 'TRUE',
          start: token.start,
          length: token.length,
        };
      }

      case 'NOT': {
        this.next();
        const operand = this.parseExpression(2.5); // binds looser than comparison, tighter than &&
        return {
          kind: 'unary',
          operator: 'NOT',
          operand,
          start: token.start,
          length: operand.start + operand.length - token.start,
        };
      }

      case 'VAR':
        return this.parseLet();

      case 'RETURN':
        this.error('RETURN without a matching VAR.', token);
        break;

      case 'IN':
        this.error('IN needs a value on its left, for example: Sales[Region] IN ("Accra").', token);
        break;
    }

    this.error(`Unexpected keyword "${token.value}".`, token);
  }

  private parseLet(): Expression {
    const start = this.peek().start;
    const declarations: VariableDeclaration[] = [];

    // A VAR is visible to later VARs and to the RETURN body, but not to its own
    // initialiser, so each name is bound only after its value has been parsed.
    const scope = new Set<string>();
    this.scopes.push(scope);
    try {
      return this.parseLetBody(start, declarations, scope);
    } finally {
      this.scopes.pop();
    }
  }

  private parseLetBody(
    start: number,
    declarations: VariableDeclaration[],
    scope: Set<string>
  ): Expression {
    while (this.peek().type === 'keyword' && this.peek().value === 'VAR') {
      const varToken = this.next();
      const nameToken = this.peek();

      if (nameToken.type !== 'identifier') {
        this.error(
          'Expected a variable name after VAR, for example: VAR Total = SUM(Sales[Amount]).',
          nameToken
        );
      }
      this.next();

      const assign = this.peek();
      if (assign.type !== 'operator' || assign.value !== '=') {
        this.error(`Expected "=" after the variable name "${nameToken.value}".`, assign);
      }
      this.next();

      const value = this.parseExpression(0);
      scope.add(nameToken.value.toLowerCase());
      declarations.push({
        name: nameToken.value,
        value,
        start: varToken.start,
        length: value.start + value.length - varToken.start,
      });
    }

    const returnToken = this.peek();
    if (returnToken.type !== 'keyword' || returnToken.value !== 'RETURN') {
      const names = declarations.map(d => d.name).join(', ');
      this.error(
        `Expected RETURN after the variable ${declarations.length === 1 ? 'declaration' : 'declarations'} (${names}). ` +
          `A VAR block must end with RETURN <expression>.`,
        returnToken
      );
    }
    this.next();

    const body = this.parseExpression(0);

    return {
      kind: 'let',
      declarations,
      body,
      start,
      length: body.start + body.length - start,
    };
  }

  private parseIdentifier(token: Token): Expression {
    const following = this.peek(1);

    // Table[Column]
    if (following.type === 'bracket') {
      this.next();
      const bracket = this.next();
      return {
        kind: 'column',
        table: token.value,
        column: bracket.value,
        start: token.start,
        length: bracket.start + bracket.length - token.start,
      };
    }

    // FUNCTION(...)
    if (following.type === 'punct' && following.value === '(') {
      this.next();
      const open = this.next();
      const args: Expression[] = [];

      if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
        args.push(this.parseExpression(0));
        while (this.peek().type === 'punct' && this.peek().value === ',') {
          this.next();
          // A trailing comma before ")" is a common slip; name it precisely.
          if (this.peek().type === 'punct' && this.peek().value === ')') {
            this.error(
              `Trailing comma in the call to ${token.value.toUpperCase()} - remove it or add another argument.`,
              this.peek()
            );
          }
          args.push(this.parseExpression(0));
        }
      }

      const close = this.peek();
      if (!(close.type === 'punct' && close.value === ')')) {
        const found = close.type === 'eof' ? 'end of expression' : `"${close.value}"`;
        this.error(
          `Expected ")" to close the call to ${token.value.toUpperCase()}, but found ${found}.`,
          close.type === 'eof' ? { ...close, start: open.start, length: 1 } : close
        );
      }
      this.next();

      return {
        kind: 'call',
        name: token.value.toUpperCase(),
        args,
        nameStart: token.start,
        nameLength: token.length,
        start: token.start,
        length: close.start + close.length - token.start,
      };
    }

    // A bare name is a VAR reference when one is in scope, otherwise a table.
    // A variable shadows a same-named table, matching DAX, and resolving it
    // here means the evaluator can never mistake one for the other.
    this.next();
    if (this.isVariableInScope(token.value)) {
      return {
        kind: 'variable',
        name: token.value,
        start: token.start,
        length: token.length,
      };
    }
    return {
      kind: 'table',
      name: token.value,
      start: token.start,
      length: token.length,
    };
  }
}

/**
 * Parse a DAX expression into an AST.
 *
 * Throws DaxSyntaxError with a source position on anything malformed. It never
 * returns a partial or best-effort tree - an expression either parses or fails
 * loudly, which is the whole point of replacing the substring matcher.
 */
export const parseDax = (source: string): Expression => new Parser(source).parse();

/**
 * Parse without throwing, for UI that wants to show a message inline.
 */
export const tryParseDax = (
  source: string
): { ok: true; expression: Expression } | { ok: false; error: DaxSyntaxError } => {
  try {
    return { ok: true, expression: parseDax(source) };
  } catch (error) {
    if (error instanceof DaxSyntaxError) return { ok: false, error };
    throw error;
  }
};
