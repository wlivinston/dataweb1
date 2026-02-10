// Advanced Statistics Engine - Hypothesis testing, clustering, regression, Pareto analysis
// Brings Python-level statistical power to the browser

import {
  Dataset,
  HypothesisTestResult,
  ClusterResult,
  SegmentationResult,
  ParetoResult,
  ParetoItem,
  RegressionResult,
  PercentileResult,
  ConfidenceIntervalResult,
  SpearmanCorrelationResult
} from './types';

// ============================================================
// Statistical Distribution Approximations
// ============================================================

/**
 * Approximate p-value for t-distribution using Abramowitz & Stegun formula
 */
const tDistributionPValue = (t: number, df: number): number => {
  const absT = Math.abs(t);
  // Use normal approximation for large df
  if (df > 100) return 2 * normalCDF(-absT);

  const x = df / (df + absT * absT);
  const beta = incompleteBeta(x, df / 2, 0.5);
  return beta;
};

/**
 * Approximate CDF of standard normal distribution
 */
const normalCDF = (x: number): number => {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
};

/**
 * Incomplete beta function approximation (for p-value calculations)
 */
const incompleteBeta = (x: number, a: number, b: number): number => {
  if (x === 0 || x === 1) return x;
  // Use continued fraction approximation
  const maxIter = 200;
  const epsilon = 1e-10;

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Use Lentz's continued fraction
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < epsilon) d = epsilon;
  d = 1 / d;
  f = d;

  for (let i = 1; i <= maxIter; i++) {
    const m = i;
    let numerator: number;

    // Even step
    numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < epsilon) d = epsilon;
    c = 1 + numerator / c;
    if (Math.abs(c) < epsilon) c = epsilon;
    d = 1 / d;
    f *= c * d;

    // Odd step
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < epsilon) d = epsilon;
    c = 1 + numerator / c;
    if (Math.abs(c) < epsilon) c = epsilon;
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < epsilon) break;
  }

  return front * f;
};

/**
 * Log gamma function (Stirling approximation)
 */
const lnGamma = (x: number): number => {
  if (x <= 0) return 0;
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;

  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};

/**
 * Approximate p-value for chi-square distribution
 */
