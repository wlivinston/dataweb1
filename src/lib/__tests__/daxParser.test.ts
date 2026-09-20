import { describe, it, expect } from 'vitest';
import { tokenize } from '../dax/tokenizer';
import { parseDax, tryParseDax } from '../dax/parser';
import { printDax } from '../dax/printer';
import { collectFunctionNames, collectColumnRefs } from '../dax/ast';
import { DaxSyntaxError } from '../dax/errors';
import type { Expression } from '../dax/ast';

/**
 * Render an AST as a compact s-expression so precedence and associativity can
 * be asserted structurally rather than by poking at nested properties.
 */
const sexp = (node: Expression): string => {
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'string':
      return JSON.stringify(node.value);
    case 'boolean':
      return node.value ? 'TRUE' : 'FALSE';
    case 'column':
      return node.table ? `${node.table}[${node.column}]` : `[${node.column}]`;
    case 'measure':
      return `[${node.name}]`;
    case 'table':
      return node.name;
    case 'call':
      return `(${node.name}${node.args.map(a => ' ' + sexp(a)).join('')})`;
    case 'unary':
      return `(${node.operator} ${sexp(node.operand)})`;
    case 'binary':
      return `(${node.operator} ${sexp(node.left)} ${sexp(node.right)})`;
    case 'in':
      return `(${node.negated ? 'NOT-IN' : 'IN'} ${sexp(node.value)} ${node.candidates.map(sexp).join(' ')})`;
    case 'variable':
      return `$${node.name}`;
    case 'tableConstructor':
      return `{${node.rows.map(sexp).join(' ')}}`;
    case 'let':
      return `(LET ${node.declarations.map(d => `[${d.name}=${sexp(d.value)}]`).join(' ')} ${sexp(node.body)})`;
  }
};

describe('Tokenizer', () => {
  it('lexes numbers including decimals and exponents', () => {
    const types = tokenize('1 2.5 .75 1e3 1.5e-2').filter(t => t.type === 'number').map(t => t.value);
    expect(types).toEqual(['1', '2.5', '.75', '1e3', '1.5e-2']);
  });

  it('does not treat a trailing e as an exponent', () => {
    const tokens = tokenize('1e').filter(t => t.type !== 'eof');
    expect(tokens.map(t => `${t.type}:${t.value}`)).toEqual(['number:1', 'identifier:e']);
  });

  it('lexes text literals and unescapes doubled quotes', () => {
    const [token] = tokenize('"he said ""hi"""');
    expect(token.type).toBe('string');
    expect(token.value).toBe('he said "hi"');
  });

  it('lexes bracketed names and unescapes doubled brackets', () => {
    const [token] = tokenize('[Sales ]] Total]');
    expect(token.type).toBe('bracket');
    expect(token.value).toBe('Sales ] Total');
  });

  it('lexes quoted table names', () => {
    const tokens = tokenize("'Sales Data'[Amount]").filter(t => t.type !== 'eof');
    expect(tokens.map(t => `${t.type}:${t.value}`)).toEqual([
      'identifier:Sales Data',
      'bracket:Amount',
    ]);
  });

  it('prefers the longest operator', () => {
    const ops = tokenize('a <= b <> c && d').filter(t => t.type === 'operator').map(t => t.value);
    expect(ops).toEqual(['<=', '<>', '&&']);
  });

  it('skips line and block comments', () => {
    const tokens = tokenize('1 -- a comment\n + /* another */ 2').filter(t => t.type !== 'eof');
    expect(tokens.map(t => t.value)).toEqual(['1', '+', '2']);
  });

  it('records source positions', () => {
    const tokens = tokenize('SUM(Sales[Amount])');
    expect(tokens[0]).toMatchObject({ value: 'SUM', start: 0, length: 3 });
    expect(tokens[2]).toMatchObject({ value: 'Sales', start: 4, length: 5 });
  });

  it('rejects an unterminated text literal with a position', () => {
    try {
      tokenize('CONCAT("abc)');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DaxSyntaxError);
      expect((e as DaxSyntaxError).message).toContain('Unterminated text literal');
      expect((e as DaxSyntaxError).position).toBe(7);
    }
  });

  it('rejects an unterminated bracket', () => {
    expect(() => tokenize('Sales[Amount')).toThrow(/Unterminated column or measure name/);
  });

  it('rejects an empty bracket', () => {
    expect(() => tokenize('Sales[]')).toThrow(/Empty column or measure name/);
  });

  it('rejects a stray character', () => {
    expect(() => tokenize('1 # 2')).toThrow(/Unexpected character "#"/);
  });
});

