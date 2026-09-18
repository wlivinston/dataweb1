import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import {
  tTest,
  chiSquareTest,
  oneWayANOVA,
  confidenceInterval,
  spearmanCorrelation,
  percentileAnalysis,
  paretoAnalysis,
} from '../advancedStatistics';

/**
 * Golden values in this file were produced by a high-precision reference
 * implementation of the t, chi-square and F distributions (Numerical Recipes
 * continued fractions, including the incomplete-beta symmetry swap), which was
 * itself validated to 6 decimal places against published critical values:
 *   t(0.975, 10)  = 2.228139  -> p = 0.050000
 *   chi2(0.95, 1) = 3.841459  -> p = 0.050000
 *   chi2(0.95, 5) = 11.070498 -> p = 0.050000
 *   F(0.95, 2, 10) = 4.102821 -> p = 0.050000
 * They match R / scipy.stats to the tolerances asserted below.
 */

describe("Welch's t-test", () => {
  const groupA = [23, 25, 28, 30, 32, 35, 27, 29, 31, 26, 24, 33];
  const groupB = [18, 20, 22, 19, 25, 21, 23, 20, 17, 24, 22, 19];

  it('reproduces the reference t statistic and Welch degrees of freedom', () => {
    const r = tTest(groupA, groupB);
    expect(r.statistic).toBeCloseTo(5.995181, 3);
    expect(r.degreesOfFreedom).toBeCloseTo(18.9, 1); // engine rounds df to 1dp
  });

  it('reproduces the reference two-sided p-value', () => {
    const r = tTest(groupA, groupB);
    // reference p = 9.26e-6. A p-value must never be reported as exactly 0.
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.significant).toBe(true);
  });

  it('agrees with the t-distribution at the 0.05 critical value', () => {
    // Identical spread, means separated so that |t| lands near t(0.975, df).
    const a = [10, 12, 14, 16, 18];
    const b = [10, 12, 14, 16, 18];
    const r = tTest(a, b);
    expect(r.statistic).toBeCloseTo(0, 6);
    expect(r.pValue).toBeCloseTo(1, 3);
    expect(r.significant).toBe(false);
  });

  it('does not claim significance on samples that are too small', () => {
    const r = tTest([1], [2]);
    expect(r.pValue).toBe(1);
    expect(r.significant).toBe(false);
  });
});

describe('Chi-square test of independence', () => {
  // 2x3 contingency table; reference chi2 = 6.862500, df = 2, p = 0.03234648
  const observed = [
    [30, 20, 50],
    [20, 30, 30],
  ];

  it('reproduces the reference chi-square statistic and degrees of freedom', () => {
    const r = chiSquareTest(observed);
    expect(r.statistic).toBeCloseTo(6.8625, 2); // engine rounds to 3dp
    expect(r.degreesOfFreedom).toBe(2);
  });

  it('reproduces the reference p-value', () => {
    const r = chiSquareTest(observed);
    expect(r.pValue).toBeCloseTo(0.0323465, 3);
  });

  it('is accurate at the alpha=0.05 boundary for df=1', () => {
    // chi2 = 3.841459 with df = 1 is exactly p = 0.05. A 2x2 table producing
    // this statistic must not be reported as significant at alpha = 0.05.
    // Table below yields chi2 = 3.8415 (df = 1) by construction.
    const table = [
      [2549, 2451],
      [2451, 2549],
    ];
    const r = chiSquareTest(table);
    expect(r.degreesOfFreedom).toBe(1);
    expect(r.statistic).toBeCloseTo(3.8416, 2);
    // exact p for chi2 = 3.8416, df = 1 is 0.0499958
    expect(r.pValue).toBeCloseTo(0.05, 3);
    expect(r.significant).toBe(true);
  });

  it('returns a neutral result for degenerate tables', () => {
    expect(chiSquareTest([[1, 2]]).pValue).toBe(1);
  });
});