const chiSquarePValue = (chi2: number, df: number): number => {
  if (chi2 <= 0 || df <= 0) return 1;
  // Use Wilson-Hilferty approximation
  const z = Math.pow(chi2 / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  return 1 - normalCDF(z / denom);
};

/**
 * Approximate p-value for F-distribution
 */
const fDistributionPValue = (f: number, df1: number, df2: number): number => {
  if (f <= 0) return 1;
  const x = df2 / (df2 + df1 * f);
  return incompleteBeta(x, df2 / 2, df1 / 2);
};

// ============================================================
// Hypothesis Testing
// ============================================================

/**
 * Welch's two-sample t-test (unequal variances)
 */
export const tTest = (
  sample1: number[],
  sample2: number[],
  confidenceLevel: number = 0.95
): HypothesisTestResult => {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 < 2 || n2 < 2) {
    return {
      testName: "Welch's t-test",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significant: false,
      interpretation: 'Insufficient data for t-test (need at least 2 samples per group).',
      confidenceLevel
    };
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;

  const var1 = sample1.reduce((sum, v) => sum + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2 = sample2.reduce((sum, v) => sum + (v - mean2) ** 2, 0) / (n2 - 1);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    return {
      testName: "Welch's t-test",
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: n1 + n2 - 2,
      significant: false,
      interpretation: 'Both groups have identical values; no difference detected.',
      confidenceLevel
    };
  }

  const tStat = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const df = ((var1 / n1 + var2 / n2) ** 2) /
    ((var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1));

  const pValue = tDistributionPValue(tStat, df);
  const alpha = 1 - confidenceLevel;
  const significant = pValue < alpha;

  // Cohen's d effect size
  const pooledStd = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
  const effectSize = pooledStd > 0 ? Math.abs(mean1 - mean2) / pooledStd : 0;

  const effectLabel = effectSize >= 0.8 ? 'large' : effectSize >= 0.5 ? 'medium' : 'small';

  return {
    testName: "Welch's t-test",
    statistic: Math.round(tStat * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    degreesOfFreedom: Math.round(df * 10) / 10,
    significant,
    interpretation: significant
      ? `Statistically significant difference detected (p=${pValue.toFixed(4)}). Group 1 mean (${mean1.toFixed(2)}) differs from Group 2 mean (${mean2.toFixed(2)}) with a ${effectLabel} effect size (d=${effectSize.toFixed(2)}).`
      : `No statistically significant difference found (p=${pValue.toFixed(4)}). The means (${mean1.toFixed(2)} vs ${mean2.toFixed(2)}) are not significantly different at the ${(confidenceLevel * 100).toFixed(0)}% confidence level.`,
    confidenceLevel,
    effectSize: Math.round(effectSize * 1000) / 1000
  };
};

/**
 * Chi-square test of independence
 */
export const chiSquareTest = (
  observed: number[][],
  confidenceLevel: number = 0.95
): HypothesisTestResult => {
  const rows = observed.length;
  const cols = observed[0]?.length || 0;

  if (rows < 2 || cols < 2) {
    return {
      testName: 'Chi-Square Test',
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significant: false,
      interpretation: 'Insufficient categories for chi-square test.',
      confidenceLevel
    };
  }

  // Calculate row and column totals
  const rowTotals = observed.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals: number[] = [];
  for (let j = 0; j < cols; j++) {
    colTotals.push(observed.reduce((sum, row) => sum + row[j], 0));
  }
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  if (grandTotal === 0) {
    return {
      testName: 'Chi-Square Test',
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significant: false,
      interpretation: 'No data to analyze.',
      confidenceLevel
    };
  }

  // Calculate chi-square statistic
  let chi2 = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / grandTotal;
      if (expected > 0) {
        chi2 += (observed[i][j] - expected) ** 2 / expected;
      }
    }
  }

  const df = (rows - 1) * (cols - 1);
  const pValue = chiSquarePValue(chi2, df);
  const alpha = 1 - confidenceLevel;
  const significant = pValue < alpha;

  // Cramér's V effect size
  const minDim = Math.min(rows, cols) - 1;
  const cramersV = minDim > 0 ? Math.sqrt(chi2 / (grandTotal * minDim)) : 0;

  return {
    testName: 'Chi-Square Test of Independence',
    statistic: Math.round(chi2 * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    degreesOfFreedom: df,
    significant,
    interpretation: significant
      ? `Significant association found between the variables (χ²=${chi2.toFixed(2)}, p=${pValue.toFixed(4)}). Cramér's V=${cramersV.toFixed(3)} indicates a ${cramersV >= 0.5 ? 'strong' : cramersV >= 0.3 ? 'moderate' : 'weak'} association.`
      : `No significant association found (χ²=${chi2.toFixed(2)}, p=${pValue.toFixed(4)}). The variables appear to be independent.`,
    confidenceLevel,
    effectSize: Math.round(cramersV * 1000) / 1000
  };
};

/**
 * One-way ANOVA (F-test for 3+ groups)
 */
export const oneWayANOVA = (
  groups: number[][],
  confidenceLevel: number = 0.95
): HypothesisTestResult => {
  const k = groups.length; // number of groups
  if (k < 2) {
    return {
      testName: 'One-Way ANOVA',
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significant: false,
      interpretation: 'Need at least 2 groups for ANOVA.',
      confidenceLevel
    };
  }

  const N = groups.reduce((sum, g) => sum + g.length, 0); // total observations
  const grandMean = groups.reduce((sum, g) => sum + g.reduce((a, b) => a + b, 0), 0) / N;

  // Between-group sum of squares
  let ssb = 0;
  const groupMeans: number[] = [];
  for (const group of groups) {
    const groupMean = group.reduce((a, b) => a + b, 0) / group.length;
    groupMeans.push(groupMean);
    ssb += group.length * (groupMean - grandMean) ** 2;
  }

  // Within-group sum of squares
  let ssw = 0;
  for (let i = 0; i < groups.length; i++) {
    for (const val of groups[i]) {
      ssw += (val - groupMeans[i]) ** 2;
    }
  }

  const dfBetween = k - 1;
  const dfWithin = N - k;

  if (dfWithin <= 0) {
    return {
      testName: 'One-Way ANOVA',
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significant: false,
      interpretation: 'Insufficient data for ANOVA.',
      confidenceLevel
    };
  }

  const msb = ssb / dfBetween;
  const msw = ssw / dfWithin;
  const fStat = msw > 0 ? msb / msw : 0;

  const pValue = fDistributionPValue(fStat, dfBetween, dfWithin);
  const alpha = 1 - confidenceLevel;
  const significant = pValue < alpha;

  // Eta-squared effect size
  const etaSquared = ssb / (ssb + ssw);

  return {
    testName: 'One-Way ANOVA',
    statistic: Math.round(fStat * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    degreesOfFreedom: dfBetween,
    significant,
    interpretation: significant
      ? `Significant difference found among ${k} groups (F=${fStat.toFixed(2)}, p=${pValue.toFixed(4)}). η²=${etaSquared.toFixed(3)} means the grouping explains ${(etaSquared * 100).toFixed(1)}% of variance.`
      : `No significant difference found among ${k} groups (F=${fStat.toFixed(2)}, p=${pValue.toFixed(4)}).`,
    confidenceLevel,
    effectSize: Math.round(etaSquared * 1000) / 1000
  };
};

// ============================================================
// Confidence Intervals
// ============================================================

/**
 * Calculate confidence interval for a sample mean
 */
export const confidenceInterval = (
  values: number[],
  level: number = 0.95
): ConfidenceIntervalResult => {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, lower: 0, upper: 0, margin: 0, confidenceLevel: level, sampleSize: 0, standardError: 0 };
  }

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1 || 1);
  const stdDev = Math.sqrt(variance);
  const standardError = stdDev / Math.sqrt(n);

  // Z-values for common confidence levels
  let z: number;
  if (level >= 0.99) z = 2.576;
  else if (level >= 0.95) z = 1.96;
  else if (level >= 0.90) z = 1.645;
  else z = 1.96;

  // For small samples, use a wider interval (t-distribution approximation)
  if (n < 30) {
    z *= 1 + 2 / n; // Rough adjustment for small samples
  }

  const margin = z * standardError;

  return {
    mean: Math.round(mean * 1000) / 1000,
    lower: Math.round((mean - margin) * 1000) / 1000,
    upper: Math.round((mean + margin) * 1000) / 1000,
    margin: Math.round(margin * 1000) / 1000,
    confidenceLevel: level,
    sampleSize: n,
    standardError: Math.round(standardError * 1000) / 1000
  };
};