describe('Parser: literals and references', () => {
  it('parses a qualified column reference', () => {
    expect(sexp(parseDax('Sales[Amount]'))).toBe('Sales[Amount]');
  });

  it('parses a quoted table name', () => {
    expect(sexp(parseDax("'Sales Data'[Amount]"))).toBe('Sales Data[Amount]');
  });

  it('parses an unqualified name as a measure reference', () => {
    expect(sexp(parseDax('[Total Revenue]'))).toBe('[Total Revenue]');
  });

  it('parses a bare name as a table reference', () => {
    expect(sexp(parseDax('COUNTROWS(Sales)'))).toBe('(COUNTROWS Sales)');
  });

  it('parses booleans in both bare and call form', () => {
    expect(sexp(parseDax('TRUE'))).toBe('TRUE');
    expect(sexp(parseDax('TRUE()'))).toBe('TRUE');
    expect(sexp(parseDax('FALSE()'))).toBe('FALSE');
  });
});

describe('Parser: operator precedence', () => {
  const cases: Array<[string, string]> = [
    // multiplication binds tighter than addition
    ['1 + 2 * 3', '(+ 1 (* 2 3))'],
    ['1 * 2 + 3', '(+ (* 1 2) 3)'],
    // left associativity for same-precedence operators
    ['10 - 4 - 3', '(- (- 10 4) 3)'],
    ['100 / 5 / 2', '(/ (/ 100 5) 2)'],
    // exponent binds tightest and is right-associative
    ['2 ^ 3 ^ 2', '(^ 2 (^ 3 2))'],
    ['2 * 3 ^ 2', '(* 2 (^ 3 2))'],
    // concatenation is looser than arithmetic
    ['1 + 2 & "x"', '(& (+ 1 2) "x")'],
    // comparison is looser than concatenation
    ['"a" & "b" = "ab"', '(= (& "a" "b") "ab")'],
    // && binds tighter than ||
    ['a || b && c', '(|| a (&& b c))'],
    // comparison binds tighter than &&
    ['1 < 2 && 3 > 2', '(&& (< 1 2) (> 3 2))'],
    // parentheses override
    ['(1 + 2) * 3', '(* (+ 1 2) 3)'],
  ];

  for (const [input, expected] of cases) {
    it(`parses ${input}`, () => {
      expect(sexp(parseDax(input))).toBe(expected);
    });
  }

  it('binds unary minus tighter than multiplication but looser than exponent', () => {
    expect(sexp(parseDax('-2 * 3'))).toBe('(* (- 2) 3)');
    expect(sexp(parseDax('-2 ^ 2'))).toBe('(- (^ 2 2))');
  });

  it('handles repeated unary operators when separated', () => {
    // `--` with no space is DAX's line-comment marker, not double negation,
    // so a space is required to express "negate a negative".
    expect(sexp(parseDax('- -5'))).toBe('(- (- 5))');
  });

  it('treats -- as a comment, matching DAX rather than double negation', () => {
    expect(() => parseDax('--5')).toThrow(/Expression is empty/);
    expect(sexp(parseDax('1 + 2 -- 3 is ignored'))).toBe('(+ 1 2)');
  });
});

describe('Parser: function calls', () => {
  it('parses a call with no arguments', () => {
    expect(sexp(parseDax('BLANK()'))).toBe('(BLANK)');
  });

  it('parses nested calls', () => {
    expect(sexp(parseDax('DIVIDE(SUM(Sales[Amount]), COUNTROWS(Sales))'))).toBe(
      '(DIVIDE (SUM Sales[Amount]) (COUNTROWS Sales))'
    );
  });

  it('upper-cases function names so casing does not matter', () => {
    expect(sexp(parseDax('sum(Sales[Amount])'))).toBe('(SUM Sales[Amount])');
    expect(sexp(parseDax('Calculate(1)'))).toBe('(CALCULATE 1)');
  });

  it('parses CALCULATE with a filter predicate', () => {
    expect(sexp(parseDax('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Accra")'))).toBe(
      '(CALCULATE (SUM Sales[Amount]) (= Sales[Region] "Accra"))'
    );
  });

  it('parses FILTER over a table with a compound predicate', () => {
    expect(
      sexp(parseDax('FILTER(Sales, Sales[Amount] > 100 && Sales[Region] = "Accra")'))
    ).toBe('(FILTER Sales (&& (> Sales[Amount] 100) (= Sales[Region] "Accra")))');
  });

  it('parses ALLEXCEPT with several columns', () => {
    expect(sexp(parseDax('ALLEXCEPT(Sales, Sales[Region], Sales[Year])'))).toBe(
      '(ALLEXCEPT Sales Sales[Region] Sales[Year])'
    );
  });
});

