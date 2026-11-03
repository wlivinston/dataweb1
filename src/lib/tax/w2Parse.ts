// Reading W-2 boxes from the text of a PDF.
//
// A W-2 from a payroll provider is a PDF with real text: every label and
// amount is a text item with a position. The form is a grid of cells, each
// with a small label ("1 Wages, tips, other compensation") and the amount in
// the cell beneath or beside it. So a box's amount is the money-looking text
// nearest its label, below it or on its line to the right - and nearer to it
// than to any other box's label.
//
// Most PDFs repeat the form (copies B, C, 2 and 2 on one page). Each copy is
// read on its own and the copies must agree; when they do not, the box is
// flagged instead of one copy being picked silently.
//
// Nothing here is final: every box read is shown to the user to check
// against the paper W-2 before the estimate uses it. A box that is not found
// is left empty for the user to type - never guessed. The Social Security
// number is not read at all; the estimate does not need it.

export interface TextItem {
  str: string;
  /** Left edge, in PDF points. */
  x: number;
  /** Baseline, in PDF points (y grows upward). */
  y: number;
  width: number;
  /** Font height. */
  height: number;
  page: number;
}

export type W2BoxKey =
  | 'wages'
  | 'federalWithheld'
  | 'socialSecurityWages'
  | 'socialSecurityWithheld'
  | 'medicareWages'
  | 'medicareWithheld';

export interface W2BoxRead {
  value: number;
  /** agreed: two or more copies say the same; single: one copy found; conflict: copies differ. */
  confidence: 'agreed' | 'single' | 'conflict';
  /** Every value the copies gave, for the conflict message. */
  seen: number[];
}

export type W2Read =
  | {
      ok: true;
      year: number | null;
      employer: string | null;
      boxes: Partial<Record<W2BoxKey, W2BoxRead>>;
      copies: number;
      notes: string[];
    }
  | { ok: false; reason: string };

const LABELS: Array<[W2BoxKey, RegExp, string]> = [
  ['wages', /wages,?\s*tips,?\s*(and\s+)?other\s+comp/, '1'],
  ['federalWithheld', /federal\s+income\s+tax\s+withheld/, '2'],
  ['socialSecurityWages', /social\s+security\s+wages/, '3'],
  ['socialSecurityWithheld', /social\s+security\s+tax\s+withheld/, '4'],
  ['medicareWages', /medicare\s+wages/, '5'],
  ['medicareWithheld', /medicare\s+tax\s+withheld/, '6'],
];

const MONEY = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/;

interface Run {
  text: string;
  norm: string;
  x: number;
  y: number;
  right: number;
  height: number;
  page: number;
}

const normalise = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Join text items that sit on one line close together into runs: generators
 * split a label like "Wages, tips, other compensation" into several items.
 */
export function toRuns(items: TextItem[]): Run[] {
  const usable = items.filter(item => item.str.trim() !== '');
  const byLine = new Map<string, TextItem[]>();
  for (const item of usable) {
    const key = `${item.page}:${Math.round(item.y * 2) / 2}`;
    const line = byLine.get(key) ?? [];
    line.push(item);
    byLine.set(key, line);
  }
  const runs: Run[] = [];
  for (const line of byLine.values()) {
    line.sort((a, b) => a.x - b.x);
    let current: Run | null = null;
    for (const item of line) {
      const gap = current ? item.x - current.right : Infinity;
      // A money amount always starts its own run, so it never sticks to a label.
      const isMoney = MONEY.test(item.str.trim());
      if (current && gap <= Math.max(item.height, 3) * 1.2 && !isMoney && !MONEY.test(current.text)) {
        current.text += (gap > 0.5 ? ' ' : '') + item.str;
        current.right = item.x + item.width;
        current.height = Math.max(current.height, item.height);
      } else {
        if (current) runs.push(current);
        current = { text: item.str, norm: '', x: item.x, y: item.y, right: item.x + item.width, height: item.height, page: item.page };
      }
    }
    if (current) runs.push(current);
  }
  for (const run of runs) run.norm = normalise(run.text);
  return runs;
}

const moneyOf = (text: string): number | null => {
  const match = text.trim().match(MONEY);
  if (!match) return null;
  return Number(`${match[1].replace(/,/g, '')}.${match[2]}`);
};

/**
 * How far an amount sits from a label, or null when it is not in the label's
 * cell: beneath it (within a few lines, starting no further left than the
 * label and within the cell's width) or on its line to the right.
 */
const distance = (label: Run, amount: Run): number | null => {
  if (label.page !== amount.page) return null;
  const lineHeight = Math.max(label.height, 4);
  const dy = label.y - amount.y;
  const below = dy > 0.5 && dy <= lineHeight * 4 + 14 && amount.x >= label.x - 12 && amount.x <= label.x + Math.max(label.right - label.x, 110) + 20;
  if (below) return dy + Math.abs(amount.x - label.x) * 0.05;
  // On its line, an amount may sit far to the right (dot leaders, a right
  // column); the nearest-label rule keeps it from belonging to anything else.
  const sameLine = Math.abs(dy) <= lineHeight * 0.7 && amount.x >= label.right - 1 && amount.x - label.right <= 420;
  if (sameLine) return (amount.x - label.right) * 0.5 + 1;
  return null;
};

