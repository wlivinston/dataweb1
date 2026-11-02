/**
 * Chart Recommender — Data shape converters and auto-detection logic
 * Centralizes the logic for recommending chart types based on dataset characteristics.
 */

import { SHARED_CHART_PALETTE } from './chartColors';
import { minOf, maxOf } from './dataUtils';
import { CategoryGroups, chartNumber, sumByCategory } from './chartValues';

// ── Data shape converters ──

export function toHistogramData(
  values: number[],
  binCount: number = 15
): { category: string; value: number }[] {
  if (values.length === 0) return [];
  const min = minOf(values);
  const max = maxOf(values);
  if (min === max) return [{ category: String(min), value: values.length }];

  const binWidth = (max - min) / binCount;
  const bins: { category: string; value: number }[] = [];

  for (let i = 0; i < binCount; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    const label = `${lo.toFixed(1)}–${hi.toFixed(1)}`;
    bins.push({ category: label, value: 0 });
  }

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].value++;
  }

  return bins;
}

export function toBoxPlotData(
  groups: Map<string, number[]>
): { category: string; min: number; q1: number; median: number; q3: number; max: number }[] {
  const result: any[] = [];
  for (const [category, values] of groups) {
    if (values.length < 4) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = sorted[Math.floor(n * 0.25)];
    const median = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const min = sorted.find(v => v >= lowerFence) ?? sorted[0];
    const max = [...sorted].reverse().find(v => v <= upperFence) ?? sorted[n - 1];
    result.push({ category, min, q1, median, q3, max });
  }
  return result;
}

export function toRadarData(
  rows: Record<string, any>[],
  numericCols: string[],
  catCol: string,
  categories: string[]
): { subject: string; [key: string]: any }[] {
  // For each numeric column, compute mean across all rows, grouped by category
  const means: Record<string, Record<string, number>> = {};
  const counts: Record<string, Record<string, number>> = {};

  for (const cat of categories) {
    means[cat] = {};
    counts[cat] = {};
    for (const col of numericCols) {
      means[cat][col] = 0;
      counts[cat][col] = 0;
    }
  }

  // `categories` are labels from CategoryGroups; rows are matched by the same
  // trimmed, case-insensitive key, so " adult " lands in "Adult".
  const groups = new CategoryGroups();
  const labelFor = new Map<string, string>();
  for (const cat of categories) labelFor.set(groups.key(cat), cat);

  for (const row of rows) {
    const cat = labelFor.get(groups.key(row[catCol]));
    if (cat === undefined) continue;
    for (const col of numericCols) {
      const val = chartNumber(row[col]);
      if (val !== null) {
        means[cat][col] += val;
        counts[cat][col]++;
      }
    }
  }

  // Normalize
  for (const cat of categories) {
    for (const col of numericCols) {
      if (counts[cat][col] > 0) {
        means[cat][col] /= counts[cat][col];
      }
    }
  }

  // Build radar data: each subject is a numeric column
  return numericCols.map(col => {
    const entry: { [key: string]: any; subject: string } = { subject: col };
    for (const cat of categories) {
      entry[cat] = Number(means[cat][col].toFixed(2));
    }
    return entry;
  });
}

export function toTreemapData(
  rows: Record<string, any>[],
  catCol: string,
  numCol: string
): { name: string; size: number; fill: string }[] {
  return sumByCategory(rows, catCol, numCol, Math.abs)
    .filter(entry => entry.count > 0)
    .slice(0, 40)
    .map(({ category: name, value: size }, idx) => ({
      name,
      size,
      fill: SHARED_CHART_PALETTE[idx % SHARED_CHART_PALETTE.length],
    }));
}

export function toHeatmapCorrelation(
  rows: Record<string, any>[],
  numericCols: string[]
): { category: string; [col: string]: any }[] {
  // Pearson correlation matrix
  const n = rows.length;
  if (n < 3) return [];

  const cols = numericCols.slice(0, 15); // limit
  // Blank stays blank. Reading it as 0 invented a value for every missing
  // cell and dragged each correlation toward the column with fewer blanks.
  const data: (number | null)[][] = cols.map(col => rows.map(r => chartNumber(r[col])));

  // Pairwise-complete Pearson: each pair over the rows where both are present.
  const pearson = (a: (number | null)[], b: (number | null)[]): number => {
    let count = 0, sumA = 0, sumB = 0;
    for (let k = 0; k < n; k++) {
      if (a[k] === null || b[k] === null) continue;
      count++; sumA += a[k] as number; sumB += b[k] as number;
    }
    if (count < 3) return 0;
    const meanA = sumA / count, meanB = sumB / count;
    let cov = 0, varA = 0, varB = 0;
    for (let k = 0; k < n; k++) {
      if (a[k] === null || b[k] === null) continue;
      const da = (a[k] as number) - meanA, db = (b[k] as number) - meanB;
      cov += da * db; varA += da * da; varB += db * db;
    }
    return varA === 0 || varB === 0 ? 0 : cov / Math.sqrt(varA * varB);
  };

  const result: { category: string; [col: string]: any }[] = [];
  for (let i = 0; i < cols.length; i++) {
    const entry: { [col: string]: any; category: string } = { category: cols[i] };
    for (let j = 0; j < cols.length; j++) {
      entry[cols[j]] = Number(pearson(data[i], data[j]).toFixed(3));
    }
    result.push(entry);
  }
  return result;
}