describe('Parser: IN', () => {
  it('parses a parenthesised candidate list', () => {
    expect(sexp(parseDax('Sales[Region] IN ("Accra", "Kumasi")'))).toBe(
      '(IN Sales[Region] "Accra" "Kumasi")'
    );
  });

  it('parses NOT IN', () => {
    expect(sexp(parseDax('Sales[Region] NOT IN ("Accra")'))).toBe(
      '(NOT-IN Sales[Region] "Accra")'
    );
  });

  it('combines with boolean operators at the right precedence', () => {
    expect(sexp(parseDax('Sales[Region] IN ("Accra") && Sales[Amount] > 0'))).toBe(
      '(&& (IN Sales[Region] "Accra") (> Sales[Amount] 0))'
    );
  });
});

describe('Parser: VAR / RETURN', () => {
  it('parses a single variable', () => {
    expect(sexp(parseDax('VAR Total = SUM(Sales[Amount]) RETURN Total'))).toBe(
      '(LET [Total=(SUM Sales[Amount])] $Total)'
    );
  });

  it('parses several variables', () => {
    const src = `
      VAR Curr = SUM(Sales[Amount])
      VAR Prior = CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Dates[Date]))
      RETURN DIVIDE(Curr - Prior, Prior)
    `;
    expect(sexp(parseDax(src))).toBe(
      '(LET [Curr=(SUM Sales[Amount])] [Prior=(CALCULATE (SUM Sales[Amount]) (SAMEPERIODLASTYEAR Dates[Date]))] (DIVIDE (- $Curr $Prior) $Prior))'
    );
  });

  it('rejects a VAR block with no RETURN', () => {
    expect(() => parseDax('VAR x = 1')).toThrow(/Expected RETURN after the variable declaration \(x\)/);
  });

  it('rejects RETURN without VAR', () => {
    expect(() => parseDax('RETURN 1')).toThrow(/RETURN without a matching VAR/);
  });

  it('rejects a missing equals sign', () => {
    expect(() => parseDax('VAR x 1 RETURN x')).toThrow(/Expected "=" after the variable name "x"/);
  });
});

describe('Parser: errors are loud and located', () => {
  it('rejects an empty expression', () => {
    expect(() => parseDax('')).toThrow(/Expression is empty/);
    expect(() => parseDax('   ')).toThrow(/Expression is empty/);
  });

  it('reports an unclosed call by name', () => {
    expect(() => parseDax('SUM(Sales[Amount]')).toThrow(
      /Expected "\)" to close the call to SUM/
    );
  });

  it('reports a trailing comma precisely', () => {
    expect(() => parseDax('DIVIDE(1, 2,)')).toThrow(/Trailing comma in the call to DIVIDE/);
  });

  it('rejects two expressions with no operator between them', () => {
    expect(() => parseDax('SUM(Sales[Amount]) SUM(Sales[Cost])')).toThrow(
      /Unexpected "SUM" after a complete expression/
    );
  });

  it('rejects a dangling operator', () => {
    expect(() => parseDax('1 +')).toThrow(/Expression ended unexpectedly/);
  });

  it('rejects an operator with nothing on its left', () => {
    expect(() => parseDax('* 2')).toThrow(/"\*" cannot start an expression/);
  });

  it('rejects unbalanced closing parenthesis', () => {
    expect(() => parseDax('(1 + 2))')).toThrow(/Unexpected "\)" after a complete expression/);
  });

  it('points at the offending position', () => {
    try {
      parseDax('SUM(Sales[Amount]) + * 3');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as DaxSyntaxError;
      expect(err).toBeInstanceOf(DaxSyntaxError);
      expect(err.position).toBe(21); // the "*"
      expect(err.format()).toContain('^');
    }
  });

  /**
   * The behaviour this whole module exists to fix. The previous evaluator
   * matched `formula.includes('SUM(')`, so it answered these with a plain
   * unfiltered SUM instead of refusing.
   */
  it('does not quietly accept expressions the old substring matcher mishandled', () => {
    // Parses correctly rather than collapsing to SUM.
    expect(sexp(parseDax('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Accra")'))).toContain(
      'CALCULATE'
    );
    expect(sexp(parseDax('SUM(Sales[A]) - SUM(Sales[B])'))).toBe(
      '(- (SUM Sales[A]) (SUM Sales[B]))'
    );
    // And genuinely broken input is an error, not a number.
    expect(() => parseDax('SUM(Sales[Amount]')).toThrow();
    expect(() => parseDax('SUM Sales[Amount])')).toThrow();
  });
});