// ============================================================
// K-Means Clustering
// ============================================================

/**
 * Euclidean distance between two points
 */
const euclideanDistance = (a: number[], b: number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
};

/**
 * K-means++ initialization
 */
const kMeansPlusPlusInit = (data: number[][], k: number): number[][] => {
  const centroids: number[][] = [];
  const dims = data[0].length;

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * data.length);
  centroids.push([...data[firstIdx]]);

  for (let c = 1; c < k; c++) {
    // Compute distances to nearest centroid for each point
    const distances = data.map(point => {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = euclideanDistance(point, centroid);
        if (dist < minDist) minDist = dist;
      }
      return minDist * minDist; // Squared distance for probability weighting
    });

    // Weighted random selection
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let threshold = Math.random() * totalDist;
    let selectedIdx = 0;
    for (let i = 0; i < distances.length; i++) {
      threshold -= distances[i];
      if (threshold <= 0) {
        selectedIdx = i;
        break;
      }
    }

    centroids.push([...data[selectedIdx]]);
  }

  return centroids;
};

/**
 * Calculate silhouette score for clustering quality
 */
const calculateSilhouetteScore = (data: number[][], assignments: number[], centroids: number[][]): number => {
  if (data.length < 2 || centroids.length < 2) return 0;

  // Sample for performance
  const sampleSize = Math.min(data.length, 500);
  const step = Math.max(1, Math.floor(data.length / sampleSize));
  const indices = Array.from({ length: data.length }, (_, i) => i).filter((_, i) => i % step === 0);

  let totalSilhouette = 0;

  for (const i of indices) {
    const cluster = assignments[i];

    // a(i) = average distance to same-cluster points
    const sameCluster = indices.filter(j => j !== i && assignments[j] === cluster);
    const a = sameCluster.length > 0
      ? sameCluster.reduce((sum, j) => sum + euclideanDistance(data[i], data[j]), 0) / sameCluster.length
      : 0;

    // b(i) = minimum average distance to any other cluster
    let b = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      if (c === cluster) continue;
      const otherCluster = indices.filter(j => assignments[j] === c);
      if (otherCluster.length > 0) {
        const avgDist = otherCluster.reduce((sum, j) => sum + euclideanDistance(data[i], data[j]), 0) / otherCluster.length;
        if (avgDist < b) b = avgDist;
      }
    }

    if (b === Infinity) b = 0;

    const maxAB = Math.max(a, b);
    const silhouette = maxAB > 0 ? (b - a) / maxAB : 0;
    totalSilhouette += silhouette;
  }

  return totalSilhouette / indices.length;
};

