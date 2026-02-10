// AI-Powered Insight Engine - Automatically detects patterns, correlations, trends, and anomalies
// This engine makes the platform a cut above anything else in the field

import { Dataset, ColumnInfo, DataInsight, Relationship, SpearmanCorrelationResult, LagCorrelationResult, CohortResult } from './types';
import { spearmanCorrelation } from './advancedStatistics';
import { detectDateColumns } from './timeSeriesEngine';

export interface CorrelationResult {
  column1: string;
  column2: string;
  coefficient: number;
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'positive' | 'negative' | 'none';
  interpretation: string;
}

export interface TrendResult {
  column: string;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  slope: number;
  confidence: number;
  forecast: number[];
  interpretation: string;
}

export interface AnomalyResult {
  column: string;
  rowIndex: number;
  value: any;
  expectedRange: { min: number; max: number };
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

export interface PatternResult {
  type: 'seasonal' | 'cyclical' | 'categorical_dominance' | 'distribution_skew' | 'outlier_cluster' | 'pareto' | 'bimodal_distribution' | 'periodic_spike' | 'non_linear_relationship';
  columns: string[];
  description: string;
  confidence: number;
  actionableInsight: string;
}

export interface AIInsightSummary {
  totalInsights: number;
  criticalFindings: number;
  correlations: CorrelationResult[];
  trends: TrendResult[];
  anomalies: AnomalyResult[];
  patterns: PatternResult[];
  executiveSummary: string;
  recommendations: string[];
  dataQualityScore: number;
  analysisTimestamp: Date;
}

/**
 * Calculate Pearson correlation coefficient between two numeric arrays
 */
const calculateCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length < 3) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
};

/**
 * Calculate standard deviation
 */
const calculateStdDev = (values: number[]): number => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
};

/**
 * Calculate Z-score for anomaly detection
 */
const calculateZScore = (value: number, mean: number, stdDev: number): number => {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
};

/**
 * Simple linear regression for trend detection
 */
const linearRegression = (values: number[]): { slope: number; intercept: number; r2: number } => {
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * values[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared
  const yMean = sumY / n;
  const ssTotal = values.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0);
  const ssResidual = values.reduce((sum, yi, i) => {
    const predicted = slope * i + intercept;
    return sum + (yi - predicted) ** 2;
  }, 0);
  const r2 = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;
  
  return { slope, intercept, r2 };
};

/**
 * Detect correlations between all numeric columns
 */
export const detectCorrelations = (dataset: Dataset): CorrelationResult[] => {
  const results: CorrelationResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const col1 = numericColumns[i];
      const col2 = numericColumns[j];
      
      const values1 = dataset.data.map(row => Number(row[col1.name])).filter(v => !isNaN(v));
      const values2 = dataset.data.map(row => Number(row[col2.name])).filter(v => !isNaN(v));
      
      // Align arrays
      const alignedPairs: { v1: number; v2: number }[] = [];
      dataset.data.forEach(row => {
        const v1 = Number(row[col1.name]);
        const v2 = Number(row[col2.name]);
        if (!isNaN(v1) && !isNaN(v2)) {
          alignedPairs.push({ v1, v2 });
        }
      });
      
      if (alignedPairs.length < 3) continue;
      
      const correlation = calculateCorrelation(
        alignedPairs.map(p => p.v1),
        alignedPairs.map(p => p.v2)
      );
      
      const absCorr = Math.abs(correlation);
      let strength: CorrelationResult['strength'] = 'none';
      if (absCorr >= 0.7) strength = 'strong';
      else if (absCorr >= 0.4) strength = 'moderate';
      else if (absCorr >= 0.2) strength = 'weak';
      
      const direction: CorrelationResult['direction'] = 
        correlation > 0.1 ? 'positive' : correlation < -0.1 ? 'negative' : 'none';
      
      let interpretation = '';
      if (strength === 'strong') {
        interpretation = direction === 'positive' 
          ? `Strong positive relationship: as ${col1.name} increases, ${col2.name} tends to increase significantly.`
          : `Strong negative relationship: as ${col1.name} increases, ${col2.name} tends to decrease significantly.`;
      } else if (strength === 'moderate') {
        interpretation = direction === 'positive'
          ? `Moderate positive relationship between ${col1.name} and ${col2.name}. Consider investigating causality.`
          : `Moderate negative relationship between ${col1.name} and ${col2.name}. These may be inversely related.`;
      }
      
      if (absCorr >= 0.2) {
        results.push({
          column1: col1.name,
          column2: col2.name,
          coefficient: Math.round(correlation * 1000) / 1000,
          strength,
          direction,
          interpretation
        });
      }
    }
  }
  
  return results.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
};

/**
 * Detect trends in time-series or sequential numeric data
 */
export const detectTrends = (dataset: Dataset): TrendResult[] => {
  const results: TrendResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  
  numericColumns.forEach(col => {
    const values = dataset.data.map(row => Number(row[col.name])).filter(v => !isNaN(v));
    
    if (values.length < 5) return;
    
    const { slope, r2 } = linearRegression(values);
    const stdDev = calculateStdDev(values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Normalize slope relative to mean for comparison
    const normalizedSlope = mean !== 0 ? slope / Math.abs(mean) : slope;
    
    let trend: TrendResult['trend'] = 'stable';
    if (Math.abs(normalizedSlope) > 0.05) {
      trend = normalizedSlope > 0 ? 'increasing' : 'decreasing';
    }
    
    // Check for volatility
    const coefficientOfVariation = mean !== 0 ? stdDev / Math.abs(mean) : 0;
    if (coefficientOfVariation > 0.5 && r2 < 0.3) {
      trend = 'volatile';
    }
    
    // Simple forecast (next 3 values)
    const lastIndex = values.length - 1;
    const forecast = [1, 2, 3].map(i => {
      const predicted = slope * (lastIndex + i) + (mean - slope * lastIndex / 2);
      return Math.round(predicted * 100) / 100;
    });
    
    let interpretation = '';
    if (trend === 'increasing') {
      interpretation = `${col.name} shows an upward trend with ${(r2 * 100).toFixed(1)}% confidence. Expect continued growth.`;
    } else if (trend === 'decreasing') {
      interpretation = `${col.name} shows a downward trend with ${(r2 * 100).toFixed(1)}% confidence. Monitor for further decline.`;
    } else if (trend === 'volatile') {
      interpretation = `${col.name} shows high volatility (CV: ${(coefficientOfVariation * 100).toFixed(1)}%). Values fluctuate unpredictably.`;
    } else {
      interpretation = `${col.name} is relatively stable with minimal trend.`;
    }
    
    results.push({
      column: col.name,
      trend,
      slope: Math.round(slope * 1000) / 1000,
      confidence: Math.round(r2 * 100) / 100,
      forecast,
      interpretation
    });
  });
  
  return results.sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope));
};

