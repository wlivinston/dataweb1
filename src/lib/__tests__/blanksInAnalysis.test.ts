import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { detectCorrelations, detectAnomalies } from '../aiInsightEngine';
import { autoAdvancedAnalysis, detectNonLinearCorrelations } from '../advancedStatistics';
import { pairwiseCorrelation } from '../chartValues';
import { cellNumber } from '../dax/value';

/**
 * A blank is missing, not zero - in the analysis panels too.
 *
 * `Number('')` and `Number(null)` are 0, so the panels' `Number(cell)` then
 * `!isNaN` kept every blank as a real zero. On practice_workbook.xlsx (10 blank
 * followup scores, 3 "NA" baseline scores) AI Insights reported a correlation
 * of 0.47 where the truth is 0.77, and Advanced Stats a followup mean of 62.62
 * where the truth is 65.25.
 *
 * The rows below are built so the right answer is exact: y = 2x wherever both
 * are present (40 rows - AI Insights needs 30), so the correlation is 1 - which no reading of a blank as 0 can
 * produce - and the mean of x over present values is a round number.
 */

const present = Array.from({ length: 40 }, (_, i) => ({ x: i + 1, y: 2 * (i + 1) }));
const rows = [
  ...present,
  { x: '', y: 50 },
  { x: null, y: 60 },
  { x: 'NA', y: 70 },
  { x: 7, y: '' },
];
const dataset = makeDataset(rows, [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }], {
  id: 'ds-blanks',
  name: 'Blanks',
});

describe('blanks in the analysis panels', () => {
  it('cellNumber is NaN for blank, null and non-numeric text, and the number otherwise', () => {
    expect([cellNumber(''), cellNumber(null), cellNumber(undefined), cellNumber('NA')].every(Number.isNaN)).toBe(true);
    expect([cellNumber(0), cellNumber('7'), cellNumber(' 3.5 ')]).toEqual([0, 7, 3.5]);
  });

  it('AI Insights correlations use only rows where both values are present', () => {
    const [pair] = detectCorrelations(dataset);
    expect(pair.coefficient).toBeCloseTo(1, 10);
  });

  it('the AI Insights matrix and the chart heatmap share one correlation', () => {
    expect(pairwiseCorrelation([1, 2, 3, null, 5], [2, 4, 6, 100, 10])).toBeCloseTo(1, 10);
    // Read as 0, the blank is a (0, 100) point.
    expect(pairwiseCorrelation([1, 2, 3, 0, 5], [2, 4, 6, 100, 10])).toBeLessThan(0.5);
  });

  it('Advanced Stats reports Pearson and Spearman on present pairs', () => {
    const [pair] = detectNonLinearCorrelations(dataset);
    expect(pair.pearsonCoefficient).toBe(1);
    expect(pair.spearmanCoefficient).toBe(1);
  });

  it('Advanced Stats confidence intervals average present values only, and name their column', () => {
    const { confidenceIntervals } = autoAdvancedAnalysis(dataset);
    const x = confidenceIntervals.find(ci => ci.column === 'x');
    // 1..40 plus the 7 in the last row: (820 + 7) / 41. Read as zeros, the
    // three blanks would make it 827 / 44.
    expect(x?.mean).toBeCloseTo(827 / 41, 3);
    expect(x?.sampleSize).toBe(41);
  });

  it('a blank is not an anomaly at 0', () => {
    const flagged = detectAnomalies(dataset).filter(a => a.column === 'x');
    expect(flagged.every(a => a.value !== 0)).toBe(true);
  });
});