export function toFunnelData(
  rows: Record<string, any>[],
  catCol: string,
  numCol: string
): { name: string; value: number; fill: string }[] {
  return sumByCategory(rows, catCol, numCol, Math.abs)
    .filter(entry => entry.count > 0)
    .slice(0, 10)
    .map(({ category: name, value }, idx) => ({
      name,
      value,
      fill: SHARED_CHART_PALETTE[idx % SHARED_CHART_PALETTE.length],
    }));
}

export function toStackedBarData(
  rows: Record<string, any>[],
  primaryCat: string,
  secondaryCat: string,
  numCol: string
): { category: string; [series: string]: any }[] {
  // Cross-tabulate: primary on X axis, secondary as stacked series
  // Keyed by label from CategoryGroups: a blank secondary is a series called
  // "(Blank)", not a series with no name and an unlabelled legend swatch.
  const grid: Record<string, Record<string, number>> = {};
  const allSecondary = new Set<string>();
  const primaryGroups = new CategoryGroups();
  const secondaryGroups = new CategoryGroups();

  for (const row of rows) {
    const p = primaryGroups.label(primaryGroups.key(row[primaryCat]));
    const s = secondaryGroups.label(secondaryGroups.key(row[secondaryCat]));
    const v = chartNumber(row[numCol]);
    if (v === null) continue;
    allSecondary.add(s);
    if (!grid[p]) grid[p] = {};
    grid[p][s] = (grid[p][s] || 0) + v;
  }

  const secondaryKeys = [...allSecondary].slice(0, 8);
  return Object.entries(grid)
    .slice(0, 30)
    .map(([category, seriesMap]) => {
      const entry: { [series: string]: any; category: string } = { category };
      for (const key of secondaryKeys) {
        entry[key] = seriesMap[key] || 0;
      }
      return entry;
    });
}

