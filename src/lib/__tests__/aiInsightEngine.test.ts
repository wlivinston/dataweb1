import { describe, it, expect } from 'vitest';
import { makeDataset, seededRandom, seededNormal } from './fixtures';
import { detectCorrelations } from '../aiInsightEngine';
import { correlationPValue, benjaminiHochberg } from '../advancedStatistics';

const numericSpec = (names: string[]) =>
  names.map((name) => ({ name, type: 'number' as const }));

describe('correlationPValue', () => {
  it('matches the t-test the coefficient reduces to', () => {
    // r = 0.5, n = 30 -> t = 0.5 * sqrt(28 / 0.75) = 3.0551, df = 28
    // two-sided p = 0.00492
    expect(correlationPValue(0.5, 30)).toBeCloseTo(0.0049, 3);
  });

  it('is symmetric in the sign of r', () => {
    expect(correlationPValue(-0.5, 30)).toBeCloseTo(correlationPValue(0.5, 30), 10);
  });

  it('shrinks as the sample grows for a fixed coefficient', () => {
    expect(correlationPValue(0.3, 200)).toBeLessThan(correlationPValue(0.3, 30));
  });

  it('refuses to evaluate fewer than three points', () => {
    expect(correlationPValue(0.99, 2)).toBe(1);
  });
});

describe('benjaminiHochberg', () => {
  it('keeps every p-value when they are all tiny', () => {
    expect(benjaminiHochberg([0.0001, 0.0002, 0.0003], 0.05)).toEqual([0, 1, 2]);
  });

  it('rejects everything when they are all large', () => {
    expect(benjaminiHochberg([0.4, 0.6, 0.8], 0.05)).toEqual([]);
  });

  it('applies the step-up threshold rather than a flat alpha', () => {
    // m = 10, fdr = 0.05. Thresholds are i/10 * 0.05 = 0.005, 0.010, 0.015, ...
    // 0.004 <= 0.005 and 0.009 <= 0.010, but 0.040 > 0.015, so only the first
    // two survive even though all three are below a naive alpha of 0.05.
    const p = [0.004, 0.009, 0.04, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    expect(benjaminiHochberg(p, 0.05)).toEqual([0, 1]);
  });

  it('returns original indices, not ranks', () => {
    // The smallest p-value sits last in the input.
    expect(benjaminiHochberg([0.9, 0.8, 0.0001], 0.05)).toEqual([2]);
  });

  it('handles an empty input', () => {
    expect(benjaminiHochberg([], 0.05)).toEqual([]);
  });
});

describe('detectCorrelations', () => {
  it('finds a real relationship and reports its evidence', () => {
    const rng = seededRandom(7);
    const rows = Array.from({ length: 200 }, () => {
      const x = rng() * 100;
      return { x, y: 2 * x + seededNormal(rng, 0, 5), noise: rng() * 100 };
    });
    const dataset = makeDataset(rows, numericSpec(['x', 'y', 'noise']));

    const results = detectCorrelations(dataset);
    const xy = results.find(
      (r) =>
        (r.column1 === 'x' && r.column2 === 'y') || (r.column1 === 'y' && r.column2 === 'x')
    );

    expect(xy).toBeDefined();
    expect(xy!.coefficient).toBeGreaterThan(0.9);
    expect(xy!.strength).toBe('strong');
    expect(xy!.sampleSize).toBe(200);
    expect(xy!.pValue).toBeLessThan(0.001);
  });

  it('refuses to report a correlation from a handful of points', () => {
    // Three perfectly collinear points would previously surface as a "strong"
    // finding. Below the minimum sample size nothing is reported.
    const dataset = makeDataset(
      [
        { a: 1, b: 2 },
        { a: 2, b: 4 },
        { a: 3, b: 6 },
      ],
      numericSpec(['a', 'b'])
    );
    expect(detectCorrelations(dataset)).toEqual([]);
  });

  it('reports nothing from pure noise that a naive alpha would accept', () => {
    // 14 independent standard-normal columns over 50 rows: 91 simultaneous
    // tests, of which 15 clear the |r| >= 0.2 screen. Five of those 15 have a
    // raw p-value below 0.05 and would each be published as a "finding" by a
    // per-test threshold. Every one of them is noise by construction, and
    // Benjamini-Hochberg rejects all five.
    const rng = seededRandom(1);
    const cols = Array.from({ length: 14 }, (_, i) => `c${i}`);
    const rows = Array.from({ length: 50 }, () => {
      const row: Record<string, number> = {};
      for (const c of cols) row[c] = seededNormal(rng, 0, 1);
      return row;
    });
    const dataset = makeDataset(rows, numericSpec(cols));

    expect(detectCorrelations(dataset)).toEqual([]);
  });

  it('still separates signal from noise in a mixed dataset', () => {
    const rng = seededRandom(13);
    const cols = ['signalA', 'signalB', ...Array.from({ length: 8 }, (_, i) => `n${i}`)];
    const rows = Array.from({ length: 150 }, () => {
      const a = seededNormal(rng, 0, 1);
      const row: Record<string, number> = {
        signalA: a,
        signalB: 3 * a + seededNormal(rng, 0, 0.2),
      };
      for (let i = 0; i < 8; i++) row[`n${i}`] = seededNormal(rng, 0, 1);
      return row;
    });
    const dataset = makeDataset(rows, numericSpec(cols));

    const results = detectCorrelations(dataset);
    expect(results.length).toBeGreaterThan(0);
    // The planted relationship ranks first.
    expect([results[0].column1, results[0].column2].sort()).toEqual(['signalA', 'signalB']);
  });

  it('describes findings as association, never as causation', () => {
    const rng = seededRandom(23);
    const rows = Array.from({ length: 120 }, () => {
      const x = rng() * 100;
      return { x, y: 2 * x + seededNormal(rng, 0, 4) };
    });
    const dataset = makeDataset(rows, numericSpec(['x', 'y']));

    const [top] = detectCorrelations(dataset);
    expect(top.interpretation).toContain('association');
    expect(top.interpretation).toContain('not evidence that one drives the other');
    expect(top.interpretation).not.toMatch(/\bcauses\b/i);
  });

  it('returns an empty list rather than throwing on a dataset with no numeric columns', () => {
    const dataset = makeDataset([{ name: 'a' }, { name: 'b' }], [
      { name: 'name', type: 'string' },
    ]);
    expect(detectCorrelations(dataset)).toEqual([]);
  });
});
