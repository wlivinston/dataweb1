/**
 * DAX errors carry a source position so the UI can point at the offending
 * character rather than saying "invalid formula".
 *
 * This matters more than it looks. The evaluator this replaces matched
 * substrings - `formula.includes('SUM(')` - so an expression it did not
 * understand silently produced a plausible-looking number instead of an error.
 * Every failure path here is loud by construction.
 */
export class DaxError extends Error {
  /** 0-based offset into the source expression where the problem starts. */
  readonly position: number;
  /** Length of the offending span, for underlining. */
  readonly length: number;
  /** The expression the error came from. */
  readonly source: string;

  constructor(message: string, source: string, position: number, length = 1) {
    super(message);
    this.name = 'DaxError';
    this.source = source;
    this.position = Math.max(0, position);
    this.length = Math.max(1, length);
  }

  /**
   * A caret-underlined rendering of where the error is, for display in a
   * monospace context.
   *
   *   SUM(Sales[Amount]
   *                    ^ Expected ")" to close the call to SUM.
   */
  format(): string {
    const caretLine = ' '.repeat(this.position) + '^'.repeat(this.length);
    return `${this.source}\n${caretLine} ${this.message}`;
  }
}

export class DaxSyntaxError extends DaxError {
  constructor(message: string, source: string, position: number, length = 1) {
    super(message, source, position, length);
    this.name = 'DaxSyntaxError';
  }
}

/**
 * A failure during evaluation.
 *
 * Source and position are optional because the deepest helpers - value
 * coercion, cell reads - genuinely do not know which part of the expression
 * they are serving. The evaluator fills them in on the way out via
 * `locate`, so the message still reaches the UI with something to underline.
 */
export class DaxRuntimeError extends DaxError {
  /** False until a position has been attached. */
  readonly located: boolean;

  constructor(message: string, source = '', position = 0, length = 1) {
    super(message, source, position, length);
    this.name = 'DaxRuntimeError';
    this.located = source.length > 0;
  }
}

/**
 * Attach a source position to an error that was raised without one.
 *
 * An error that already knows where it came from is returned untouched, so
 * the innermost - and most specific - location wins.
 */
export const locate = (
  error: unknown,
  source: string,
  position: number,
  length: number
): unknown => {
  if (!(error instanceof DaxRuntimeError) || error.located) return error;
  return new DaxRuntimeError(error.message, source, position, length);
};