/**
 * Run K-means clustering with auto-K detection
 */
export const kMeansClustering = (
  dataset: Dataset,
  columnNames: string[],
  maxK: number = 6,
  maxIterations: number = 50
): SegmentationResult => {
  // Extract and normalize numeric data
  const rawData: number[][] = [];
  for (const row of dataset.data) {
    const point: number[] = [];
    let valid = true;
    for (const col of columnNames) {
      const val = Number(row[col]);
      if (isNaN(val)) { valid = false; break; }
      point.push(val);
    }
    if (valid) rawData.push(point);
  }

  if (rawData.length < 3) {
    return {
      clusters: [],
      optimalK: 0,
      silhouetteScore: 0,
      interpretation: 'Insufficient data for clustering.',
      columns: columnNames,
      inertiaValues: []
    };
  }

  // Normalize (z-score standardization)
  const means: number[] = [];
  const stds: number[] = [];
  const dims = columnNames.length;

  for (let d = 0; d < dims; d++) {
    const values = rawData.map(p => p[d]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) || 1;
    means.push(mean);
    stds.push(std);
  }

  const normalizedData = rawData.map(point =>
    point.map((v, d) => (v - means[d]) / stds[d])
  );

  // Try different K values and find optimal via elbow + silhouette
  const inertiaValues: number[] = [];
  const silhouetteScores: number[] = [];
  const allResults: { k: number; centroids: number[][]; assignments: number[] }[] = [];

  const actualMaxK = Math.min(maxK, Math.floor(rawData.length / 2), 8);

  for (let k = 2; k <= actualMaxK; k++) {
    const { centroids, assignments, inertia } = runKMeans(normalizedData, k, maxIterations);
    inertiaValues.push(inertia);
    allResults.push({ k, centroids, assignments });

    const silhouette = calculateSilhouetteScore(normalizedData, assignments, centroids);
    silhouetteScores.push(silhouette);
  }

  // Find optimal K via best silhouette score
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < silhouetteScores.length; i++) {
    if (silhouetteScores[i] > bestScore) {
      bestScore = silhouetteScores[i];
      bestIdx = i;
    }
  }

  const optimalK = bestIdx + 2;
  const bestResult = allResults[bestIdx];

  // Build cluster descriptions
  const clusters: ClusterResult[] = [];
  for (let c = 0; c < optimalK; c++) {
    const memberIndices = bestResult.assignments
      .map((a, i) => a === c ? i : -1)
      .filter(i => i >= 0);

    // Denormalize centroid
    const centroid: Record<string, number> = {};
    for (let d = 0; d < dims; d++) {
      centroid[columnNames[d]] = Math.round((bestResult.centroids[c][d] * stds[d] + means[d]) * 100) / 100;
    }

    // Generate description
    const characteristics = columnNames
      .map((col, d) => {
        const val = centroid[col];
        const z = bestResult.centroids[c][d];
        if (z > 0.5) return `high ${col}`;
        if (z < -0.5) return `low ${col}`;
        return `average ${col}`;
      })
      .join(', ');

    clusters.push({
      clusterId: c,
      centroid,
      size: memberIndices.length,
      members: memberIndices.slice(0, 1000), // Limit stored indices
      characteristics: `Segment ${c + 1}: ${characteristics} (${memberIndices.length} records)`
    });
  }

  return {
    clusters,
    optimalK,
    silhouetteScore: Math.round(bestScore * 1000) / 1000,
    interpretation: `Data naturally segments into ${optimalK} distinct groups (silhouette score: ${bestScore.toFixed(3)}). ${clusters.map(c => c.characteristics).join('. ')}.`,
    columns: columnNames,
    inertiaValues
  };
};

/**
 * Core K-means algorithm
 */