describe('tryParseDax', () => {
  it('returns the expression on success', () => {
    const result = tryParseDax('1 + 1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(sexp(result.expression)).toBe('(+ 1 1)');
  });

  it('returns the error rather than throwing', () => {
    const result = tryParseDax('1 +');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DaxSyntaxError);
      expect(result.error.format()).toContain('^');
    }
  });
});

describe('AST analysis helpers', () => {
  const expr = parseDax(`
    VAR Curr = CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Accra")
    VAR Prior = CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Dates[Date]))
    RETURN DIVIDE(Curr - Prior, Prior)
  `);

  it('collects every function name in the tree', () => {
    expect(collectFunctionNames(expr).sort()).toEqual([
      'CALCULATE',
      'CALCULATE',
      'DIVIDE',
      'SAMEPERIODLASTYEAR',
      'SUM',
      'SUM',
    ]);
  });

  it('collects every column reference in the tree', () => {
    const refs = collectColumnRefs(expr).map(r => `${r.table}[${r.column}]`);
    expect(refs.sort()).toEqual([
      'Dates[Date]',
      'Sales[Amount]',
      'Sales[Amount]',
      'Sales[Region]',
    ]);
  });
});

describe('Parser: table constructors', () => {
  it('parses a brace list, which is how DAX writes IN', () => {
    expect(sexp(parseDax('Sales[Region] IN {"Accra", "Kumasi"}'))).toBe(
      '(IN Sales[Region] "Accra" "Kumasi")'
    );
  });

  it('parses an expression copied verbatim out of Power BI', () => {
    expect(
      sexp(parseDax('CALCULATE(SUM(Sales[Amount]), Sales[Year] IN {2023, 2024})'))
    ).toBe('(CALCULATE (SUM Sales[Amount]) (IN Sales[Year] 2023 2024))');
  });

  it('parses a standalone table constructor', () => {
    expect(sexp(parseDax('{1, 2, 3}'))).toBe('{1 2 3}');
  });

  it('parses an empty table constructor', () => {
    expect(sexp(parseDax('{}'))).toBe('{}');
  });

  it('parses NOT IN with braces', () => {
    expect(sexp(parseDax('Sales[Region] NOT IN {"Accra"}'))).toBe(
      '(NOT-IN Sales[Region] "Accra")'
    );
  });

  it('reports an unclosed constructor', () => {
    expect(() => parseDax('a IN {1, 2')).toThrow(/Expected "}" to close the table constructor/);
  });

  it('reports a trailing comma in a constructor', () => {
    expect(() => parseDax('{1, 2,}')).toThrow(/Trailing comma in the table constructor/);
  });

  it('rejects an empty brace list after IN', () => {
    expect(() => parseDax('a IN {}')).toThrow(/IN needs at least one value/);
  });
});

