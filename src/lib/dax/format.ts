import { parseKey } from './time';

/**
 * A subset of DAX's FORMAT.
 *
 * DAX FORMAT accepts the whole VBA format language and resolves named
 * formats against the workbook locale. Reproducing that faithfully is not
 * realistic, and half-reproducing it would mean a format string that works
 * in Power BI quietly producing something different here.
 *
 * So this supports a documented set of patterns and refuses everything else
 * by name. In particular "Currency" is refused rather than guessed: the model
 * carries no currency, and a figure rendered with the wrong symbol is worse
 * than an error. Literal characters around the pattern are kept, so
 * "GHS #,##0.00" gives what "Currency" would have been asked for.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Named numeric formats, mapped to the pattern they stand for. */
const NAMED_NUMERIC: Record<string, string> = {
  'general number': '0.##########',
  fixed: '0.00',
  standard: '#,##0.00',
  percent: '0.00%',
};

const NAMED_DATE: Record<string, string> = {
  'short date': 'yyyy-mm-dd',
  'long date': 'dddd, d mmmm yyyy',
  'general date': 'yyyy-mm-dd',
};

export class DaxFormatError extends Error {}

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

interface NumericPattern {
  prefix: string;
  suffix: string;
  decimals: number;
  /** Decimals that are dropped when zero, as the # placeholder does. */
  optionalDecimals: number;
  thousands: boolean;
  percent: boolean;
  minIntegerDigits: number;
}

const parseNumericPattern = (pattern: string): NumericPattern | null => {
  const match = /^([^#0]*)([#,0]+(?:\.[0#]+)?)([^#0]*)$/.exec(pattern);
  if (!match) return null;

  const [, prefix, core, suffix] = match;
  const [integerPart, decimalPart = ''] = core.split('.');

  return {
    prefix,
    suffix,
    decimals: (decimalPart.match(/0/g) ?? []).length,
    optionalDecimals: (decimalPart.match(/#/g) ?? []).length,
    thousands: integerPart.includes(','),
    percent: prefix.includes('%') || suffix.includes('%'),
    minIntegerDigits: Math.max(1, (integerPart.match(/0/g) ?? []).length),
  };
};

const formatNumeric = (value: number, pattern: NumericPattern): string => {
  const scaled = pattern.percent ? value * 100 : value;
  const maxDecimals = pattern.decimals + pattern.optionalDecimals;

  let text = Math.abs(scaled).toFixed(maxDecimals);

  if (pattern.optionalDecimals > 0 && text.includes('.')) {
    // Trim optional places, but never below the required ones.
    text = text.replace(/0+$/, '');
    const [whole, fraction = ''] = text.split('.');
    const kept = fraction.slice(0, maxDecimals).padEnd(pattern.decimals, '0');
    text = kept.length > 0 ? `${whole}.${kept}` : whole;
  }

  const [rawWhole, fraction] = text.split('.');
  let whole = rawWhole;
  whole = whole.padStart(pattern.minIntegerDigits, '0');
  if (pattern.thousands) whole = groupThousands(whole);

  const body = fraction ? `${whole}.${fraction}` : whole;
  const sign = scaled < 0 ? '-' : '';
  return `${sign}${pattern.prefix}${body}${pattern.suffix}`;
};

/** Date tokens, longest first so mmmm is not eaten by mm. */
const DATE_TOKENS: [RegExp, (parts: { year: number; month: number; day: number }, weekday: number) => string][] = [
  [/dddd/, (_, weekday) => DAY_NAMES[weekday]],
  [/ddd/, (_, weekday) => DAY_NAMES[weekday].slice(0, 3)],
  [/mmmm/, parts => MONTH_NAMES[parts.month - 1]],
  [/mmm/, parts => MONTH_NAMES[parts.month - 1].slice(0, 3)],
  [/yyyy/, parts => String(parts.year)],
  [/yy/, parts => String(parts.year).slice(-2)],
  [/dd/, parts => String(parts.day).padStart(2, '0')],
  [/mm/, parts => String(parts.month).padStart(2, '0')],
  [/d/, parts => String(parts.day)],
  [/m/, parts => String(parts.month)],
];

const looksLikeDatePattern = (pattern: string): boolean =>
  /[dmy]/.test(pattern) && !/[#0]/.test(pattern);

const formatDate = (iso: string, pattern: string): string => {
  const parts = parseKey(iso);
  if (!parts) {
    throw new DaxFormatError(`FORMAT cannot read "${iso}" as a date.`);
  }
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();

  // Replace token by token so a substituted month name cannot be re-matched.
  let result = '';
  let rest = pattern;
  outer: while (rest.length > 0) {
    for (const [token, render] of DATE_TOKENS) {
      const anchored = new RegExp(`^${token.source}`);
      if (anchored.test(rest)) {
        result += render(parts, weekday);
        rest = rest.slice(anchored.exec(rest)![0].length);
        continue outer;
      }
    }
    result += rest[0];
    rest = rest.slice(1);
  }
  return result;
};

/**
 * Apply a DAX format string.
 *
 * Throws DaxFormatError for anything outside the supported set, naming what
 * is supported, rather than returning something that looks plausible.
 */
export const applyDaxFormat = (value: string | number | boolean, pattern: string): string => {
  const trimmed = pattern.trim();
  const named = trimmed.toLowerCase();

  if (named === 'currency') {
    throw new DaxFormatError(
      'FORMAT does not support "Currency", because the model carries no currency ' +
        'and the wrong symbol is worse than no answer. Write the symbol into the ' +
        'pattern instead, for example "GHS #,##0.00".'
    );
  }

  if (NAMED_DATE[named]) return formatDate(String(value), NAMED_DATE[named]);

  const numericPattern = NAMED_NUMERIC[named] ?? trimmed;

  if (looksLikeDatePattern(numericPattern)) {
    return formatDate(String(value), numericPattern);
  }

  const parsed = parseNumericPattern(numericPattern);
  if (!parsed) {
    throw new DaxFormatError(
      `FORMAT does not understand the pattern "${pattern}". Supported: number ` +
        'patterns built from # 0 , . and %, date patterns built from d m y, and the ' +
        'names General Number, Fixed, Standard, Percent, Short Date and Long Date.'
    );
  }

  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) {
    throw new DaxFormatError(`FORMAT cannot treat "${String(value)}" as a number.`);
  }

  return formatNumeric(numeric, parsed);
};