const runKMeans = (
  data: number[][],
  k: number,
  maxIterations: number
): { centroids: number[][]; assignments: number[]; inertia: number } => {
  const n = data.length;
  const dims = data[0].length;

  let centroids = kMeansPlusPlusInit(data, k);
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = data.map(point => {
      let minDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < k; c++) {
        const dist = euclideanDistance(point, centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = c;
        }
      }
      return bestCluster;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids
    const newCentroids: number[][] = Array.from({ length: k }, () => new Array(dims).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dims; d++) {
        newCentroids[c][d] += data[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dims; d++) {
          newCentroids[c][d] /= counts[c];
        }
      }
    }

    centroids = newCentroids;
  }

  // Calculate inertia (total within-cluster sum of squares)
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += euclideanDistance(data[i], centroids[assignments[i]]) ** 2;
  }

  return { centroids, assignments, inertia };
};

// ============================================================
// Percentile Analysis
// ============================================================

/**
 * Compute percentiles and box plot data
 */
export const percentileAnalysis = (values: number[], column: string = ''): PercentileResult => {
  const sorted = [...values].filter(v => !isNaN(v)).sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 0) {
    return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, iqr: 0, lowerFence: 0, upperFence: 0, outlierCount: 0, column };
  }

  const getPercentile = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const frac = idx - lower;
    return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
  };

  const p25 = getPercentile(25);
  const p75 = getPercentile(75);
  const iqr = p75 - p25;
  const lowerFence = p25 - 1.5 * iqr;
  const upperFence = p75 + 1.5 * iqr;
  const outlierCount = sorted.filter(v => v < lowerFence || v > upperFence).length;

  return {
    p10: Math.round(getPercentile(10) * 1000) / 1000,
    p25: Math.round(p25 * 1000) / 1000,
    p50: Math.round(getPercentile(50) * 1000) / 1000,
    p75: Math.round(p75 * 1000) / 1000,
    p90: Math.round(getPercentile(90) * 1000) / 1000,
    p95: Math.round(getPercentile(95) * 1000) / 1000,
    p99: Math.round(getPercentile(99) * 1000) / 1000,
    iqr: Math.round(iqr * 1000) / 1000,
    lowerFence: Math.round(lowerFence * 1000) / 1000,
    upperFence: Math.round(upperFence * 1000) / 1000,
    outlierCount,
    column
  };
};

// ============================================================
// Multiple Regression (OLS)
// ============================================================

/**
 * Solve multiple linear regression via normal equations
 */