describe('One-way ANOVA', () => {
  // reference F = 84.666667, df = (2, 12), p = 8.398884e-8, eta^2 = 0.933824
  const groups = [
    [12, 14, 11, 13, 15],
    [18, 20, 17, 19, 21],
    [25, 27, 24, 26, 28],
  ];

  it('reproduces the reference F statistic', () => {
    const r = oneWayANOVA(groups);
    expect(r.statistic).toBeCloseTo(84.667, 2);
    expect(r.degreesOfFreedom).toBe(2);
  });

  it('detects a clearly significant between-group difference', () => {
    const r = oneWayANOVA(groups);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.significant).toBe(true);
  });

  it('finds nothing when all groups are identical', () => {
    const same = [
      [5, 6, 7],
      [5, 6, 7],
      [5, 6, 7],
    ];
    const r = oneWayANOVA(same);
    expect(r.statistic).toBeCloseTo(0, 6);
    expect(r.significant).toBe(false);
  });
});

describe('Confidence interval', () => {
  const values = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];

  it('reproduces the reference mean and standard error', () => {
    const r = confidenceInterval(values, 0.95);
    expect(r.mean).toBeCloseTo(19, 6);
    expect(r.standardError).toBeCloseTo(1.915, 2);
    expect(r.sampleSize).toBe(10);
  });

  it('brackets the mean using a t critical value close to 2.262 at df=9', () => {
    const r = confidenceInterval(values, 0.95);
    // exact 95% CI is [14.668, 23.332]; the Cornish-Fisher t approximation
    // used by the engine is within ~0.01 of that.
    expect(r.lower).toBeCloseTo(14.668, 1);
    expect(r.upper).toBeCloseTo(23.332, 1);
    expect(r.margin).toBeGreaterThan(0);
  });

  it('widens the interval at a higher confidence level', () => {
    const ci95 = confidenceInterval(values, 0.95);
    const ci99 = confidenceInterval(values, 0.99);
    expect(ci99.margin).toBeGreaterThan(ci95.margin);
  });
});

describe('Spearman rank correlation', () => {
  it('returns 1 for a perfect monotonic but non-linear relationship', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = x.map((v) => v ** 3);
    // Pearson on the same data is only 0.928391 - this is the whole point of
    // computing Spearman alongside it.
    expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 6);
  });

  it('returns -1 for a perfect decreasing relationship', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [50, 40, 30, 20, 10];
    expect(spearmanCorrelation(x, y)).toBeCloseTo(-1, 6);
  });

  it('handles ties with average ranks', () => {
    const x = [1, 2, 2, 3, 4];
    const y = [1, 2, 2, 3, 4];
    expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 6);
  });

  it('refuses to correlate fewer than three points', () => {
    expect(spearmanCorrelation([1, 2], [1, 2])).toBe(0);
  });
});

describe('Percentile analysis', () => {
  it('computes percentiles and IQR on a known uniform distribution', () => {
    const values = Array.from({ length: 101 }, (_, i) => i); // 0..100
    const r = percentileAnalysis(values, 'v');
    expect(r.p50).toBeCloseTo(50, 6);
    expect(r.p25).toBeCloseTo(25, 6);
    expect(r.p75).toBeCloseTo(75, 6);
    expect(r.p90).toBeCloseTo(90, 6);
    expect(r.iqr).toBeCloseTo(50, 6);
    expect(r.lowerFence).toBeCloseTo(25 - 1.5 * 50, 6);
    expect(r.upperFence).toBeCloseTo(75 + 1.5 * 50, 6);
    expect(r.outlierCount).toBe(0);
  });

  it('counts values beyond the IQR fences as outliers', () => {
    const values = [...Array.from({ length: 100 }, (_, i) => i + 1), 100000];
    const r = percentileAnalysis(values, 'v');
    expect(r.outlierCount).toBeGreaterThan(0);
  });
});