/**
 * Detect anomalies using statistical methods (Z-score and IQR)
 */
export const detectAnomalies = (dataset: Dataset): AnomalyResult[] => {
  const results: AnomalyResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  
  numericColumns.forEach(col => {
    const values = dataset.data.map((row, idx) => ({
      value: Number(row[col.name]),
      index: idx
    })).filter(v => !isNaN(v.value));
    
    if (values.length < 10) return;
    
    const numericValues = values.map(v => v.value);
    const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    const stdDev = calculateStdDev(numericValues);
    
    // IQR method
    const sorted = [...numericValues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    values.forEach(({ value, index }) => {
      const zScore = calculateZScore(value, mean, stdDev);
      const absZScore = Math.abs(zScore);
      
      // Check both Z-score and IQR methods
      const isZScoreAnomaly = absZScore > 2;
      const isIQRAnomaly = value < lowerBound || value > upperBound;
      
      if (isZScoreAnomaly || isIQRAnomaly) {
        let severity: AnomalyResult['severity'] = 'low';
        if (absZScore > 4 || (value < q1 - 3 * iqr || value > q3 + 3 * iqr)) {
          severity = 'critical';
        } else if (absZScore > 3) {
          severity = 'high';
        } else if (absZScore > 2.5) {
          severity = 'medium';
        }
        
        results.push({
          column: col.name,
          rowIndex: index,
          value,
          expectedRange: { min: Math.round(lowerBound * 100) / 100, max: Math.round(upperBound * 100) / 100 },
          severity,
          description: `Value ${value} in ${col.name} (row ${index + 1}) is ${absZScore.toFixed(1)} standard deviations from mean. Expected range: ${lowerBound.toFixed(2)} to ${upperBound.toFixed(2)}`
        });
      }
    });
  });
  
  return results.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  }).slice(0, 50); // Limit to top 50 anomalies
};

/**
 * Detect patterns in data
 */
export const detectPatterns = (dataset: Dataset): PatternResult[] => {
  const results: PatternResult[] = [];
  
  // 1. Categorical dominance pattern
  const categoricalColumns = dataset.columns.filter(col => col.type === 'string');
  categoricalColumns.forEach(col => {
    const valueCounts: Record<string, number> = {};
    dataset.data.forEach(row => {
      const val = String(row[col.name] || '');
      valueCounts[val] = (valueCounts[val] || 0) + 1;
    });
    
    const sortedCounts = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);
    if (sortedCounts.length > 0) {
      const topCategory = sortedCounts[0];
      const dominanceRatio = topCategory[1] / dataset.rowCount;
      
      if (dominanceRatio > 0.5) {
        results.push({
          type: 'categorical_dominance',
          columns: [col.name],
          description: `"${topCategory[0]}" dominates ${col.name} with ${(dominanceRatio * 100).toFixed(1)}% of all values`,
          confidence: dominanceRatio,
          actionableInsight: dominanceRatio > 0.8 
            ? `Consider if this imbalance is expected. You may want to filter or segment by ${col.name} for more nuanced analysis.`
            : `The category "${topCategory[0]}" is significantly more common. Investigate if this reflects reality or data collection bias.`
        });
      }
    }
  });
  
  // 2. Distribution skew pattern
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  numericColumns.forEach(col => {
    const values = dataset.data.map(row => Number(row[col.name])).filter(v => !isNaN(v));
    if (values.length < 10) return;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const stdDev = calculateStdDev(values);
    
    // Calculate skewness
    const skewness = stdDev === 0 ? 0 : 
      values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 3), 0) / values.length;
    
    if (Math.abs(skewness) > 1) {
      results.push({
        type: 'distribution_skew',
        columns: [col.name],
        description: skewness > 0 
          ? `${col.name} is right-skewed (positively skewed). Mean (${mean.toFixed(2)}) > Median (${median.toFixed(2)})`
          : `${col.name} is left-skewed (negatively skewed). Mean (${mean.toFixed(2)}) < Median (${median.toFixed(2)})`,
        confidence: Math.min(Math.abs(skewness) / 2, 1),
        actionableInsight: `Consider using median instead of mean for central tendency. Log transformation may normalize this distribution for statistical tests.`
      });
    }
  });
  
  // 3. Outlier cluster detection
  numericColumns.forEach(col => {
    const values = dataset.data.map(row => Number(row[col.name])).filter(v => !isNaN(v));
    if (values.length < 20) return;
    
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    
    const outliers = values.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    const outlierRatio = outliers.length / values.length;
    
    if (outlierRatio > 0.1) {
      results.push({
        type: 'outlier_cluster',
        columns: [col.name],
        description: `${col.name} has ${outliers.length} outliers (${(outlierRatio * 100).toFixed(1)}% of data)`,
        confidence: outlierRatio,
        actionableInsight: `High outlier presence suggests either data quality issues or distinct subpopulations. Consider segmentation analysis or data cleaning.`
      });
    }
  });
  
  return results;
};

/**
 * Calculate data quality score
 */