export const multipleRegression = (
  dataset: Dataset,
  targetColumn: string,
  predictorColumns: string[]
): RegressionResult => {
  const n = dataset.data.length;
  const p = predictorColumns.length;

  if (n < p + 2 || p === 0) {
    return {
      type: p <= 1 ? 'linear' : 'multiple',
      coefficients: {},
      intercept: 0,
      rSquared: 0,
      adjustedRSquared: 0,
      predictions: [],
      residuals: [],
      significantPredictors: [],
      equation: 'Insufficient data',
      interpretation: 'Not enough data points or predictors for regression.',
      targetColumn,
      predictorColumns
    };
  }

  // Build X matrix and y vector, skipping NaN rows
  const X: number[][] = [];
  const y: number[] = [];

  for (const row of dataset.data) {
    const targetVal = Number(row[targetColumn]);
    if (isNaN(targetVal)) continue;

    const predictors: number[] = [1]; // intercept
    let valid = true;
    for (const col of predictorColumns) {
      const val = Number(row[col]);
      if (isNaN(val)) { valid = false; break; }
      predictors.push(val);
    }

    if (valid) {
      X.push(predictors);
      y.push(targetVal);
    }
  }

  const validN = X.length;
  if (validN < p + 2) {
    return {
      type: p <= 1 ? 'linear' : 'multiple',
      coefficients: {},
      intercept: 0,
      rSquared: 0,
      adjustedRSquared: 0,
      predictions: [],
      residuals: [],
      significantPredictors: [],
      equation: 'Insufficient valid data',
      interpretation: 'Too many missing values in the data.',
      targetColumn,
      predictorColumns
    };
  }

  // Normal equations: β = (X'X)^(-1) X'y
  const XtX = matrixMultiply(transpose(X), X);
  const XtY = matrixVectorMultiply(transpose(X), y);

  const XtXInv = invertMatrix(XtX);
  if (!XtXInv) {
    return {
      type: p <= 1 ? 'linear' : 'multiple',
      coefficients: {},
      intercept: 0,
      rSquared: 0,
      adjustedRSquared: 0,
      predictions: [],
      residuals: [],
      significantPredictors: [],
      equation: 'Matrix is singular',
      interpretation: 'Predictors are perfectly collinear; regression cannot be computed.',
      targetColumn,
      predictorColumns
    };
  }

  const beta = matrixVectorMultiply(XtXInv, XtY);

  // Calculate predictions and residuals
  const predictions = X.map(xi => xi.reduce((sum, xij, j) => sum + xij * beta[j], 0));
  const residuals = y.map((yi, i) => yi - predictions[i]);

  // R-squared
  const yMean = y.reduce((a, b) => a + b, 0) / validN;
  const ssTotal = y.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0);
  const ssResidual = residuals.reduce((sum, r) => sum + r * r, 0);
  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  const adjustedRSquared = 1 - ((1 - rSquared) * (validN - 1)) / (validN - p - 1);

  // Build coefficients map
  const coefficients: Record<string, number> = {};
  const significantPredictors: string[] = [];

  // Standard errors of coefficients
  const mse = ssResidual / Math.max(1, validN - p - 1);

  for (let j = 0; j < predictorColumns.length; j++) {
    const coef = beta[j + 1]; // +1 to skip intercept
    coefficients[predictorColumns[j]] = Math.round(coef * 10000) / 10000;

    // Rough significance: coefficient is significant if |t| > 2
    const se = XtXInv[j + 1]?.[j + 1] !== undefined ? Math.sqrt(Math.abs(mse * XtXInv[j + 1][j + 1])) : 1;
    const tStat = se > 0 ? Math.abs(coef / se) : 0;
    if (tStat > 2) {
      significantPredictors.push(predictorColumns[j]);
    }
  }

  // Build equation string
  const terms = predictorColumns.map((col, i) => {
    const coef = beta[i + 1];
    const sign = coef >= 0 ? '+' : '-';
    return `${sign} ${Math.abs(coef).toFixed(4)} × ${col}`;
  });
  const equation = `${targetColumn} = ${beta[0].toFixed(4)} ${terms.join(' ')}`;

  return {
    type: p <= 1 ? 'linear' : 'multiple',
    coefficients,
    intercept: Math.round(beta[0] * 10000) / 10000,
    rSquared: Math.round(rSquared * 10000) / 10000,
    adjustedRSquared: Math.round(adjustedRSquared * 10000) / 10000,
    predictions,
    residuals,
    significantPredictors,
    equation,
    interpretation: `Model explains ${(rSquared * 100).toFixed(1)}% of variance in ${targetColumn}. ${significantPredictors.length > 0 ? `Key predictors: ${significantPredictors.join(', ')}.` : 'No individually significant predictors found.'} ${rSquared > 0.7 ? 'Strong predictive model.' : rSquared > 0.4 ? 'Moderate predictive model.' : 'Weak predictive model — consider additional variables.'}`,
    targetColumn,
    predictorColumns
  };
};

// Matrix utilities for regression
const transpose = (m: number[][]): number[][] => {
  const rows = m.length;
  const cols = m[0].length;
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j];
    }
  }
  return result;
};

const matrixMultiply = (a: number[][], b: number[][]): number[][] => {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < inner; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
};

const matrixVectorMultiply = (m: number[][], v: number[]): number[] => {
  return m.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));
};

const invertMatrix = (m: number[][]): number[][] | null => {
  const n = m.length;
  // Augment with identity
  const augmented = m.map((row, i) => {
    const identityRow = new Array(n).fill(0);
    identityRow[i] = 1;
    return [...row, ...identityRow];
  });

  // Gaussian elimination
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
        maxRow = row;
      }
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-10) return null; // Singular

    // Scale pivot row
    for (let j = 0; j < 2 * n; j++) {
      augmented[col][j] /= pivot;
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = 0; j < 2 * n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Extract inverse
  return augmented.map(row => row.slice(n));
};

// ============================================================
// Pareto Analysis
// ============================================================

/**
 * Pareto analysis (80/20 rule)
 */
