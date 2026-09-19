import { DaxSyntaxError } from './errors';

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'   // bare name: a function name, or a table name before [Column]
  | 'bracket'      // [Column] or [Measure] - the text inside the brackets
  | 'operator'
  | 'punct'        // ( ) , { }
  | 'keyword'      // VAR RETURN NOT IN TRUE FALSE
  | 'eof';

export interface Token {
  type: TokenType;
  /** Raw text for identifiers/operators; parsed value for numbers; inner text for brackets and strings. */
  value: string;
  /** 0-based offset of the first character. */
  start: number;
  /** Number of source characters the token spans, including quotes/brackets. */
  length: number;
}

/**
 * Words DAX treats structurally rather than as function names. Everything else
 * that looks like a bare word is an identifier, and the parser decides whether
 * it is a function call (followed by `(`) or a table name (followed by `[`).
 */
const KEYWORDS = new Set(['VAR', 'RETURN', 'NOT', 'IN', 'TRUE', 'FALSE']);

/**
 * Multi-character operators must be tested before single-character ones, and
 * longest-first within that, or `<=` would lex as `<` followed by `=`.
 */
const OPERATORS = ['<>', '<=', '>=', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '^', '&'];

/** Curly quotes, which a paste from Word, Confluence or a docs page carries in. */
const SMART_QUOTES = new Set(['“', '”', '‘', '’']);

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
// `.` is deliberately excluded. DAX has no dotted column syntax, and allowing
// it turned `Sales.Amount` into a single identifier - a phantom table name that
// would fail much later with a worse message. Numbers are lexed before
// identifiers, so `1.5` and `.5` are unaffected.
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);

/**
 * Whether the dot at `dotIndex` is part of a dotted FUNCTION name.
 *
 * Several DAX functions carry one - STDEV.P, VAR.S, PERCENTILE.INC, RANK.EQ -
 * so the dot cannot simply be rejected. It is absorbed only when a call
 * follows, which a column reference never has, so `Sales.Amount` still gets
 * the error it should.
 */
const dottedCallAhead = (source: string, dotIndex: number): boolean => {
  let j = dotIndex + 1;
  if (!isIdentStart(source[j] ?? '')) return false;
  while (j < source.length && isIdentPart(source[j])) j += 1;
  while (j < source.length && WHITESPACE.test(source[j])) j += 1;
  return source[j] === '(';
};

const WHITESPACE = /\s/;

/**
 * Turn a DAX expression into a token stream.
 *
 * Throws DaxSyntaxError with a source position on anything it cannot lex -
 * unterminated strings, unterminated brackets, stray characters. It never
 * silently skips input.
 */
export const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  const push = (type: TokenType, value: string, start: number, length: number) => {
    tokens.push({ type, value, start, length });
  };

  while (i < source.length) {
    const char = source[i];

    // --- whitespace ---
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // --- comments: -- to end of line, and /* ... */ ---
    if ((char === '-' && source[i + 1] === '-') || (char === '/' && source[i + 1] === '/')) {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      if (i >= source.length) {
        throw new DaxSyntaxError('Unterminated block comment.', source, start, 2);
      }
      i += 2;
      continue;
    }

    // --- numbers: 123, 1.5, .5, 1e-3 ---
    if (isDigit(char) || (char === '.' && isDigit(source[i + 1]))) {
      const start = i;
      while (i < source.length && isDigit(source[i])) i++;
      if (source[i] === '.') {
        i++;
        while (i < source.length && isDigit(source[i])) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const expStart = i;
        i++;
        if (source[i] === '+' || source[i] === '-') i++;
        if (!isDigit(source[i])) {
          // Not an exponent after all (e.g. `1e` or `2end`); rewind.
          i = expStart;
        } else {
          while (i < source.length && isDigit(source[i])) i++;
        }
      }
      push('number', source.slice(start, i), start, i - start);
      continue;
    }

    // --- strings: "text", with "" as an escaped quote ---
    if (char === '"') {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += source[i];
        i++;
      }
      if (!closed) {
        throw new DaxSyntaxError('Unterminated text literal - missing a closing quote.', source, start, 1);
      }
      push('string', value, start, i - start);
      continue;
    }

    // --- bracketed name: [Column] or [Measure Name] ---
    if (char === '[') {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        if (source[i] === ']') {
          // `]]` is an escaped close bracket inside a name.
          if (source[i + 1] === ']') {
            value += ']';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += source[i];
        i++;
      }
      if (!closed) {
        throw new DaxSyntaxError('Unterminated column or measure name - missing "]".', source, start, 1);
      }
      if (value.length === 0) {
        throw new DaxSyntaxError('Empty column or measure name: "[]".', source, start, i - start);
      }
      push('bracket', value, start, i - start);
      continue;
    }

    // --- quoted table name: 'Sales Data'[Amount] ---
    if (char === "'") {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += source[i];
        i++;
      }
      if (!closed) {
        throw new DaxSyntaxError("Unterminated table name - missing a closing apostrophe.", source, start, 1);
      }
      push('identifier', value, start, i - start);
      continue;
    }

    // --- identifiers and keywords ---
    if (isIdentStart(char)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i])) i++;

      // Absorb a dotted function name such as PERCENTILE.INC, but only when
      // the dotted form is actually being called.
      while (source[i] === '.' && dottedCallAhead(source, i)) {
        i += 1;
        while (i < source.length && isIdentPart(source[i])) i++;
      }

      const text = source.slice(start, i);
      const upper = text.toUpperCase();
      push(KEYWORDS.has(upper) ? 'keyword' : 'identifier', KEYWORDS.has(upper) ? upper : text, start, i - start);
      continue;
    }

    // --- punctuation ---
    if (char === '(' || char === ')' || char === ',' || char === '{' || char === '}') {
      push('punct', char, i, 1);
      i++;
      continue;
    }

    // --- operators ---
    const op = OPERATORS.find(candidate => source.startsWith(candidate, i));
    if (op) {
      push('operator', op, i, op.length);
      i += op.length;
      continue;
    }

    if (SMART_QUOTES.has(char)) {
      const straight = char === '‘' || char === '’' ? "'" : '"';
      throw new DaxSyntaxError(
        `Found a curly quote (${char}) - replace it with a straight ${straight}. ` +
          `Text pasted from a document or web page often carries these.`,
        source,
        i,
        1
      );
    }

    if (char === '.') {
      throw new DaxSyntaxError(
        'Unexpected ".". DAX refers to a column as Table[Column], not Table.Column.',
        source,
        i,
        1
      );
    }

    throw new DaxSyntaxError(`Unexpected character "${char}".`, source, i, 1);
  }

  push('eof', '', source.length, 0);
  return tokens;
};