export const calculateDataQualityScore = (dataset: Dataset): number => {
  let score = 100;
  
  // Deduct for missing values
  const totalCells = dataset.rowCount * dataset.columns.length;
  let missingCount = 0;
  dataset.columns.forEach(col => {
    missingCount += col.nullCount;
  });
  const missingRatio = missingCount / totalCells;
  score -= missingRatio * 30; // Up to 30 points deduction
  
  // Deduct for duplicate rows
  const uniqueRows = new Set(dataset.data.map(row => JSON.stringify(row))).size;
  const duplicateRatio = 1 - uniqueRows / dataset.rowCount;
  score -= duplicateRatio * 20; // Up to 20 points deduction
  
  // Deduct for low cardinality issues
  dataset.columns.forEach(col => {
    if (col.type === 'string' && col.uniqueCount === 1) {
      score -= 2; // Deduct for constant columns
    }
  });
  
  return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * Generate executive summary from all insights
 */
export const generateExecutiveSummary = (
  dataset: Dataset,
  correlations: CorrelationResult[],
  trends: TrendResult[],
  anomalies: AnomalyResult[],
  patterns: PatternResult[]
): string => {
  const parts: string[] = [];
  
  parts.push(`Dataset "${dataset.name}" contains ${dataset.rowCount.toLocaleString()} rows across ${dataset.columns.length} columns.`);
  
  // Correlation insights
  const strongCorrelations = correlations.filter(c => c.strength === 'strong');
  if (strongCorrelations.length > 0) {
    const topCorr = strongCorrelations[0];
    parts.push(`🔗 Key Finding: Strong ${topCorr.direction} correlation (${(topCorr.coefficient * 100).toFixed(0)}%) between ${topCorr.column1} and ${topCorr.column2}.`);
  }
  
  // Trend insights
  const significantTrends = trends.filter(t => t.trend !== 'stable' && t.confidence > 0.5);
  if (significantTrends.length > 0) {
    const topTrend = significantTrends[0];
    parts.push(`📈 Trend Alert: ${topTrend.column} shows ${topTrend.trend} pattern with ${(topTrend.confidence * 100).toFixed(0)}% confidence.`);
  }
  
  // Anomaly insights
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
  if (criticalAnomalies.length > 0) {
    parts.push(`⚠️ ${criticalAnomalies.length} critical/high-severity anomalies detected requiring attention.`);
  }
  
  // Pattern insights
  if (patterns.length > 0) {
    parts.push(`🔍 ${patterns.length} data patterns identified, including ${patterns.map(p => p.type.replace('_', ' ')).slice(0, 2).join(' and ')}.`);
  }
  
  return parts.join(' ');
};

/**
 * Generate smart recommendations based on insights
 */
export const generateRecommendations = (
  dataset: Dataset,
  correlations: CorrelationResult[],
  trends: TrendResult[],
  anomalies: AnomalyResult[],
  patterns: PatternResult[]
): string[] => {
  const recommendations: string[] = [];
  
  // Data quality recommendations
  const missingDataCols = dataset.columns.filter(c => c.nullCount > dataset.rowCount * 0.1);
  if (missingDataCols.length > 0) {
    recommendations.push(`🔧 Data Cleaning: Consider imputing or removing ${missingDataCols.map(c => c.name).join(', ')} which have >10% missing values.`);
  }
  
  // Correlation-based recommendations
  const strongCorrelations = correlations.filter(c => c.strength === 'strong');
  if (strongCorrelations.length > 0) {
    recommendations.push(`📊 Investigate the strong correlation between ${strongCorrelations[0].column1} and ${strongCorrelations[0].column2}. Consider if one could predict the other.`);
  }
  
  // Trend-based recommendations
  const decreasingTrends = trends.filter(t => t.trend === 'decreasing' && t.confidence > 0.5);
  if (decreasingTrends.length > 0) {
    recommendations.push(`📉 Monitor ${decreasingTrends[0].column} - it shows a declining trend. Investigate root causes.`);
  }
  
  // Anomaly-based recommendations
  if (anomalies.length > 10) {
    recommendations.push(`⚠️ High anomaly count detected. Review data collection process for errors or establish if these are genuine outliers.`);
  }
  
  // Visualization recommendations
  if (correlations.length > 0) {
    recommendations.push(`📈 Create scatter plots for correlated variables to visualize relationships.`);
  }
  
  const dateColumns = dataset.columns.filter(c => c.type === 'date');
  if (dateColumns.length > 0 && trends.length > 0) {
    recommendations.push(`📅 Use line charts with ${dateColumns[0].name} to visualize time-based trends.`);
  }
  
  return recommendations;
};

/**
 * Helper to yield control to browser
 */
const yieldToBrowser = (): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * Main function: Run full AI-powered analysis (async version with progress)
 */
export const runAIAnalysisAsync = async (
  dataset: Dataset,
  onProgress?: (progress: number, message: string) => void
): Promise<AIInsightSummary> => {
  if (onProgress) {
    onProgress(10, 'Detecting correlations...');
  }
  await yieldToBrowser();
  
  const correlations = detectCorrelations(dataset);
  
  if (onProgress) {
    onProgress(30, 'Analyzing trends...');
  }
  await yieldToBrowser();
  
  const trends = detectTrends(dataset);
  
  if (onProgress) {
    onProgress(50, 'Scanning for anomalies...');
  }
  await yieldToBrowser();
  
  const anomalies = detectAnomalies(dataset);
  
  if (onProgress) {
    onProgress(70, 'Identifying patterns...');
  }
  await yieldToBrowser();
  
  const patterns = detectPatterns(dataset);
  
  if (onProgress) {
    onProgress(85, 'Calculating data quality...');
  }
  await yieldToBrowser();
  
  const dataQualityScore = calculateDataQualityScore(dataset);
  
  if (onProgress) {
    onProgress(90, 'Generating insights...');
  }
  await yieldToBrowser();
  
  const executiveSummary = generateExecutiveSummary(dataset, correlations, trends, anomalies, patterns);
  const recommendations = generateRecommendations(dataset, correlations, trends, anomalies, patterns);
  
  if (onProgress) {
    onProgress(100, 'Analysis complete!');
  }
  
  const criticalFindings = 
    anomalies.filter(a => a.severity === 'critical').length +
    correlations.filter(c => c.strength === 'strong').length +
    trends.filter(t => t.trend !== 'stable' && t.confidence > 0.7).length;
  
  return {
    totalInsights: correlations.length + trends.length + anomalies.length + patterns.length,
    criticalFindings,
    correlations,
    trends,
    anomalies,
    patterns,
    executiveSummary,
    recommendations,
    dataQualityScore,
    analysisTimestamp: new Date()
  };
};

/**
 * Main function: Run full AI-powered analysis (synchronous version for backward compatibility)
 */
export const runAIAnalysis = (dataset: Dataset): AIInsightSummary => {
  const correlations = detectCorrelations(dataset);
  const trends = detectTrends(dataset);
  const anomalies = detectAnomalies(dataset);
  const patterns = detectPatterns(dataset);
  const dataQualityScore = calculateDataQualityScore(dataset);
  const executiveSummary = generateExecutiveSummary(dataset, correlations, trends, anomalies, patterns);
  const recommendations = generateRecommendations(dataset, correlations, trends, anomalies, patterns);
  
  const criticalFindings = 
    anomalies.filter(a => a.severity === 'critical').length +
    correlations.filter(c => c.strength === 'strong').length +
    trends.filter(t => t.trend !== 'stable' && t.confidence > 0.7).length;
  
  return {
    totalInsights: correlations.length + trends.length + anomalies.length + patterns.length,
    criticalFindings,
    correlations,
    trends,
    anomalies,
    patterns,
    executiveSummary,
    recommendations,
    dataQualityScore,
    analysisTimestamp: new Date()
  };
};

// ============================================================
// Phase B6: Enhanced AI Insight Engine
// ============================================================

/**
 * Detect non-linear correlations using Spearman vs Pearson comparison
 */
export const detectNonLinearCorrelations = (dataset: Dataset): SpearmanCorrelationResult[] => {
  const results: SpearmanCorrelationResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');

  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const col1 = numericColumns[i];
      const col2 = numericColumns[j];

      const pairs: { v1: number; v2: number }[] = [];
      dataset.data.forEach(row => {
        const v1 = Number(row[col1.name]);
        const v2 = Number(row[col2.name]);
        if (!isNaN(v1) && !isNaN(v2)) {
          pairs.push({ v1, v2 });
        }
      });

      if (pairs.length < 10) continue;

      const x = pairs.map(p => p.v1);
      const y = pairs.map(p => p.v2);

      const pearson = calculateCorrelation(x, y);
      const spearman = spearmanCorrelation(x, y);

      const absPearson = Math.abs(pearson);
      const absSpearman = Math.abs(spearman);

      // Flag as non-linear if Spearman is significantly higher than Pearson
      const isNonLinear = absSpearman - absPearson > 0.15 && absSpearman > 0.4;

      if (absSpearman > 0.3) {
        let interpretation = '';
        if (isNonLinear) {
          interpretation = `Non-linear monotonic relationship between ${col1.name} and ${col2.name}: Spearman (${spearman.toFixed(3)}) >> Pearson (${pearson.toFixed(3)}). The relationship exists but is not a straight line.`;
        } else if (absSpearman > 0.7) {
          interpretation = `Strong linear relationship between ${col1.name} and ${col2.name} (Spearman: ${spearman.toFixed(3)}, Pearson: ${pearson.toFixed(3)}).`;
        } else {
          interpretation = `Moderate relationship between ${col1.name} and ${col2.name} (Spearman: ${spearman.toFixed(3)}, Pearson: ${pearson.toFixed(3)}).`;
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
 * Detect lag correlations — find if changes in one variable predict changes in another with a delay
 */
export const detectLagCorrelations = (dataset: Dataset, dateColumn?: string): LagCorrelationResult[] => {
  const results: LagCorrelationResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');

  if (numericColumns.length < 2) return results;

  // Sort data by date column if available
  let sortedData = [...dataset.data];
  if (dateColumn) {
    sortedData.sort((a, b) => new Date(a[dateColumn]).getTime() - new Date(b[dateColumn]).getTime());
  }

  const maxLag = Math.min(12, Math.floor(sortedData.length / 4));
  if (maxLag < 1) return results;

  // Limit to first 8 numeric columns for performance
  const colsToCheck = numericColumns.slice(0, 8);

  for (let i = 0; i < colsToCheck.length; i++) {
    for (let j = i + 1; j < colsToCheck.length; j++) {
      const col1 = colsToCheck[i];
      const col2 = colsToCheck[j];

      const values1 = sortedData.map(row => Number(row[col1.name])).filter(v => !isNaN(v));
      const values2 = sortedData.map(row => Number(row[col2.name])).filter(v => !isNaN(v));

      const minLen = Math.min(values1.length, values2.length);
      if (minLen < maxLag + 10) continue;

      const correlationsByLag: { lag: number; correlation: number }[] = [];
      let bestLag = 0;
      let bestCorr = 0;

      // Test lag 0 baseline
      const baseCorr = Math.abs(calculateCorrelation(values1.slice(0, minLen), values2.slice(0, minLen)));

      for (let lag = 1; lag <= maxLag; lag++) {
        // col1 leads col2 by `lag` periods
        const x = values1.slice(0, minLen - lag);
        const y = values2.slice(lag, minLen);

        const corr = calculateCorrelation(x, y);
        correlationsByLag.push({ lag, correlation: Math.round(corr * 1000) / 1000 });

        if (Math.abs(corr) > Math.abs(bestCorr)) {
          bestCorr = corr;
          bestLag = lag;
        }
      }

      // Only report if lagged correlation is stronger than lag-0
      if (Math.abs(bestCorr) > baseCorr + 0.1 && Math.abs(bestCorr) > 0.4) {
        const direction = bestCorr > 0 ? 'positively' : 'negatively';
        results.push({
          column1: col1.name,
          column2: col2.name,
          bestLag,
          lagCorrelation: Math.round(bestCorr * 1000) / 1000,
          correlationsByLag,
          interpretation: `Changes in ${col1.name} ${direction} predict changes in ${col2.name} with a ${bestLag}-period lag (r=${bestCorr.toFixed(3)}). This suggests ${col1.name} may be a leading indicator.`
        });
      }
    }
  }

  return results.sort((a, b) => Math.abs(b.lagCorrelation) - Math.abs(a.lagCorrelation));
};

/**
 * Detect cohort behavior — group entities by their first appearance and track over time
 */
export const detectCohorts = (
  dataset: Dataset,
  dateColumn: string,
  categoryColumn: string,
  valueColumn?: string
): CohortResult | null => {
  if (!dateColumn || !categoryColumn) return null;

  // Find first appearance of each entity
  const entityFirstDate: Record<string, Date> = {};
  const entityActivity: Record<string, { date: Date; value: number }[]> = {};

  dataset.data.forEach(row => {
    const entity = String(row[categoryColumn] || '');
    const dateVal = new Date(row[dateColumn]);
    if (!entity || isNaN(dateVal.getTime())) return;

    if (!entityFirstDate[entity] || dateVal < entityFirstDate[entity]) {
      entityFirstDate[entity] = dateVal;
    }
    if (!entityActivity[entity]) entityActivity[entity] = [];
    entityActivity[entity].push({
      date: dateVal,
      value: valueColumn ? Number(row[valueColumn]) || 1 : 1
    });
  });

  const entities = Object.keys(entityFirstDate);
  if (entities.length < 5) return null;

  // Group into monthly cohorts
  const cohortMap: Record<string, string[]> = {};
  entities.forEach(entity => {
    const d = entityFirstDate[entity];
    const cohortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!cohortMap[cohortKey]) cohortMap[cohortKey] = [];
    cohortMap[cohortKey].push(entity);
  });

  // Sort cohort periods
  const sortedCohorts = Object.keys(cohortMap).sort();
  if (sortedCohorts.length < 2) return null;

  // Compute retention for each cohort
  const cohorts = sortedCohorts.slice(0, 12).map(cohortPeriod => {
    const members = cohortMap[cohortPeriod];
    const initialSize = members.length;

    // Track activity in subsequent periods
    const retention: { period: number; count: number; rate: number }[] = [];
    for (let periodOffset = 0; periodOffset <= 6; periodOffset++) {
      const [year, month] = cohortPeriod.split('-').map(Number);
      const targetDate = new Date(year, month - 1 + periodOffset, 1);
      const targetKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

      let activeCount = 0;
      members.forEach(entity => {
        const activities = entityActivity[entity] || [];
        const isActive = activities.some(a => {
          const actKey = `${a.date.getFullYear()}-${String(a.date.getMonth() + 1).padStart(2, '0')}`;
          return actKey === targetKey;
        });
        if (isActive) activeCount++;
      });

      retention.push({
        period: periodOffset,
        count: activeCount,
        rate: initialSize > 0 ? Math.round((activeCount / initialSize) * 1000) / 1000 : 0
      });
    }

    return { cohortPeriod, initialSize, retention };
  });

  // Calculate overall retention rate (average period-1 retention)
  const period1Rates = cohorts.map(c => c.retention[1]?.rate || 0).filter(r => r > 0);
  const overallRetentionRate = period1Rates.length > 0
    ? Math.round((period1Rates.reduce((a, b) => a + b, 0) / period1Rates.length) * 1000) / 1000
    : 0;

  const interpretation = overallRetentionRate > 0.7
    ? `Strong retention: ${(overallRetentionRate * 100).toFixed(1)}% of entities remain active after one period. Your cohorts show healthy engagement.`
    : overallRetentionRate > 0.4
    ? `Moderate retention: ${(overallRetentionRate * 100).toFixed(1)}% retention after one period. Some cohorts show drop-off — investigate early-stage engagement.`
    : `Low retention: Only ${(overallRetentionRate * 100).toFixed(1)}% retention after one period. Focus on improving first-period engagement.`;

  return { cohorts, overallRetentionRate, interpretation };
};

/**
 * Enhanced pattern detection — adds pareto, bimodal, periodic spike patterns
 */
export const detectEnhancedPatterns = (dataset: Dataset): PatternResult[] => {
  const results: PatternResult[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  const categoricalColumns = dataset.columns.filter(col => col.type === 'string');

  // 1. Pareto pattern detection (80/20 rule)
  categoricalColumns.forEach(catCol => {
    numericColumns.forEach(numCol => {
      const aggregated: Record<string, number> = {};
      dataset.data.forEach(row => {
        const cat = String(row[catCol.name] || '');
        const val = Number(row[numCol.name]);
        if (cat && !isNaN(val)) {
          aggregated[cat] = (aggregated[cat] || 0) + val;
        }
      });

      const sorted = Object.entries(aggregated).sort((a, b) => b[1] - a[1]);
      if (sorted.length < 3) return;

      const total = sorted.reduce((sum, [, v]) => sum + v, 0);
      if (total === 0) return;

      let cumulative = 0;
      let countFor80 = 0;
      for (const [, value] of sorted) {
        cumulative += value;
        countFor80++;
        if (cumulative / total >= 0.8) break;
      }

      const percentOfCategories = countFor80 / sorted.length;
      if (percentOfCategories <= 0.3) {
        results.push({
          type: 'pareto',
          columns: [catCol.name, numCol.name],
          description: `Pareto effect: Top ${countFor80} of ${sorted.length} ${catCol.name} values (${(percentOfCategories * 100).toFixed(0)}%) account for 80%+ of ${numCol.name} total.`,
          confidence: 1 - percentOfCategories,
          actionableInsight: `Focus resources on the top ${countFor80} ${catCol.name} categories which drive 80% of ${numCol.name}. The remaining ${sorted.length - countFor80} categories contribute only 20%.`
        });
      }
    });
  });

  // 2. Bimodal distribution detection
  numericColumns.forEach(col => {
    const values = dataset.data.map(row => Number(row[col.name])).filter(v => !isNaN(v));
    if (values.length < 30) return;

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    if (range === 0) return;

    // Simple histogram with 20 bins
    const numBins = 20;
    const binWidth = range / numBins;
    const bins = new Array(numBins).fill(0);
    values.forEach(v => {
      const binIdx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
      bins[binIdx]++;
    });

    // Detect peaks (local maxima in histogram)
    const peaks: number[] = [];
    for (let i = 1; i < bins.length - 1; i++) {
      if (bins[i] > bins[i - 1] && bins[i] > bins[i + 1] && bins[i] > values.length * 0.05) {
        peaks.push(i);
      }
    }

    // Check if peaks are sufficiently separated
    if (peaks.length >= 2) {
      const peakSeparation = (peaks[peaks.length - 1] - peaks[0]) / numBins;
      if (peakSeparation > 0.3) {
        const peakValues = peaks.map(p => min + (p + 0.5) * binWidth);
        results.push({
          type: 'bimodal_distribution',
          columns: [col.name],
          description: `${col.name} shows a bimodal distribution with ${peaks.length} peaks centered around ${peakValues.map(v => v.toFixed(1)).join(' and ')}. This suggests two distinct sub-populations.`,
          confidence: Math.min(peakSeparation * 1.5, 0.95),
          actionableInsight: `Consider segmenting your data into groups around the peaks (${peakValues.map(v => v.toFixed(1)).join(', ')}). Each group likely has different characteristics that warrant separate analysis.`
        });
      }
    }
  });

  // 3. Periodic spike detection (for time-ordered data)
  const dateColumns = dataset.columns.filter(c => c.type === 'date');
  if (dateColumns.length > 0) {
    const dateCol = dateColumns[0];
    numericColumns.forEach(numCol => {
      const timeValues: { date: Date; value: number }[] = [];
      dataset.data.forEach(row => {
        const d = new Date(row[dateCol.name]);
        const v = Number(row[numCol.name]);
        if (!isNaN(d.getTime()) && !isNaN(v)) {
          timeValues.push({ date: d, value: v });
        }
      });

      if (timeValues.length < 20) return;
      timeValues.sort((a, b) => a.date.getTime() - b.date.getTime());

      const values = timeValues.map(tv => tv.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = calculateStdDev(values);
      if (stdDev === 0) return;

      // Find spikes (values > mean + 2*stdDev)
      const spikeIndices: number[] = [];
      values.forEach((v, idx) => {
        if (v > mean + 2 * stdDev) spikeIndices.push(idx);
      });

      if (spikeIndices.length >= 3) {
        // Check if spikes are roughly evenly spaced
        const gaps: number[] = [];
        for (let i = 1; i < spikeIndices.length; i++) {
          gaps.push(spikeIndices[i] - spikeIndices[i - 1]);
        }

        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const gapVariation = gaps.length > 1
          ? calculateStdDev(gaps) / avgGap
          : 1;

        if (gapVariation < 0.4) {
          results.push({
            type: 'periodic_spike',
            columns: [dateCol.name, numCol.name],
            description: `Regular spikes detected in ${numCol.name} approximately every ${Math.round(avgGap)} data points. ${spikeIndices.length} spikes found above 2 standard deviations.`,
            confidence: 1 - gapVariation,
            actionableInsight: `The periodic pattern in ${numCol.name} (every ~${Math.round(avgGap)} periods) could indicate seasonal effects, batch processing, or cyclical demand. Plan resources around this cycle.`
          });
        }
      }
    });
  }

  // 4. Non-linear relationship patterns
  const nonLinearResults = detectNonLinearCorrelations(dataset);
  nonLinearResults.filter(r => r.isNonLinear).forEach(r => {
    results.push({
      type: 'non_linear_relationship',
      columns: [r.column1, r.column2],
      description: `Non-linear relationship: ${r.column1} and ${r.column2} have a Spearman correlation (${r.spearmanCoefficient.toFixed(3)}) much stronger than Pearson (${r.pearsonCoefficient.toFixed(3)}), indicating a curved or exponential relationship.`,
      confidence: Math.abs(r.spearmanCoefficient),
      actionableInsight: `Standard linear models will underfit this relationship. Consider polynomial regression, log transforms, or segmented analysis for ${r.column1} vs ${r.column2}.`
    });
  });

  return results;
};

/**
 * Generate cross-dataset insights when multiple related datasets are available
 */
export const generateCrossDatasetInsights = (
  datasets: Dataset[],
  relationships: Relationship[]
): DataInsight[] => {
  const insights: DataInsight[] = [];

  if (datasets.length < 2 || relationships.length === 0) return insights;

  relationships.forEach(rel => {
    const fromDataset = datasets.find(d => d.id === rel.fromDataset);
    const toDataset = datasets.find(d => d.id === rel.toDataset);
    if (!fromDataset || !toDataset) return;

    // Find numeric columns in both datasets for cross-dataset aggregation
    const fromNumeric = fromDataset.columns.filter(c => c.type === 'number');
    const toNumeric = toDataset.columns.filter(c => c.type === 'number');
    const toCategorical = toDataset.columns.filter(c => c.type === 'string' && c.uniqueCount > 1 && c.uniqueCount < 20);

    // Cross-dataset aggregation: aggregate fact measures by dimension categories
    toCategorical.forEach(catCol => {
      fromNumeric.slice(0, 3).forEach(numCol => {
        // Build lookup from toDataset
        const dimLookup: Record<string, string> = {};
        toDataset.data.forEach(row => {
          const key = String(row[rel.toColumn] || '');
          const category = String(row[catCol.name] || '');
          if (key && category) dimLookup[key] = category;
        });

        // Aggregate fromDataset values by dimension categories
        const categoryTotals: Record<string, { sum: number; count: number }> = {};
        fromDataset.data.forEach(row => {
          const key = String(row[rel.fromColumn] || '');
          const val = Number(row[numCol.name]);
          if (isNaN(val)) return;

          const category = dimLookup[key];
          if (!category) return;

          if (!categoryTotals[category]) categoryTotals[category] = { sum: 0, count: 0 };
          categoryTotals[category].sum += val;
          categoryTotals[category].count++;
        });

        const categories = Object.entries(categoryTotals);
        if (categories.length < 2) return;

        // Sort by total value
        categories.sort((a, b) => b[1].sum - a[1].sum);

        const totalSum = categories.reduce((s, [, v]) => s + v.sum, 0);
        if (totalSum === 0) return;

        const topCategory = categories[0];
        const topPercent = ((topCategory[1].sum / totalSum) * 100).toFixed(1);

        // Compare top vs bottom
        const bottomCategory = categories[categories.length - 1];
        const ratio = bottomCategory[1].sum > 0
          ? (topCategory[1].sum / bottomCategory[1].sum).toFixed(1)
          : 'N/A';

        insights.push({
          id: `cross-${fromDataset.id}-${numCol.name}-by-${catCol.name}`,
          type: 'summary',
          title: `${numCol.name} by ${catCol.name}`,
          description: `"${topCategory[0]}" leads in ${numCol.name} with ${topPercent}% of total (${topCategory[1].sum.toLocaleString()}). It is ${ratio}x higher than "${bottomCategory[0]}" (${bottomCategory[1].sum.toLocaleString()}).`,
          datasetId: fromDataset.id,
          relatedColumns: [numCol.name, catCol.name],
          value: { topCategory: topCategory[0], topPercent, ratio }
        });
      });
    });

    // Cross-dataset correlation insight
    if (fromNumeric.length > 0 && toNumeric.length > 0) {
      insights.push({
        id: `cross-rel-${rel.id}`,
        type: 'recommendation',
        title: `Cross-Table Analysis Available`,
        description: `${fromDataset.name} and ${toDataset.name} are linked via ${rel.fromColumn} → ${rel.toColumn} (${rel.type}). ${fromNumeric.length} numeric measures from ${fromDataset.name} can be analyzed by ${toDataset.name} dimensions.`,
        datasetId: fromDataset.id,
        relatedColumns: [rel.fromColumn, rel.toColumn]
      });
    }
  });

  return insights;
};

/**
 * Enhanced recommendations with specific numbers and categorization
 */
export const generateEnhancedRecommendations = (
  dataset: Dataset,
  correlations: CorrelationResult[],
  trends: TrendResult[],
  anomalies: AnomalyResult[],
  patterns: PatternResult[],
  nonLinearCorrelations?: SpearmanCorrelationResult[],
  lagCorrelations?: LagCorrelationResult[]
): { recommendation: string; category: 'quick_win' | 'strategic' | 'investigation'; impact: number }[] => {
  const recs: { recommendation: string; category: 'quick_win' | 'strategic' | 'investigation'; impact: number }[] = [];

  // Data quality quick wins
  const missingDataCols = dataset.columns.filter(c => c.nullCount > dataset.rowCount * 0.1);
  if (missingDataCols.length > 0) {
    const totalMissing = missingDataCols.reduce((sum, c) => sum + c.nullCount, 0);
    const percentMissing = ((totalMissing / (dataset.rowCount * dataset.columns.length)) * 100).toFixed(1);
    recs.push({
      recommendation: `Data Cleaning: ${missingDataCols.length} columns have >10% missing values (${totalMissing.toLocaleString()} cells, ${percentMissing}% of total). Imputing ${missingDataCols[0].name} alone could improve analysis accuracy by ~${Math.min(20, Math.round(missingDataCols[0].nullCount / dataset.rowCount * 30))}%.`,
      category: 'quick_win',
      impact: Math.min(9, Math.round(totalMissing / (dataset.rowCount * dataset.columns.length) * 30))
    });
  }

  // Anomaly investigation
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
  if (criticalAnomalies.length > 0) {
    const affectedColumns = [...new Set(criticalAnomalies.map(a => a.column))];
    recs.push({
      recommendation: `Anomaly Review: ${criticalAnomalies.length} critical/high anomalies across ${affectedColumns.length} column(s): ${affectedColumns.slice(0, 3).join(', ')}. Removing or correcting these could reduce variance by ~${Math.min(25, criticalAnomalies.length * 3)}%.`,
      category: 'quick_win',
      impact: Math.min(8, Math.round(criticalAnomalies.length * 0.5))
    });
  }

  // Correlation-based strategic insights
  const strongCorrelations = correlations.filter(c => c.strength === 'strong');
  if (strongCorrelations.length > 0) {
    const top = strongCorrelations[0];
    const rSquared = (top.coefficient ** 2 * 100).toFixed(1);
    recs.push({
      recommendation: `Predictive Model: ${top.column1} explains ~${rSquared}% of variance in ${top.column2} (r=${top.coefficient.toFixed(3)}). Building a predictive model between these could enable forecasting and scenario planning.`,
      category: 'strategic',
      impact: 7
    });
  }

  // Trend-based recommendations with specific numbers
  const significantTrends = trends.filter(t => t.trend !== 'stable' && t.confidence > 0.5);
  significantTrends.slice(0, 2).forEach(t => {
    const changePerUnit = Math.abs(t.slope);
    if (t.trend === 'decreasing') {
      recs.push({
        recommendation: `Declining Metric: ${t.column} is decreasing at ${changePerUnit.toFixed(2)} per period (R²=${(t.confidence).toFixed(2)}). If this continues, expect a ${(changePerUnit * 10).toFixed(1)} decline over the next 10 periods. Investigate root causes.`,
        category: 'investigation',
        impact: Math.min(8, Math.round(t.confidence * 10))
      });
    } else if (t.trend === 'increasing') {
      recs.push({
        recommendation: `Growth Opportunity: ${t.column} is increasing at ${changePerUnit.toFixed(2)} per period. Project ${(changePerUnit * 10).toFixed(1)} increase over next 10 periods. Ensure infrastructure and resources can support this growth.`,
        category: 'strategic',
        impact: Math.min(7, Math.round(t.confidence * 8))
      });
    }
  });

  // Pareto-driven recommendations
  const paretoPatterns = patterns.filter(p => p.type === 'pareto');
  paretoPatterns.forEach(p => {
    recs.push({
      recommendation: `Focus Strategy: ${p.description} Concentrate efforts on the vital few ${p.columns[0]} categories for maximum ROI.`,
      category: 'strategic',
      impact: 8
    });
  });

  // Non-linear relationship recommendations
  if (nonLinearCorrelations && nonLinearCorrelations.length > 0) {
    const nonLinear = nonLinearCorrelations.filter(r => r.isNonLinear);
    if (nonLinear.length > 0) {
      recs.push({
        recommendation: `Non-Linear Models: ${nonLinear.length} variable pair(s) show non-linear relationships (e.g., ${nonLinear[0].column1} & ${nonLinear[0].column2}). Standard linear analysis underestimates these. Use polynomial or log-transformed models for ${Math.round((1 - Math.abs(nonLinear[0].pearsonCoefficient) / Math.abs(nonLinear[0].spearmanCoefficient)) * 100)}% better fit.`,
        category: 'strategic',
        impact: 6
      });
    }
  }

  // Lag correlation recommendations
  if (lagCorrelations && lagCorrelations.length > 0) {
    const topLag = lagCorrelations[0];
    recs.push({
      recommendation: `Leading Indicator: ${topLag.column1} predicts ${topLag.column2} with ${topLag.bestLag}-period lag (r=${topLag.lagCorrelation.toFixed(3)}). Use ${topLag.column1} as an early warning system for ${topLag.column2} changes.`,
      category: 'strategic',
      impact: 8
    });
  }

  // Bimodal distribution recommendations
  const bimodalPatterns = patterns.filter(p => p.type === 'bimodal_distribution');
  bimodalPatterns.forEach(p => {
    recs.push({
      recommendation: `Segmentation Opportunity: ${p.columns[0]} has two distinct groups. Segment analysis for each group separately to uncover hidden patterns and tailor strategies.`,
      category: 'investigation',
      impact: 6
    });
  });

  // Sort by impact
  return recs.sort((a, b) => b.impact - a.impact);
};

/**
 * Enhanced executive summary with cross-dataset and advanced insights
 */
export const generateEnhancedExecutiveSummary = (
  datasets: Dataset[],
  correlations: CorrelationResult[],
  trends: TrendResult[],
  anomalies: AnomalyResult[],
  patterns: PatternResult[],
  nonLinearCorrelations?: SpearmanCorrelationResult[],
  lagCorrelations?: LagCorrelationResult[],
  crossInsights?: DataInsight[]
): string => {
  const parts: string[] = [];
  const dataset = datasets[0];

  if (datasets.length === 1) {
    parts.push(`Analysis of "${dataset.name}": ${dataset.rowCount.toLocaleString()} rows, ${dataset.columns.length} columns.`);
  } else {
    parts.push(`Multi-table analysis of ${datasets.length} datasets (${datasets.map(d => d.name).join(', ')}) with ${datasets.reduce((s, d) => s + d.rowCount, 0).toLocaleString()} total rows.`);
  }

  // Key findings count
  const strongCorrelations = correlations.filter(c => c.strength === 'strong');
  const significantTrends = trends.filter(t => t.trend !== 'stable' && t.confidence > 0.5);
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
  const nonLinear = nonLinearCorrelations?.filter(r => r.isNonLinear) || [];

  const findingsSummary: string[] = [];
  if (strongCorrelations.length > 0) findingsSummary.push(`${strongCorrelations.length} strong correlation(s)`);
  if (significantTrends.length > 0) findingsSummary.push(`${significantTrends.length} significant trend(s)`);
  if (criticalAnomalies.length > 0) findingsSummary.push(`${criticalAnomalies.length} critical anomaly(ies)`);
  if (nonLinear.length > 0) findingsSummary.push(`${nonLinear.length} non-linear relationship(s)`);
  if (lagCorrelations && lagCorrelations.length > 0) findingsSummary.push(`${lagCorrelations.length} leading indicator(s)`);

  if (findingsSummary.length > 0) {
    parts.push(`Key findings: ${findingsSummary.join(', ')}.`);
  }

  // Top insight
  if (strongCorrelations.length > 0) {
    const top = strongCorrelations[0];
    parts.push(`Strongest relationship: ${top.column1} and ${top.column2} (r=${top.coefficient.toFixed(3)}).`);
  }

  if (lagCorrelations && lagCorrelations.length > 0) {
    parts.push(`Leading indicator found: ${lagCorrelations[0].column1} predicts ${lagCorrelations[0].column2} by ${lagCorrelations[0].bestLag} periods.`);
  }

  const paretoPatterns = patterns.filter(p => p.type === 'pareto');
  if (paretoPatterns.length > 0) {
    parts.push(`Pareto effect detected: a small fraction of categories drives the majority of outcomes.`);
  }

  if (crossInsights && crossInsights.length > 0) {
    parts.push(`${crossInsights.length} cross-table insight(s) discovered from linked datasets.`);
  }

  return parts.join(' ');
};

/**
 * Enhanced async analysis — runs all Phase B6 analyses
 */
export const runEnhancedAIAnalysis = async (
  dataset: Dataset,
  allDatasets?: Dataset[],
  relationships?: Relationship[],
  onProgress?: (progress: number, message: string) => void
): Promise<AIInsightSummary & {
  nonLinearCorrelations: SpearmanCorrelationResult[];
  lagCorrelations: LagCorrelationResult[];
  crossDatasetInsights: DataInsight[];
  enhancedRecommendations: { recommendation: string; category: 'quick_win' | 'strategic' | 'investigation'; impact: number }[];
}> => {
  if (onProgress) onProgress(5, 'Detecting correlations...');
  await yieldToBrowser();
  const correlations = detectCorrelations(dataset);

  if (onProgress) onProgress(15, 'Analyzing non-linear relationships...');
  await yieldToBrowser();
  const nonLinearCorrelations = detectNonLinearCorrelations(dataset);

  if (onProgress) onProgress(25, 'Analyzing trends...');
  await yieldToBrowser();
  const trends = detectTrends(dataset);

  if (onProgress) onProgress(35, 'Detecting lag correlations...');
  await yieldToBrowser();
  const dateColumns = dataset.columns.filter(c => c.type === 'date');
  const lagCorrelations = detectLagCorrelations(dataset, dateColumns[0]?.name);

  if (onProgress) onProgress(45, 'Scanning for anomalies...');
  await yieldToBrowser();
  const anomalies = detectAnomalies(dataset);

  if (onProgress) onProgress(55, 'Identifying patterns...');
  await yieldToBrowser();
  const basicPatterns = detectPatterns(dataset);

  if (onProgress) onProgress(65, 'Detecting advanced patterns...');
  await yieldToBrowser();
  const enhancedPatterns = detectEnhancedPatterns(dataset);
  const patterns = [...basicPatterns, ...enhancedPatterns];

  if (onProgress) onProgress(75, 'Calculating data quality...');
  await yieldToBrowser();
  const dataQualityScore = calculateDataQualityScore(dataset);

  if (onProgress) onProgress(80, 'Generating cross-dataset insights...');
  await yieldToBrowser();
  const crossDatasetInsights = (allDatasets && relationships)
    ? generateCrossDatasetInsights(allDatasets, relationships)
    : [];

  if (onProgress) onProgress(88, 'Generating executive summary...');
  await yieldToBrowser();
  const executiveSummary = generateEnhancedExecutiveSummary(
    allDatasets || [dataset],
    correlations, trends, anomalies, patterns,
    nonLinearCorrelations, lagCorrelations, crossDatasetInsights
  );

  if (onProgress) onProgress(93, 'Generating recommendations...');
  await yieldToBrowser();
  const enhancedRecommendations = generateEnhancedRecommendations(
    dataset, correlations, trends, anomalies, patterns,
    nonLinearCorrelations, lagCorrelations
  );

  // Also generate legacy recommendations for backward compatibility
  const recommendations = enhancedRecommendations.map(r => r.recommendation);

  if (onProgress) onProgress(100, 'Enhanced analysis complete!');

  const criticalFindings =
    anomalies.filter(a => a.severity === 'critical').length +
    correlations.filter(c => c.strength === 'strong').length +
    trends.filter(t => t.trend !== 'stable' && t.confidence > 0.7).length +
    nonLinearCorrelations.filter(r => r.isNonLinear).length +
    lagCorrelations.length;

  return {
    totalInsights: correlations.length + trends.length + anomalies.length + patterns.length + nonLinearCorrelations.length + lagCorrelations.length + crossDatasetInsights.length,
    criticalFindings,
    correlations,
    trends,
    anomalies,
    patterns,
    executiveSummary,
    recommendations,
    dataQualityScore,
    analysisTimestamp: new Date(),
    nonLinearCorrelations,
    lagCorrelations,
    crossDatasetInsights,
    enhancedRecommendations
  };
};

/**
 * Quick insights for immediate display (optimized for speed)
 */
export const getQuickInsights = (dataset: Dataset): DataInsight[] => {
  const insights: DataInsight[] = [];
  
  // Quick correlation check (top 3 numeric columns only)
  const numericColumns = dataset.columns.filter(c => c.type === 'number').slice(0, 3);
  if (numericColumns.length >= 2) {
    const values1 = dataset.data.map(r => Number(r[numericColumns[0].name])).filter(v => !isNaN(v));
    const values2 = dataset.data.map(r => Number(r[numericColumns[1].name])).filter(v => !isNaN(v));
    
    if (values1.length > 5 && values2.length > 5) {
      const corr = calculateCorrelation(values1.slice(0, Math.min(values1.length, values2.length)), 
                                        values2.slice(0, Math.min(values1.length, values2.length)));
      if (Math.abs(corr) > 0.5) {
        insights.push({
          id: `corr-${numericColumns[0].name}-${numericColumns[1].name}`,
          type: 'correlation',
          title: 'Strong Correlation Detected',
          description: `${numericColumns[0].name} and ${numericColumns[1].name} show ${Math.abs(corr) > 0.7 ? 'strong' : 'moderate'} ${corr > 0 ? 'positive' : 'negative'} correlation (${(corr * 100).toFixed(0)}%)`,
          datasetId: dataset.id,
          relatedColumns: [numericColumns[0].name, numericColumns[1].name],
          value: corr
        });
      }
    }
  }
  
  // Quick missing data check
  dataset.columns.forEach(col => {
    const missingRatio = col.nullCount / dataset.rowCount;
    if (missingRatio > 0.2) {
      insights.push({
        id: `missing-${col.name}`,
        type: 'anomaly',
        title: 'High Missing Data',
        description: `${col.name} has ${(missingRatio * 100).toFixed(1)}% missing values`,
        severity: missingRatio > 0.5 ? 'high' : 'medium',
        datasetId: dataset.id,
        relatedColumns: [col.name],
        value: missingRatio
      });
    }
  });
  
  // Quick summary
  insights.push({
    id: `summary-${dataset.id}`,
    type: 'summary',
    title: 'Dataset Overview',
    description: `${dataset.rowCount.toLocaleString()} records with ${dataset.columns.length} columns (${dataset.columns.filter(c => c.type === 'number').length} numeric, ${dataset.columns.filter(c => c.type === 'string').length} categorical)`,
    datasetId: dataset.id
  });
  
  return insights;
};