export const paretoAnalysis = (
  dataset: Dataset,
  categoryColumn: string,
  valueColumn: string
): ParetoResult => {
  // Aggregate values by category
  const aggregated: Record<string, number> = {};
  for (const row of dataset.data) {
    const category = String(row[categoryColumn] || 'Unknown');
    const value = Math.abs(Number(row[valueColumn]) || 0);
    aggregated[category] = (aggregated[category] || 0) + value;
  }

  // Sort descending
  const sorted = Object.entries(aggregated)
    .sort((a, b) => b[1] - a[1]);

  const total = sorted.reduce((sum, [, val]) => sum + val, 0);
  if (total === 0) {
    return {
      column: categoryColumn,
      valueColumn,
      items: [],
      vitalFewCount: 0,
      vitalFewPercent: 0,
      interpretation: 'No data to analyze.'
    };
  }

  let cumulative = 0;
  let vitalFewCount = 0;
  const items: ParetoItem[] = sorted.map(([category, value]) => {
    cumulative += value;
    const cumulativePercent = (cumulative / total) * 100;
    const isVital = cumulativePercent <= 80 || (vitalFewCount === 0 && cumulativePercent > 0);
    if (isVital) vitalFewCount++;

    return {
      category,
      value: Math.round(value * 100) / 100,
      cumulativePercent: Math.round(cumulativePercent * 10) / 10,
      isVital
    };
  });

  // Ensure at least one vital item even if first exceeds 80%
  if (vitalFewCount === 0 && items.length > 0) {
    items[0].isVital = true;
    vitalFewCount = 1;
  }

  const vitalFewPercent = vitalFewCount > 0
    ? items.filter(i => i.isVital).reduce((sum, i) => sum + i.value, 0) / total * 100
    : 0;

  return {
    column: categoryColumn,
    valueColumn,
    items,
    vitalFewCount,
    vitalFewPercent: Math.round(vitalFewPercent * 10) / 10,
    interpretation: `Top ${vitalFewCount} of ${items.length} categories (${((vitalFewCount / items.length) * 100).toFixed(0)}%) account for ${vitalFewPercent.toFixed(1)}% of total ${valueColumn}. ${vitalFewPercent > 75 ? 'Classic Pareto distribution — focus on the vital few for maximum impact.' : 'Distribution is more even than typical 80/20.'}`
  };
};

// ============================================================
// Spearman Rank Correlation
// ============================================================

/**
 * Calculate Spearman rank correlation (handles non-linear monotonic relationships)
 */
export const spearmanCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length < 3) return 0;

  const n = x.length;
  const rankX = calculateRanks(x);
  const rankY = calculateRanks(y);

  // Pearson correlation on ranks
  const meanRX = rankX.reduce((a, b) => a + b, 0) / n;
  const meanRY = rankY.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = rankX[i] - meanRX;
    const dy = rankY[i] - meanRY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
};

/**
 * Calculate ranks with tie handling (average rank)
 */
const calculateRanks = (values: number[]): number[] => {
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    // Find ties
    while (j < indexed.length && indexed[j].value === indexed[i].value) {
      j++;
    }
    // Average rank for ties
    const avgRank = (i + j + 1) / 2; // 1-based ranks
    for (let k = i; k < j; k++) {
      ranks[indexed[k].index] = avgRank;
    }
    i = j;
  }

  return ranks;
};

/**
 * Detect non-linear correlations by comparing Pearson vs Spearman
 */
export const detectNonLinearCorrelations = (dataset: Dataset): SpearmanCorrelationResult[] => {
  const results: SpearmanCorrelationResult[] = [];
  const numericColumns = dataset.columns.filter(c => c.type === 'number');

  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const col1 = numericColumns[i];
      const col2 = numericColumns[j];

      const pairs: { v1: number; v2: number }[] = [];
      for (const row of dataset.data) {
        const v1 = Number(row[col1.name]);
        const v2 = Number(row[col2.name]);
        if (!isNaN(v1) && !isNaN(v2)) {
          pairs.push({ v1, v2 });
        }
      }

      if (pairs.length < 10) continue;

      const x = pairs.map(p => p.v1);
      const y = pairs.map(p => p.v2);

      // Pearson
      const pearson = pearsonCorrelation(x, y);

      // Spearman
      const spearman = spearmanCorrelation(x, y);

      const absSpearman = Math.abs(spearman);
      const absPearson = Math.abs(pearson);

      // Non-linear if Spearman significantly higher than Pearson
      const isNonLinear = absSpearman - absPearson > 0.15 && absSpearman > 0.4;

      if (absSpearman >= 0.3 || absPearson >= 0.3) {
        let interpretation: string;
        if (isNonLinear) {
          interpretation = `Non-linear monotonic relationship detected between ${col1.name} and ${col2.name}. Spearman (${spearman.toFixed(3)}) >> Pearson (${pearson.toFixed(3)}), suggesting a curved but consistent relationship.`;
        } else if (absSpearman >= 0.7) {
          interpretation = `Strong ${spearman > 0 ? 'positive' : 'negative'} relationship between ${col1.name} and ${col2.name}.`;
        } else {
          interpretation = `Moderate ${spearman > 0 ? 'positive' : 'negative'} relationship between ${col1.name} and ${col2.name}.`;
        }

        results.push({
          column1: col1.name,
          column2: col2.name,
          pearsonCoefficient: Math.round(pearson * 1000) / 1000,
          spearmanCoefficient: Math.round(spearman * 1000) / 1000,
          isNonLinear,
          interpretation
        });
      }
    }
  }

  return results.sort((a, b) => Math.abs(b.spearmanCoefficient) - Math.abs(a.spearmanCoefficient));
};