const mode = (values: number[]): number => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};

/** The W-2 boxes found in a PDF's text, or why none could be read. */
export function parseW2(items: TextItem[]): W2Read {
  const runs = toRuns(items);
  if (runs.length === 0) {
    return { ok: false, reason: 'This PDF has no text in it - it is probably a scan or a photo. Type the boxes in by hand.' };
  }
  const looksLikeW2 = runs.some(run => /wage and tax statement|\bw-?2\b/.test(run.norm));
  const labels = runs
    .map(run => ({ run, match: LABELS.find(([, pattern]) => pattern.test(run.norm)) }))
    .filter((entry): entry is { run: Run; match: (typeof LABELS)[number] } => Boolean(entry.match));
  if (!looksLikeW2 || !labels.some(entry => entry.match[0] === 'wages')) {
    return { ok: false, reason: 'This does not look like a W-2 (no "Wage and Tax Statement" and no box 1). Type the boxes in by hand.' };
  }

  const amounts = runs.map(run => ({ run, value: moneyOf(run.text) })).filter((a): a is { run: Run; value: number } => a.value !== null);

  // Each amount belongs to the label it is nearest to, so the value under box
  // 3 is never read as box 1's (it is also below box 1, but further away).
  const owner = new Map<Run, Run>();
  for (const amount of amounts) {
    let best: { label: Run; d: number } | null = null;
    for (const { run: label } of labels) {
      const d = distance(label, amount.run);
      if (d !== null && (!best || d < best.d)) best = { label, d };
    }
    if (best) owner.set(amount.run, best.label);
  }

  const perBox = new Map<W2BoxKey, number[]>();
  for (const { run: label, match } of labels) {
    const mine = amounts
      .filter(amount => owner.get(amount.run) === label)
      .map(amount => ({ value: amount.value, d: distance(label, amount.run)! }))
      .sort((a, b) => a.d - b.d);
    if (mine.length === 0) continue;
    const list = perBox.get(match[0]) ?? [];
    list.push(mine[0].value);
    perBox.set(match[0], list);
  }

  const boxes: Partial<Record<W2BoxKey, W2BoxRead>> = {};
  const notes: string[] = [];
  for (const [key, , box] of LABELS) {
    const seen = perBox.get(key);
    if (!seen || seen.length === 0) {
      notes.push(`Box ${box} was not found. Type it in from your W-2.`);
      continue;
    }
    const distinct = new Set(seen);
    const confidence = distinct.size > 1 ? 'conflict' : seen.length > 1 ? 'agreed' : 'single';
    boxes[key] = { value: mode(seen), confidence, seen };
    if (confidence === 'conflict') {
      notes.push(`Box ${box}: the copies in this PDF disagree (${[...distinct].map(v => v.toLocaleString(undefined, { minimumFractionDigits: 2 })).join(' vs ')}). Check it against your W-2.`);
    }
  }

  const copies = Math.max(0, ...[...perBox.values()].map(list => list.length));
  return { ok: true, year: yearOf(runs), employer: employerOf(runs), boxes, copies, notes };
}

/** The tax year: the 20xx printed largest (the form's year), or the most frequent. */
function yearOf(runs: Run[]): number | null {
  const years = runs.filter(run => /^(19|20)\d{2}$/.test(run.text.trim()));
  if (years.length === 0) {
    // Some layouts print it in the title: "2025 W-2 Wage and Tax Statement".
    const titled = runs
      .filter(run => /wage and tax statement|\bw-?2\b/.test(run.norm))
      .map(run => run.text.match(/\b(19|20)\d{2}\b/)?.[0])
      .filter((year): year is string => Boolean(year))
      .map(Number);
    return titled.length > 0 ? mode(titled) : null;
  }
  const tallest = Math.max(...years.map(run => run.height));
  const big = years.filter(run => run.height >= tallest * 0.9).map(run => Number(run.text.trim()));
  return mode(big);
}

/** The first line under the "Employer's name, address, and ZIP code" label. */
function employerOf(runs: Run[]): string | null {
  const label = runs.find(run => /employer'?s name/.test(run.norm));
  if (!label) return null;
  const below = runs
    .filter(run => run.page === label.page && run !== label && label.y - run.y > 0.5 && label.y - run.y < 40 && Math.abs(run.x - label.x) < 60)
    .filter(run => !LABELS.some(([, pattern]) => pattern.test(run.norm)) && moneyOf(run.text) === null)
    .sort((a, b) => b.y - a.y);
  return below[0]?.text.trim() || null;
}
