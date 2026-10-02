import { describe, it, expect } from 'vitest';
import { RESTORE_ROW_BUDGET, chooseRestorable } from '@/hooks/useStoredDatasets';
import type { StoredDataset } from '../datasetStore';

/**
 * Which stored datasets get pulled down on arrival.
 *
 * The hook itself needs React to run, but the DECISION it makes does not, and
 * the decision is the part that can be wrong in a way nobody notices. Pulling
 * every stored row on every page load makes the app slower the longer someone
 * uses it - decay that gets blamed on anything but the real cause - so there
 * is a budget. A budget applied carelessly has its own failure: the one large
 * dataset a user actually works with gets skipped forever, on every visit,
 * while smaller ones they do not care about load fine.
 *
 * chooseRestorable is imported, not restated. This test restated the rule at
 * first, which meant two copies that would drift the moment either changed -
 * with the test still green, because it was checking itself.
 */

const header = (id: string, rowCount: number, updatedAt: string): StoredDataset => ({
  id,
  name: id,
  sourceName: `${id}.csv`,
  status: 'ready',
  rowCount,
  columns: [{ name: 'Amount', type: 'number' }],
  byteSize: 0,
  createdAt: updatedAt,
  updatedAt,
});

/** Named for what the test is about; chooseRestorable returns take/leave. */
const choose = (all: StoredDataset[]) => {
  const { take, leave } = chooseRestorable(all);
  return { restored: take, skipped: leave };
};

describe('choosing what to restore', () => {
  it('restores everything when it fits', () => {
    const { restored, skipped } = choose([
      header('a', 1_000, '2026-10-01T00:00:00Z'),
      header('b', 2_000, '2026-09-01T00:00:00Z'),
    ]);
    expect(restored.map(entry => entry.id)).toEqual(['a', 'b']);
    expect(skipped).toEqual([]);
  });

  it('takes the most recent first', () => {
    // If something has to be left out, it should be the one the user has not
    // touched in months, not the one they were working on yesterday.
    const { restored } = choose([
      header('old', 10, '2024-01-01T00:00:00Z'),
      header('newest', 10, '2026-10-01T00:00:00Z'),
      header('middle', 10, '2025-06-01T00:00:00Z'),
    ]);
    expect(restored.map(entry => entry.id)).toEqual(['newest', 'middle', 'old']);
  });

  it('stops once the budget is spent, and reports what it skipped', () => {
    const { restored, skipped } = choose([
      header('first', RESTORE_ROW_BUDGET - 10, '2026-10-03T00:00:00Z'),
      header('second', 1_000, '2026-10-02T00:00:00Z'),
      header('third', 5, '2026-10-01T00:00:00Z'),
    ]);
    expect(restored.map(entry => entry.id)).toEqual(['first', 'third']);
    expect(skipped.map(entry => entry.id)).toEqual(['second']);
  });

  it('still loads a single dataset that is larger than the whole budget', () => {
    // The trap in a plain remaining-budget test: a dataset bigger than the
    // budget can never satisfy it, so a user whose only dataset is large
    // would get an empty app every time, with everything apparently working.
    const { restored, skipped } = choose([
      header('huge', RESTORE_ROW_BUDGET * 4, '2026-10-01T00:00:00Z'),
    ]);
    expect(restored.map(entry => entry.id)).toEqual(['huge']);
    expect(skipped).toEqual([]);
  });

  it('does not let the exemption load two huge datasets', () => {
    // The exemption is for the FIRST one only. Without that bound it would
    // read as "always load the biggest thing you have", twice over.
    const { restored, skipped } = choose([
      header('huge-1', RESTORE_ROW_BUDGET * 4, '2026-10-02T00:00:00Z'),
      header('huge-2', RESTORE_ROW_BUDGET * 4, '2026-10-01T00:00:00Z'),
    ]);
    expect(restored.map(entry => entry.id)).toEqual(['huge-1']);
    expect(skipped.map(entry => entry.id)).toEqual(['huge-2']);
  });

  it('ignores a dataset still being uploaded', () => {
    // A building dataset has unverified rows and the server refuses to serve
    // them. Asking anyway would turn an ordinary half-finished upload into a
    // restore failure on somebody else's page load.
    const building = { ...header('partial', 100, '2026-10-01T00:00:00Z'), status: 'building' as const };
    const { restored, skipped } = choose([building, header('ready', 100, '2026-09-01T00:00:00Z')]);
    expect(restored.map(entry => entry.id)).toEqual(['ready']);
    expect(skipped).toEqual([]);
  });

  it('sets a budget above the size that used to crash the browser', () => {
    // 125,000-150,000 was where Math.min(...values) threw. A restore budget
    // below that would mean the app could never reload a dataset it was
    // perfectly capable of analysing.
    expect(RESTORE_ROW_BUDGET).toBeGreaterThan(150_000);
  });
});
