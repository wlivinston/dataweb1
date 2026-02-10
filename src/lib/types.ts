// Shared types for the analytics platform
// This file centralizes all data-related types to avoid duplication

export type DataType = 'string' | 'number' | 'date' | 'boolean';

export interface ColumnInfo {
  name: string;
  type: DataType;
  sampleValues: any[];
  nullCount: number;
  uniqueCount: number;
  min?: number;
  max?: number;
  mean?: number;
  // Custom field properties
  isCustom?: boolean;
  isRequired?: boolean;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    custom?: (value: any) => boolean;
  };
}

export interface Dataset {
  id: string;
  name: string;
  file?: File;
  description: string;
  columns: ColumnInfo[];
  rowCount: number;
  dataTypes: { [key: string]: DataType };
  data: any[];
  createdAt?: Date;
  updatedAt?: Date;
  // Metadata
  tags?: string[];
  category?: string;
}

export interface Observation {
  id: string;
  data: { [key: string]: any };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DAXCalculation {
  id: string;
  name: string;
  formula: string;
  description: string;
  category: 'aggregation' | 'time' | 'statistical' | 'text' | 'logical';
  applicable: boolean;
  confidence: number;
  result?: any;
}

export interface Visualization {
  id: string;
  title: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'table' | 'gauge';
  data: any;
  colors: string[];
  gradient: string;
  daxCalculations: DAXCalculation[];
  datasetId: string;
}

export interface Relationship {
  id: string;
  fromDataset: string;
  toDataset: string;
  fromColumn: string;
  toColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  confidence: number;
  schemaType?: 'star' | 'snowflake';
  isFactTable?: boolean;
  isDimensionTable?: boolean;
}

export type SchemaType = 'none' | 'star' | 'snowflake' | 'flat';

// Schema detection types
export interface TableClassification {
  datasetId: string;
  datasetName: string;
  role: 'fact' | 'dimension' | 'date_dimension' | 'bridge' | 'unknown';
  confidence: number;
  reasons: string[];
  metrics: {
    rowCount: number;
    numericColumnRatio: number;
    foreignKeyScore: number;
    cardinalityRatio: number;
    descriptiveColumnRatio: number;
    hasHighCardinality: boolean;
  };
}

export interface SchemaDetectionResult {
  schemaType: SchemaType;
  confidence: number;
  factTables: TableClassification[];
  dimensionTables: TableClassification[];
  relationships: any[]; // AutoDetectedRelationship[] - avoid circular import
  explanation: string;
  dimensionHierarchies: {
    parentDimension: string;
    childDimension: string;
    linkColumn: string;
  }[];
}

export interface DataInsight {
  id: string;
  type: 'trend' | 'anomaly' | 'correlation' | 'summary' | 'recommendation';
  title: string;
  description: string;
  severity?: 'low' | 'medium' | 'high';
  datasetId: string;
  relatedColumns?: string[];
  value?: any;
}

export interface ColorScheme {
  name: string;
  colors: string[];
}

// AI Insight types
export interface AIInsightSummary {
  totalInsights: number;
  criticalFindings: number;
  correlations: any[];
  trends: any[];
  anomalies: any[];
  patterns: any[];
  executiveSummary: string;
  recommendations: string[];
  dataQualityScore: number;
  analysisTimestamp: Date;
}

// Composite view types
export interface CompositeDataView {
  id: string;
  name: string;
  sourceDatasets: string[];
  relationships: Relationship[];
  mergedData: any[];
  columns: ColumnInfo[];
  rowCount: number;
  joinType: 'inner' | 'left' | 'right' | 'full';
  createdAt: Date;
}

// Query result types
export interface QueryResult {
  success: boolean;
  query: string;
  interpretation: string;
  result: any;
  resultType: 'number' | 'table' | 'chart' | 'text' | 'comparison';
  suggestedVisualization?: Partial<Visualization>;
  explanation: string;
  confidence: number;
  alternativeQueries?: string[];
}

// ============================================================
// Phase B: Enhanced Analytics Engine Types
// ============================================================

// Time Series types
export interface DateHierarchy {
  year: number;
  quarter: number;
  month: number;
  week: number;
  dayOfWeek: number;
  dayOfMonth: number;
  date: Date;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

export interface GrowthRate {
  period: string;
  currentValue: number;
  previousValue: number;
  absoluteChange: number;
  percentageChange: number;
}

export interface TimeSeriesResult {
  column: string;
  dateColumn: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  trend: number[];
  seasonal: number[];
  residual: number[];
  movingAverage: number[];
  forecast: TimeSeriesPoint[];
  growthRates: GrowthRate[];
  seasonalityStrength: number;
  decompositionDates: string[];
}

export interface DateTableInfo {
  datasetId: string;
  datasetName: string;
  columnName: string;
  isDateTable: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular';
  dateRange: { min: Date; max: Date };
  gaps: number;
  coverage: number; // 0-1, how complete the date range is
  totalDates: number;
  uniqueDates: number;
}

export interface AggregatedTimeSeries {
  period: string;
  sum: number;
  avg: number;
  count: number;
  min: number;
  max: number;
}

// Advanced Statistics types
export interface HypothesisTestResult {
  testName: string;
  statistic: number;
  pValue: number;
  degreesOfFreedom: number;
  significant: boolean;
  interpretation: string;
  confidenceLevel: number;
  effectSize?: number;
}

export interface ClusterResult {
  clusterId: number;
  centroid: Record<string, number>;
  size: number;
  members: number[]; // row indices
  characteristics: string;
}

export interface SegmentationResult {
  clusters: ClusterResult[];
  optimalK: number;
  silhouetteScore: number;
  interpretation: string;
  columns: string[];
  inertiaValues: number[]; // for elbow plot
}

export interface ParetoItem {
  category: string;
  value: number;
  cumulativePercent: number;
  isVital: boolean;
}

export interface ParetoResult {
  column: string;
  valueColumn: string;
  items: ParetoItem[];
  vitalFewCount: number;
  vitalFewPercent: number;
  interpretation: string;
}

export interface RegressionResult {
  type: 'linear' | 'multiple' | 'polynomial';
  coefficients: Record<string, number>;
  intercept: number;
  rSquared: number;
  adjustedRSquared: number;
  predictions: number[];
  residuals: number[];
  significantPredictors: string[];
  equation: string;
  interpretation: string;
  targetColumn: string;
  predictorColumns: string[];
}

export interface PercentileResult {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  iqr: number;
  lowerFence: number;
  upperFence: number;
  outlierCount: number;
  column: string;
}

export interface ConfidenceIntervalResult {
  mean: number;
  lower: number;
  upper: number;
  margin: number;
  confidenceLevel: number;
  sampleSize: number;
  standardError: number;
}

// Enhanced DAX types
export type EnhancedDAXFormula =
  | 'SUM' | 'AVERAGE' | 'COUNT' | 'COUNTROWS' | 'DISTINCTCOUNT'
  | 'MIN' | 'MAX' | 'MEDIAN' | 'STDDEV' | 'PERCENTAGE' | 'RATIO'
  // Time Intelligence
  | 'TOTALYTD' | 'TOTALQTD' | 'TOTALMTD'
  | 'SAMEPERIODLASTYEAR' | 'DATEADD'
  | 'YOY_CHANGE' | 'QOQ_CHANGE' | 'MOM_CHANGE'
  // Conditional
  | 'IF' | 'SWITCH'
  // Ranking
  | 'RANKX'
  // Cumulative
  | 'RUNNING_TOTAL' | 'CUMULATIVE_SUM'
  // Cross-table
  | 'RELATED' | 'LOOKUPVALUE'
  // Statistical
  | 'PERCENTILE' | 'VARIANCE' | 'CORRELATION';

export interface DAXFilterContext {
  column: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN';
  value: any;
}

export interface EnhancedDAXCalculation extends DAXCalculation {
  formulaType?: EnhancedDAXFormula;
  filterContext?: DAXFilterContext[];
  timeIntelligence?: {
    dateColumn: string;
    periodType: 'year' | 'quarter' | 'month';
    offset?: number;
  };
  crossTable?: {
    relatedDatasetId: string;
    lookupColumn: string;
    resultColumn: string;
  };
}

// Enhanced Relationship types
export interface IntegrityReport {
  relationshipId: string;
  orphanCount: number;
  orphanPercentage: number;
  unusedParentCount: number;
  unusedParentPercentage: number;
  matchRate: number;
  integrityScore: number; // 0-100
  issues: string[];
}

// Spearman correlation result
export interface SpearmanCorrelationResult {
  column1: string;
  column2: string;
  pearsonCoefficient: number;
  spearmanCoefficient: number;
  isNonLinear: boolean;
  interpretation: string;
}

// Lag correlation result
export interface LagCorrelationResult {
  column1: string;
  column2: string;
  bestLag: number;
  lagCorrelation: number;
  correlationsByLag: { lag: number; correlation: number }[];
  interpretation: string;
}

// Cohort analysis result
export interface CohortResult {
  cohorts: {
    cohortPeriod: string;
    initialSize: number;
    retention: { period: number; count: number; rate: number }[];
  }[];
  overallRetentionRate: number;
  interpretation: string;
}
