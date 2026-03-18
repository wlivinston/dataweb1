/**
 * Chart Recommender — Data shape converters and auto-detection logic
 * Centralizes the logic for recommending chart types based on dataset characteristics.
 */

import { SHARED_CHART_PALETTE } from './chartColors';

// ── Data shape converters ──

export function toHistogramData(
  values: number[],
  binCount: number = 15
): { category: string; value: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
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

  for (const row of rows) {
    const cat = String(row[catCol] || '');
    if (!means[cat]) continue;
    for (const col of numericCols) {
      const val = Number(row[col]);
      if (Number.isFinite(val)) {
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
    const entry: Record<string, any> = { subject: col };
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
  const agg: Record<string, number> = {};
  for (const row of rows) {
    const cat = String(row[catCol] || 'Unknown');
    const val = Number(row[numCol]);
    if (Number.isFinite(val)) {
      agg[cat] = (agg[cat] || 0) + Math.abs(val);
    }
  }
  return Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name, size], idx) => ({
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
  const data: number[][] = cols.map(col =>
    rows.map(r => Number(r[col]) || 0)
  );

  const means = data.map(d => d.reduce((s, v) => s + v, 0) / n);
  const stds = data.map((d, i) => {
    const variance = d.reduce((s, v) => s + (v - means[i]) ** 2, 0) / n;
    return Math.sqrt(variance);
  });

  const result: { category: string; [col: string]: any }[] = [];
  for (let i = 0; i < cols.length; i++) {
    const entry: Record<string, any> = { category: cols[i] };
    for (let j = 0; j < cols.length; j++) {
      if (stds[i] === 0 || stds[j] === 0) {
        entry[cols[j]] = 0;
      } else {
        let corr = 0;
        for (let k = 0; k < n; k++) {
          corr += (data[i][k] - means[i]) * (data[j][k] - means[j]);
        }
        corr /= n * stds[i] * stds[j];
        entry[cols[j]] = Number(corr.toFixed(3));
      }
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
  const agg: Record<string, number> = {};
  for (const row of rows) {
    const cat = String(row[catCol] || '');
    const val = Number(row[numCol]);
    if (Number.isFinite(val)) {
      agg[cat] = (agg[cat] || 0) + Math.abs(val);
    }
  }
  return Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value], idx) => ({
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
  const grid: Record<string, Record<string, number>> = {};
  const allSecondary = new Set<string>();

  for (const row of rows) {
    const p = String(row[primaryCat] || '');
    const s = String(row[secondaryCat] || '');
    const v = Number(row[numCol]);
    if (!Number.isFinite(v)) continue;
    allSecondary.add(s);
    if (!grid[p]) grid[p] = {};
    grid[p][s] = (grid[p][s] || 0) + v;
  }

  const secondaryKeys = [...allSecondary].slice(0, 8);
  return Object.entries(grid)
    .slice(0, 30)
    .map(([category, seriesMap]) => {
      const entry: Record<string, any> = { category };
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
  const sorted = rows
    .map(r => ({
      category: String(r[catCol] || ''),
      value: Number(r[numCol]) || 0,
    }))
    .filter(d => Number.isFinite(d.value))
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
  const agg: Record<string, number> = {};
  for (const row of rows) {
    const cat = String(row[catCol] || 'Unknown');
    const val = Number(row[numCol]);
    if (Number.isFinite(val)) {
      agg[cat] = (agg[cat] || 0) + Math.abs(val);
    }
  }
  const sorted = Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
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
    .map(r => ({ date: String(r[dateCol] || ''), value: Number(r[numCol]) || 0 }))
    .filter(r => r.date && Number.isFinite(r.value))
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
      .map(r => Number(r[col]))
      .filter(v => Number.isFinite(v))
      .sort((a, b) => a - b);
    const n = values.length;
    if (n === 0) return { Metric: col, Count: 0 };

    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const median = n % 2 === 0 ? (values[n / 2 - 1] + values[n / 2]) / 2 : values[Math.floor(n / 2)];
    const q1 = values[Math.floor(n * 0.25)];
    const q3 = values[Math.floor(n * 0.75)];
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
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
  return rows
    .map(r => ({
      x: Number(r[xCol]) || 0,
      y: Number(r[yCol]) || 0,
      z: Math.abs(Number(r[sizeCol]) || 0),
      label: labelCol ? String(r[labelCol] || '') : '',
    }))
    .filter(d => Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z))
    .slice(0, 300);
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
    const val = Number(row[numCol]);
    if (!Number.isFinite(val)) continue;
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
      const entry: Record<string, any> = { category: monthNames[parseInt(month, 10) - 1] || month };
      for (const y of sortedYears) {
        entry[y] = yearVals[y] || 0;
      }
      return entry;
    });
}