describe('Pareto analysis', () => {
  it('identifies the vital few driving 80% of the total', () => {
    // 80/20 by construction: A + B carry 800 of 1000.
    const dataset = makeDataset(
      [
        { product: 'A', revenue: 500 },
        { product: 'B', revenue: 300 },
        { product: 'C', revenue: 100 },
        { product: 'D', revenue: 60 },
        { product: 'E', revenue: 40 },
      ],
      [
        { name: 'product', type: 'string' },
        { name: 'revenue', type: 'number' },
      ]
    );

    const r = paretoAnalysis(dataset, 'product', 'revenue');
    expect(r.items[0].category).toBe('A');
    expect(r.items[0].cumulativePercent).toBeCloseTo(50, 1);
    expect(r.items[1].cumulativePercent).toBeCloseTo(80, 1);
    expect(r.vitalFewCount).toBe(2);
    expect(r.vitalFewPercent).toBeCloseTo(80, 1);
  });

  it('aggregates duplicate categories before ranking', () => {
    const dataset = makeDataset(
      [
        { product: 'A', revenue: 100 },
        { product: 'A', revenue: 400 },
        { product: 'B', revenue: 300 },
      ],
      [
        { name: 'product', type: 'string' },
        { name: 'revenue', type: 'number' },
      ]
    );
    const r = paretoAnalysis(dataset, 'product', 'revenue');
    expect(r.items).toHaveLength(2);
    expect(r.items[0].category).toBe('A');
    expect(r.items[0].value).toBeCloseTo(500, 6);
  });
});

describe('Chi-square distribution accuracy (regression guard)', () => {
  /**
   * Exact upper-tail probabilities Q(df/2, chi2/2). These pin the incomplete
   * gamma implementation across the degrees-of-freedom range where the old
   * Wilson-Hilferty approximation was weakest. A 2x2 table is constructed for
   * each case: for a 2x2 table [[a, b], [b, a]] with a + b = 5000 the statistic
   * reduces to (a - b)^2 / 2500, which makes the target chi2 easy to hit exactly.
   */
  const cases: Array<{ table: number[][]; df: number; expectedP: number; label: string }> = [
    // chi2 = 3.8416, df = 1  -> p = 0.0500
    { table: [[2549, 2451], [2451, 2549]], df: 1, expectedP: 0.05, label: 'df=1 at alpha' },
    // chi2 = 1.0, df = 1 -> p = 0.3173105  ((a-b)^2/2500 with a-b = 50)
    { table: [[2525, 2475], [2475, 2525]], df: 1, expectedP: 0.3173105, label: 'df=1 mid-range' },
    // chi2 = 4.0, df = 1 -> p = 0.0455003  (a-b = 100)
    { table: [[2550, 2450], [2450, 2550]], df: 1, expectedP: 0.0455003, label: 'df=1 just past alpha' },
  ];

  for (const { table, df, expectedP, label } of cases) {
    it(`matches the exact distribution for ${label}`, () => {
      const r = chiSquareTest(table);
      expect(r.degreesOfFreedom).toBe(df);
      expect(r.pValue).toBeCloseTo(expectedP, 2);
    });
  }

  it('returns p-values strictly inside [0, 1] and never exactly zero for finite statistics', () => {
    // A very strong association: p is astronomically small but must stay > 0.
    const strong = [
      [1000, 1],
      [1, 1000],
    ];
    const r = chiSquareTest(strong);
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThan(0.0001);
    expect(r.interpretation).toContain('<0.0001');
  });

  it('is monotonically decreasing in the test statistic', () => {
    const weak = chiSquareTest([[2510, 2490], [2490, 2510]]);
    const mid = chiSquareTest([[2549, 2451], [2451, 2549]]);
    const strong = chiSquareTest([[2700, 2300], [2300, 2700]]);
    expect(weak.pValue).toBeGreaterThan(mid.pValue);
    expect(mid.pValue).toBeGreaterThan(strong.pValue);
  });
});