describe('Parser: variable scope', () => {
  const declOf = (src: string) => parseDax(src);

  it('resolves a RETURN reference to the variable, not a table', () => {
    expect(sexp(declOf('VAR Total = 1 RETURN Total'))).toBe('(LET [Total=1] $Total)');
  });

  it('lets a variable shadow a table of the same name', () => {
    // Without scope tracking this parsed as the table `Sales`, so the evaluator
    // would have read the table and silently returned the wrong number.
    expect(sexp(declOf('VAR Sales = 1 RETURN Sales'))).toBe('(LET [Sales=1] $Sales)');
  });

  it('makes a variable visible to later variables', () => {
    expect(sexp(declOf('VAR a = 1 VAR b = a + 1 RETURN b'))).toBe(
      '(LET [a=1] [b=(+ $a 1)] $b)'
    );
  });

  it('does not make a variable visible inside its own initialiser', () => {
    // `x` on the right-hand side refers to a table, not to the variable being
    // declared - a self-reference is not a cycle, it is a different thing.
    expect(sexp(declOf('VAR x = COUNTROWS(x) RETURN x'))).toBe(
      '(LET [x=(COUNTROWS x)] $x)'
    );
  });

  it('is case-insensitive, as DAX identifiers are', () => {
    expect(sexp(declOf('VAR Total = 1 RETURN TOTAL'))).toBe('(LET [Total=1] $TOTAL)');
  });

  it('closes the scope when the VAR block ends', () => {
    // The inner `x` is out of scope in the outer RETURN, so it is a table there.
    const src = 'VAR outer = (VAR x = 1 RETURN x) RETURN outer + COUNTROWS(x)';
    expect(sexp(declOf(src))).toBe(
      '(LET [outer=(LET [x=1] $x)] (+ $outer (COUNTROWS x)))'
    );
  });

  it('still treats an unbound bare name as a table reference', () => {
    expect(sexp(parseDax('COUNTROWS(Sales)'))).toBe('(COUNTROWS Sales)');
  });
});

describe('Parser: recursion limit', () => {
  it('fails deep nesting as a syntax error rather than a stack overflow', () => {
    const deep = '('.repeat(5000) + '1' + ')'.repeat(5000);
    // A RangeError here would escape tryParseDax and crash the caller.
    expect(() => parseDax(deep)).toThrow(DaxSyntaxError);
    expect(() => parseDax(deep)).toThrow(/nested too deeply/);
  });

  it('keeps tryParseDax total even on pathological input', () => {
    const result = tryParseDax('('.repeat(5000) + '1' + ')'.repeat(5000));
    expect(result.ok).toBe(false);
  });

  it('still accepts nesting depth a real measure could reach', () => {
    const nested = '('.repeat(50) + '1 + 1' + ')'.repeat(50);
    expect(sexp(parseDax(nested))).toBe('(+ 1 1)');
  });
});