export function toTopBottomData(
  rows: Record<string, any>[],
  catCol: string,
  numCol: string,
  n: number = 10
): { category: string; value: number }[] {
  const groups = new CategoryGroups();
  const sorted = rows
    .map(r => ({
      category: groups.label(groups.key(r[catCol])),
      value: chartNumber(r[numCol]),
    }))
    .filter((d): d is { category: string; value: number } => d.value !== null)
    .sort((a, b) => b.value - a.value);

  const top = sorted.slice(0, n);
  const bottom = sorted.slice(-n).reverse();
  // Combine unique entries
  const seen = new Set<string>();
  const result: { category: string; value: number }[] = [];
  for (const entry of [...top, ...bottom]) {
    const key = `${entry.category}-${entry.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

// ── Column analysis helpers ──

export interface ColumnProfile {
  name: string;
  isNumeric: boolean;
  isCategorical: boolean;
  isDate: boolean;
  uniqueCount: number;
  nullCount: number;
  totalCount: number;
}

export function profileColumns(
  rows: Record<string, any>[],
  columns: string[]
): ColumnProfile[] {
  return columns.map(name => {
    let numericCount = 0;
    let nullCount = 0;
    const uniques = new Set<string>();
    let datePatternCount = 0;

    for (const row of rows.slice(0, 500)) { // sample for speed
      const val = row[name];
      if (val == null || val === '') {
        nullCount++;
        continue;
      }
      uniques.add(String(val));
      if (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '')) {
        numericCount++;
      }
      if (typeof val === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val)) {
        datePatternCount++;
      }
    }

    const sampleSize = Math.min(rows.length, 500);
    const nonNull = sampleSize - nullCount;
    const isNumeric = nonNull > 0 && numericCount / nonNull > 0.8;
    const isDate = nonNull > 0 && datePatternCount / nonNull > 0.7;
    const isCategorical = !isNumeric && !isDate && uniques.size < Math.min(50, sampleSize * 0.5);

    return {
      name,
      isNumeric,
      isCategorical,
      isDate,
      uniqueCount: uniques.size,
      nullCount,
      totalCount: rows.length,
    };
  });
}

// ── Funnel detection ──

const FUNNEL_COLUMN_PATTERNS = /stage|status|step|phase|funnel|pipeline|level/i;

export function isFunnelCandidate(colName: string, uniqueCount: number): boolean {
  return FUNNEL_COLUMN_PATTERNS.test(colName) && uniqueCount >= 3 && uniqueCount <= 10;
}

// ── Pareto chart ──

export function toParetoData(
  rows: Record<string, any>[],
  catCol: string,
  numCol: string
): { category: string; value: number; cumulative: number }[] {
  const sorted = sumByCategory(rows, catCol, numCol, Math.abs)
    .filter(entry => entry.count > 0)
    .slice(0, 30)
    .map(({ category, value }) => [category, value] as [string, number]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  let running = 0;
  return sorted.map(([category, value]) => {
    running += value;
    return { category, value, cumulative: total > 0 ? (running / total) * 100 : 0 };
  });
}

// ── Cumulative line ──

export function toCumulativeLineData(
  rows: Record<string, any>[],
  dateCol: string,
  numCol: string
): { category: string; value: number; cumulative: number }[] {
  const sorted = rows
    .map(r => ({ date: String(r[dateCol] ?? '').trim(), value: chartNumber(r[numCol]) }))
    .filter((r): r is { date: string; value: number } => r.date !== '' && r.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  let cumulative = 0;
  return sorted.slice(0, 500).map(r => {
    cumulative += r.value;
    return { category: r.date, value: r.value, cumulative };
  });
}

// ── Statistical summary table ──

export function toStatsSummaryTable(
  rows: Record<string, any>[],
  numericCols: string[]
): Record<string, any>[] {
  return numericCols.slice(0, 20).map(col => {
    const values = rows
      .map(r => chartNumber(r[col]))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const n = values.length;
    if (n === 0) return { Metric: col, Count: 0 };

    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const median = n % 2 === 0 ? (values[n / 2 - 1] + values[n / 2]) / 2 : values[Math.floor(n / 2)];
    const q1 = values[Math.floor(n * 0.25)];
    const q3 = values[Math.floor(n * 0.75)];
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1 || 1);
    const stdDev = Math.sqrt(variance);
    // Skewness (Fisher's)
    const skewness = n > 2
      ? (values.reduce((s, v) => s + ((v - mean) / (stdDev || 1)) ** 3, 0) * n) / ((n - 1) * (n - 2))
      : 0;
    // Kurtosis (excess)
    const kurtosis = n > 3
      ? ((values.reduce((s, v) => s + ((v - mean) / (stdDev || 1)) ** 4, 0) * n * (n + 1)) /
          ((n - 1) * (n - 2) * (n - 3))) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
      : 0;

    return {
      Metric: col,
      Count: n,
      Mean: Number(mean.toFixed(2)),
      Median: Number(median.toFixed(2)),
      'Std Dev': Number(stdDev.toFixed(2)),
      Min: Number(values[0].toFixed(2)),
      Q1: Number(q1.toFixed(2)),
      Q3: Number(q3.toFixed(2)),
      Max: Number(values[n - 1].toFixed(2)),
      Skewness: Number(skewness.toFixed(3)),
      Kurtosis: Number(kurtosis.toFixed(3)),
    };
  });
}

// ── Linear trend line ──

export function computeLinearTrend(
  values: number[]
): { slope: number; intercept: number; projected: number[] } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, projected: [...values] };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const projected = Array.from({ length: n }, (_, i) => Number((slope * i + intercept).toFixed(2)));
  return { slope, intercept, projected };
}

// ── Bubble chart data ──

export function toBubbleData(
  rows: Record<string, any>[],
  xCol: string,
  yCol: string,
  sizeCol: string,
  labelCol?: string
): { x: number; y: number; z: number; label: string }[] {
  // A row missing x, y or size has no position: it is left out, not drawn at 0.
  const points: { x: number; y: number; z: number; label: string }[] = [];
  for (const r of rows) {
    const x = chartNumber(r[xCol]);
    const y = chartNumber(r[yCol]);
    const z = chartNumber(r[sizeCol]);
    if (x === null || y === null || z === null) continue;
    points.push({ x, y, z: Math.abs(z), label: labelCol ? String(r[labelCol] ?? '').trim() : '' });
    if (points.length === 300) break;
  }
  return points;
}

// ── Year-over-Year comparison ──

export function toYoYData(
  rows: Record<string, any>[],
  dateCol: string,
  numCol: string
): { category: string; [year: string]: any }[] | null {
  const yearMonth: Record<string, Record<string, number>> = {};
  const years = new Set<string>();

  for (const row of rows) {
    const dateStr = String(row[dateCol] || '');
    const match = dateStr.match(/^(\d{4})[-/](\d{1,2})/);
    if (!match) continue;
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const val = chartNumber(row[numCol]);
    if (val === null) continue;
    years.add(year);
    if (!yearMonth[month]) yearMonth[month] = {};
    yearMonth[month][year] = (yearMonth[month][year] || 0) + val;
  }

  if (years.size < 2) return null;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sortedYears = [...years].sort();

  return Object.entries(yearMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, yearVals]) => {
      const entry: { [year: string]: any; category: string } = {
        category: monthNames[parseInt(month, 10) - 1] || month,
      };
      for (const y of sortedYears) {
        entry[y] = yearVals[y] || 0;
      }
      return entry;
    });
}
