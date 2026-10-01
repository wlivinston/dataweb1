import { describe, it, expect } from 'vitest';
import { minOf, maxOf, analyzeColumn } from '../dataUtils';
import { toHistogramData } from '../chartRecommender';
import { makeDataset } from './fixtures';

/**
 * The size at which the product used to stop working.
 *
 * Not slowly. `Math.min(...values)` passes every element as a separate
 * argument, and a JavaScript engine has a finite argument stack, so a dataset
 * past roughly 130,000 rows threw
 *
 *     RangeError: Maximum call stack size exceeded
 *
 * out of column statistics, anomaly fixes, the time series engine and the ML
 * engine's feature scaling. Nothing capped the row count ahead of any of them,
 * and a RangeError from inside a chart helper does not read as "your file is
 * too big" to anybody.
 *
 * Found while benchmarking the engine for Phase 5 - the benchmark itself
 * crashed at 500,000 rows before it could report a timing.
 *
 * Every size here is chosen to sit ABOVE the measured limit. A test at 10,000
 * rows would pass against the broken code and prove nothing, which is exactly
 * why none of the existing tests caught this.
 */

/** Comfortably past the ~125k-150k threshold measured on this build. */
const PAST_THE_LIMIT = 200_000;

const ascending = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

describe('minOf and maxOf survive a list that cannot be spread', () => {
  it('handles more elements than the argument stack allows', () => {
    const values = ascending(PAST_THE_LIMIT);
    expect(minOf(values)).toBe(0);
    expect(maxOf(values)).toBe(PAST_THE_LIMIT - 1);
  });

  it('confirms the spread really does throw at this size', () => {
    // The evidence, so nobody has to take the comment above on trust or
    // reintroduce the bug to find out. If a future engine raises the limit
    // this test fails, and the helpers become an optimisation rather than a
    // fix - which is worth knowing either way.
    const values = ascending(PAST_THE_LIMIT);
    expect(() => Math.min(...values)).toThrow(RangeError);
  });

  it('agrees with Math.min and Math.max wherever Math can still be asked', () => {
    // Behaviour has to be identical below the limit, or swapping the call
    // sites changed more than the crash.
    for (const values of [
      [5, 3, 9, 1],
      [-10, -2, -7],
      [0],
      [2.5, 2.4999, 2.5001],
      [Infinity, 1],
      [-Infinity, 1],
    ]) {
      expect(minOf(values)).toBe(Math.min(...values));
      expect(maxOf(values)).toBe(Math.max(...values));
    }
  });

  it('matches Math on an empty list, so a caller guard still works', () => {
    expect(minOf([])).toBe(Infinity);
    expect(maxOf([])).toBe(-Infinity);
    expect(minOf([])).toBe(Math.min());
    expect(maxOf([])).toBe(Math.max());
  });

  it('propagates NaN exactly as Math does', () => {
    // Math.min(1, NaN) is NaN, and a loop that only compares with < would
    // skip it and report 1 - a silently wrong minimum rather than a crash,
    // which is worse. Checked at both ends because a NaN early and a NaN
    // late take different branches.
    expect(minOf([NaN, 1, 2])).toBeNaN();
    expect(minOf([1, 2, NaN])).toBeNaN();
    expect(maxOf([NaN, 1, 2])).toBeNaN();
    expect(maxOf([1, 2, NaN])).toBeNaN();
    expect(Math.min(1, NaN)).toBeNaN();
  });
});

describe('the paths that used to crash', () => {
  it('builds a histogram from more values than can be spread', () => {
    const values = ascending(PAST_THE_LIMIT);
    const bins = toHistogramData(values, 10);
    expect(bins).toHaveLength(10);
    // Every value lands in some bin, so the range really was computed.
    expect(bins.reduce((total, bin) => total + bin.value, 0)).toBe(PAST_THE_LIMIT);
  });

  it('analyses a column with more rows than the old ceiling', () => {
    // analyzeColumn is what the upload component calls for every column of
    // every sheet, so this is the real path rather than a stand-in.
    const values = Array.from({ length: PAST_THE_LIMIT }, (_, i) => i % 1000);
    const column = analyzeColumn('Amount', values);

    expect(column.type).toBe('number');
    expect(column.min).toBe(0);
    expect(column.max).toBe(999);
    expect(column.nullCount).toBe(0);
  }, 60_000);

  it('builds a dataset fixture larger than the old ceiling', () => {
    // The fixture helper had the same defect, which is a large part of why
    // the crash went unnoticed: no test could construct a dataset big enough
    // to hit it without the helper itself throwing first.
    const rows = Array.from({ length: PAST_THE_LIMIT }, (_, i) => ({
      OrderID: `O${i}`,
      Amount: i % 1000,
    }));
    const dataset = makeDataset(rows, [
      { name: 'OrderID', type: 'string' },
      { name: 'Amount', type: 'number' },
    ]);

    expect(dataset.rowCount).toBe(PAST_THE_LIMIT);
    const amount = dataset.columns.find(column => column.name === 'Amount');
    expect(amount?.min).toBe(0);
    expect(amount?.max).toBe(999);
  }, 60_000);
});