describe('Tokenizer: real-world paste hazards', () => {
  it('accepts // line comments, which are valid DAX alongside --', () => {
    expect(sexp(parseDax('SUM(Sales[Amount]) // running total\n + 1'))).toBe(
      '(+ (SUM Sales[Amount]) 1)'
    );
  });

  it('names curly quotes rather than calling them an unexpected character', () => {
    expect(() => parseDax('Sales[Region] = “Accra”')).toThrow(/curly quote/);
    expect(() => parseDax('Sales[Region] = “Accra”')).toThrow(/straight "/);
    expect(() => parseDax('‘Sales Data’[Amount]')).toThrow(/straight '/);
  });

  it('rejects dotted column syntax instead of inventing a table name', () => {
    // Previously this lexed as one identifier, producing a phantom table called
    // "Sales.Amount" that would only fail much later, with a worse message.
    expect(() => parseDax('Sales.Amount')).toThrow(/not Table\.Column/);
  });

  it('still lexes numbers containing a decimal point', () => {
    expect(sexp(parseDax('1.5 + .25'))).toBe('(+ 1.5 0.25)');
  });

  it('tolerates non-breaking spaces from a paste', () => {
    expect(sexp(parseDax('SUM(Sales[Amount]) + 1'))).toBe('(+ (SUM Sales[Amount]) 1)');
  });

  it('names an empty argument precisely', () => {
    expect(() => parseDax('IF(TRUE,,1)')).toThrow(/Empty argument in the call to IF/);
  });

  it('accepts lowercase keywords', () => {
    expect(sexp(parseDax('var x = 1 return x'))).toBe('(LET [x=1] $x)');
  });
});

describe('Printer', () => {
  it('renders a simple call', () => {
    expect(printDax(parseDax('sum( Sales[Amount] )'))).toBe('SUM(Sales[Amount])');
  });

  it('quotes a table name only when it needs quoting', () => {
    expect(printDax(parseDax('Sales[Amount]'))).toBe('Sales[Amount]');
    expect(printDax(parseDax("'Sales Data'[Amount]"))).toBe("'Sales Data'[Amount]");
  });

  it('omits parentheses that precedence makes redundant', () => {
    expect(printDax(parseDax('1 + (2 * 3)'))).toBe('1 + 2 * 3');
  });

  it('keeps parentheses that precedence requires', () => {
    expect(printDax(parseDax('(1 + 2) * 3'))).toBe('(1 + 2) * 3');
  });

  it('keeps parentheses that associativity requires', () => {
    // Dropping these would change the value.
    expect(printDax(parseDax('10 - (4 - 3)'))).toBe('10 - (4 - 3)');
    expect(printDax(parseDax('100 / (5 / 2)'))).toBe('100 / (5 / 2)');
    expect(printDax(parseDax('(2 ^ 3) ^ 2'))).toBe('(2 ^ 3) ^ 2');
    expect(printDax(parseDax('2 ^ 3 ^ 2'))).toBe('2 ^ 3 ^ 2');
  });

  it('separates a negated negative so -- does not become a comment', () => {
    const printed = printDax(parseDax('- -5'));
    expect(printed).toBe('- -5');
    // The dangerous version would re-parse as an empty expression.
    expect(sexp(parseDax(printed))).toBe('(- (- 5))');
  });

  it('renders IN with braces, as DAX writes it', () => {
    expect(printDax(parseDax('Sales[Region] IN ("Accra", "Kumasi")'))).toBe(
      'Sales[Region] IN {"Accra", "Kumasi"}'
    );
  });

  it('renders a VAR block over multiple lines', () => {
    expect(printDax(parseDax('VAR a = 1 VAR b = 2 RETURN a + b'))).toBe(
      'VAR a = 1\nVAR b = 2\nRETURN a + b'
    );
  });

  it('escapes quotes and brackets it emits', () => {
    expect(printDax(parseDax('"he said ""hi"""'))).toBe('"he said ""hi"""');
    expect(printDax(parseDax('[Sales ]] Total]'))).toBe('[Sales ]] Total]');
  });
});

describe('Round trip: parse -> print -> parse', () => {
  /**
   * The strongest check available on the parser. If precedence is wrong in
   * either the parser or the printer, the second parse produces a different
   * tree - which a hand-written expectation could easily agree with by mistake,
   * since I wrote both.
   */
  const expressions = [
    '1',
    '-5',
    '- -5',
    'TRUE',
    '"text"',
    'Sales[Amount]',
    "'Sales Data'[Amount]",
    '[Total Revenue]',
    'SUM(Sales[Amount])',
    'DIVIDE(SUM(Sales[Amount]), COUNTROWS(Sales))',
    '1 + 2 * 3',
    '(1 + 2) * 3',
    '10 - 4 - 3',
    '10 - (4 - 3)',
    '100 / 5 / 2',
    '100 / (5 / 2)',
    '2 ^ 3 ^ 2',
    '(2 ^ 3) ^ 2',
    '-2 ^ 2',
    '-2 * 3',
    '1 + 2 & "x"',
    '"a" & "b" = "ab"',
    '1 < 2 && 3 > 2',
    'a || b && c',
    '(a || b) && c',
    'NOT TRUE && FALSE',
    'NOT (TRUE && FALSE)',
    'Sales[Region] IN {"Accra", "Kumasi"}',
    'Sales[Region] NOT IN {"Accra"}',
    'Sales[Region] IN {"Accra"} && Sales[Amount] > 0',
    '{1, 2, 3}',
    'CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Accra")',
    'FILTER(Sales, Sales[Amount] > 100 && Sales[Region] = "Accra")',
    'ALLEXCEPT(Sales, Sales[Region], Sales[Year])',
    'VAR Total = SUM(Sales[Amount]) RETURN Total',
    'VAR a = 1 VAR b = a + 1 RETURN b * 2',
    'VAR Curr = SUM(Sales[Amount]) VAR Prior = CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Dates[Date])) RETURN DIVIDE(Curr - Prior, Prior)',
    'IF(SUM(Sales[Amount]) > 1000, "high", "low")',
    'SUMX(Sales, Sales[Qty] * Sales[Price])',
    'RANKX(ALL(Sales[Rep]), [Total Revenue])',
    'DIVIDE(CALCULATE(SUM(Sales[Amount]), ALL(Sales)) - SUM(Sales[Amount]), 2)',
  ];

  for (const source of expressions) {
    const label = source.length > 52 ? source.slice(0, 52) + '...' : source;
    it(`round-trips ${label}`, () => {
      const first = parseDax(source);
      const printed = printDax(first);
      const second = parseDax(printed);

      // Structural equality, ignoring source positions which legitimately move.
      expect(sexp(second)).toBe(sexp(first));
      // Printing is idempotent, so the normalised form is stable.
      expect(printDax(second)).toBe(printed);
    });
  }
});