/**
 * Pearson correlation (helper)
 */
const pearsonCorrelation = (x: number[], y: number[]): number => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
};

// ============================================================
// Auto-run Advanced Statistics
// ============================================================

/**
 * Automatically run appropriate statistical analyses on a dataset
 */
export const autoAdvancedAnalysis = (dataset: Dataset): {
  segmentation: SegmentationResult | null;
  pareto: ParetoResult[];
  regression: RegressionResult | null;
  percentiles: PercentileResult[];
  confidenceIntervals: ConfidenceIntervalResult[];
  nonLinearCorrelations: SpearmanCorrelationResult[];
} => {
  const numericColumns = dataset.columns.filter(c => c.type === 'number');
  const categoricalColumns = dataset.columns.filter(c => c.type === 'string');

  // Clustering (if 2+ numeric columns)
  let segmentation: SegmentationResult | null = null;
  if (numericColumns.length >= 2 && dataset.rowCount >= 10) {
    const clusterCols = numericColumns.slice(0, 5).map(c => c.name);
    try {
      segmentation = kMeansClustering(dataset, clusterCols);
    } catch (e) {
      console.warn('Clustering failed:', e);
    }
  }

  // Pareto (for each categorical + numeric pair, limit to first 2)
  const pareto: ParetoResult[] = [];
  if (categoricalColumns.length > 0 && numericColumns.length > 0) {
    const catCol = categoricalColumns[0];
    for (const numCol of numericColumns.slice(0, 2)) {
      try {
        pareto.push(paretoAnalysis(dataset, catCol.name, numCol.name));
      } catch (e) {
        console.warn('Pareto failed:', e);
      }
    }
  }

  // Regression (pick target as first numeric column, predictors as rest)
  let regression: RegressionResult | null = null;
  if (numericColumns.length >= 2 && dataset.rowCount >= 10) {
    const target = numericColumns[0].name;
    const predictors = numericColumns.slice(1, 6).map(c => c.name);
    try {
      regression = multipleRegression(dataset, target, predictors);
    } catch (e) {
      console.warn('Regression failed:', e);
    }
  }

  // Percentiles for numeric columns
  const percentiles: PercentileResult[] = [];
  for (const col of numericColumns.slice(0, 5)) {
    const values = dataset.data.map(r => Number(r[col.name])).filter(v => !isNaN(v));
    if (values.length >= 5) {
      percentiles.push(percentileAnalysis(values, col.name));
    }
  }

  // Confidence intervals
  const confidenceIntervals: ConfidenceIntervalResult[] = [];
  for (const col of numericColumns.slice(0, 5)) {
    const values = dataset.data.map(r => Number(r[col.name])).filter(v => !isNaN(v));
    if (values.length >= 3) {
      const ci = confidenceInterval(values, 0.95);
      confidenceIntervals.push(ci);
    }
  }

  // Non-linear correlations
  let nonLinearCorrelations: SpearmanCorrelationResult[] = [];
  try {
    nonLinearCorrelations = detectNonLinearCorrelations(dataset);
  } catch (e) {
    console.warn('Non-linear correlation detection failed:', e);
  }

  return { segmentation, pareto, regression, percentiles, confidenceIntervals, nonLinearCorrelations };
};
