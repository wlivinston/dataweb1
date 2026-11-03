// Money: reading an amount from a cell, and adding amounts exactly.
//
// The finance engine had two amount readers that disagreed, and its main one
// was `Number(cell) || 0`:
//
//   "1,250.00"  -> NaN -> 0   the row was dropped
//   "$300.00"   -> NaN -> 0   dropped
//   "(500)"     -> dropped, and the other reader made it +500
//   "€1.250,00" -> the other reader made it 1.25
//
// None of these raised anything. A ledger written the way accountants write
// numbers lost rows silently, or kept them with the wrong sign or magnitude.
// `parseMoney` is the one reader; it returns null for anything it cannot read
// with confidence, so the caller can say so instead of guessing.
//
// Totals are added in integer cents. Binary floating point cannot represent
// 0.10 exactly, so a long ledger summed as floats drifts by fractions of a cent
// and a balance check that should pass fails, or the reverse.

/** Currency marks allowed around an amount. Anything else is not an amount. */
const CURRENCY_TOKENS = [
  'GH₵', 'GHS', 'GHC', '₵', 'NGN', '₦', 'KSH', 'KES', 'ZAR', 'USD', 'US$', 'EUR', 'GBP', 'CAD', 'XOF', 'XAF',
  'R', '$', '€', '£', '¥',
];

const stripCurrency = (text: string): string => {
  let out = text;
  for (const token of CURRENCY_TOKENS) {
    out = out.split(token).join(' ').split(token.toLowerCase()).join(' ');
  }
  return out;
};

/**
 * An amount read from a cell, or null when the cell is blank or not
 * confidently an amount.
 *
 * Accepts thousands separators ("1,250.00"), a decimal comma ("1.250,00",
 * "12,50"), negatives as "-500", "(500)" or "500-", and the currency marks
 * above. Rejects anything with other text in it ("N/A 5", "approx 300"):
 * reading the digits out of a sentence is how a confident wrong number gets in.
 */
export const parseMoney = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let text = stripCurrency(value.trim()).replace(/[\s\u00A0']/g, '');
  if (text === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) {
    // The comma comes last. With 1-2 digits after it, it is a decimal comma
    // ("1.250,00", "12,5"); with 3 it is a thousands separator ("1,250").
    const decimals = text.length - lastComma - 1;
    normalized = decimals === 3 && lastDot === -1
      ? text.replace(/,/g, '')
      : decimals <= 2
        ? text.replace(/\./g, '').replace(',', '.')
        : '';
  } else {
    normalized = text.replace(/,/g, '');
  }
  if (normalized === '' || (normalized.match(/\./g) ?? []).length > 1) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
};

/**
 * An amount in whole cents. `toPrecision(12)` absorbs float noise first, so
 * 1.005 (stored as 1.00499999...) becomes 101 cents, not 100.
 */
export const toCents = (amount: number): number =>
  Math.round(Number.parseFloat((amount * 100).toPrecision(12)));

export const fromCents = (cents: number): number => cents / 100;

/** The exact sum of amounts, rounded to the cent once per amount. */
export const sumMoney = (amounts: Iterable<number>): number => {
  let cents = 0;
  for (const amount of amounts) cents += toCents(amount);
  return fromCents(cents);
};

/** Round an amount to the cent, the same way `sumMoney` does. */
export const roundMoney = (amount: number): number => fromCents(toCents(amount));
