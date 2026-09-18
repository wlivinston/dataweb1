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

export class DaxRuntimeError extends DaxError {
  constructor(message: string, source: string, position: number, length = 1) {
    super(message, source, position, length);
    this.name = 'DaxRuntimeError';
  }
}
