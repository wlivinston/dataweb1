import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { aggregateByDatePeriod, runTimeSeriesAnalysis, isAdditiveColumn } from '../timeSeriesEngine';

/**
 * What the Time Series panel plots.
 *
 * On a study of participants it added up age and scores per enrolment day -
 * "Next period forecast: 114" was a sum of ages - and drew a forecast
 * interval down to -700 for an age. The suite runs at UTC-10, where the old
 * local-getter bucketing put 1 February into January.
 */

const days = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

describe('time series aggregation', () => {
  it('averages a column that does not add up (ages, scores)', () => {
    // Two people enrol each day, aged 30 and 50: the day's value is 40, not 80.
    const rows = days.flatMap(day => [{ day, age: 30 }, { day, age: 50 }]);
    const ds = makeDataset(rows, [{ name: 'day', type: 'date' }, { name: 'age', type: 'number' }], { id: 'a', name: 'A' });
    const result = runTimeSeriesAnalysis(ds, 'day', 'age', 'daily');
    expect(result?.aggregation).toBe('average');
    expect(result?.growthRates.every(rate => rate.currentValue === 40)).toBe(true);
  });

  it('adds up a column that does (revenue, minutes)', () => {
    const rows = days.flatMap(day => [{ day, revenue: 30 }, { day, revenue: 50 }]);
    const ds = makeDataset(rows, [{ name: 'day', type: 'date' }, { name: 'revenue', type: 'number' }], { id: 'r', name: 'R' });
    const result = runTimeSeriesAnalysis(ds, 'day', 'revenue', 'daily');
    expect(result?.aggregation).toBe('sum');
    expect(result?.growthRates.every(rate => rate.currentValue === 80)).toBe(true);
  });

  it('decides additivity by whole words, not substrings', () => {
    expect(['minutes', 'Total Sales', 'days_held', 'Quantity'].map(isAdditiveColumn)).toEqual([true, true, true, true]);
    expect(['age', 'baseline_score', 'rating', 'unit_price', 'stage'].map(isAdditiveColumn)).toEqual([false, false, false, false, false]);
  });

  it('never forecasts below zero for a series that has never been below zero', () => {
    // Steeply falling, so an unclamped trend and interval go negative.
    const rows = days.map((day, i) => ({ day, score: 120 - i * 10 }));
    const ds = makeDataset(rows, [{ name: 'day', type: 'date' }, { name: 'score', type: 'number' }], { id: 's', name: 'S' });
    const result = runTimeSeriesAnalysis(ds, 'day', 'score', 'daily');
    expect(result?.forecast.length).toBeGreaterThan(0);
    expect(result?.forecast.every(p => p.value >= 0 && (p.lower ?? 0) >= 0)).toBe(true);
  });

  it('buckets a date into its own month in any time zone', () => {
    const rows = [{ d: '2026-01-31', v: 1 }, { d: '2026-02-01', v: 2 }, { d: '2026-03-01', v: 4 }];
    const periods = aggregateByDatePeriod(rows, 'd', 'v', 'monthly').map(p => [p.period, p.sum]);
    expect(periods).toEqual([['2026-01', 1], ['2026-02', 2], ['2026-03', 4]]);
  });

  it('keys a day-first date to the same calendar day', () => {
    const periods = aggregateByDatePeriod([{ d: '15/03/2026', v: 1 }], 'd', 'v', 'daily').map(p => p.period);
    expect(periods).toEqual(['2026-03-15']);
  });
});
