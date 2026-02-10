// Data Optimization Utilities - Prevents crashes with large datasets
// Implements sampling, pagination, and memory management

import { Dataset } from './types';

// Maximum safe limits for rendering
export const RENDERING_LIMITS = {
  MAX_TABLE_ROWS: 1000, // Maximum rows to render in a table
  MAX_CHART_POINTS: 500, // Maximum data points in charts
  MAX_PDF_ROWS: 500, // Maximum rows to include in PDF
  MAX_COLUMNS_DISPLAY: 20, // Maximum columns to display at once
  CHUNK_SIZE: 100, // Size of chunks for processing
  MEMORY_THRESHOLD_MB: 50 // Warn if dataset exceeds this size
};

/**
 * Calculate approximate memory size of dataset in MB
 */
export const estimateDatasetSize = (dataset: Dataset): number => {
  const rowSize = dataset.columns.length * 50; // Approximate bytes per cell
  const totalBytes = dataset.rowCount * rowSize;
  return totalBytes / (1024 * 1024); // Convert to MB
};

/**
 * Check if dataset is too large for safe rendering
 */
export const isDatasetTooLarge = (dataset: Dataset): boolean => {
  const sizeMB = estimateDatasetSize(dataset);
  return sizeMB > RENDERING_LIMITS.MEMORY_THRESHOLD_MB || 
         dataset.rowCount > 100000 ||
         dataset.columns.length > 50;
};

/**
 * Sample data intelligently for visualization
 */
export const sampleDataForVisualization = (
  data: any[],
  maxPoints: number = RENDERING_LIMITS.MAX_CHART_POINTS
): any[] => {
  if (data.length <= maxPoints) {
    return data;
  }

  // Use systematic sampling for better representation
  const step = Math.ceil(data.length / maxPoints);
  const sampled: any[] = [];
  
  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[i]);
    if (sampled.length >= maxPoints) break;
  }
  
  // Always include first and last points
  if (sampled[0] !== data[0]) {
    sampled.unshift(data[0]);
  }
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]);
  }
  
  return sampled.slice(0, maxPoints);
};

/**
 * Aggregate data for large datasets
 */
export const aggregateDataForChart = (
  data: any[],
  categoryKey: string,
  valueKey: string,
  maxCategories: number = 50
): any[] => {
  if (data.length <= maxCategories) {
    return data;
  }

  // Group and aggregate
  const grouped: Record<string, number> = {};
  
  data.forEach(item => {
    const category = String(item[categoryKey] || 'Other');
    const value = typeof item[valueKey] === 'number' ? item[valueKey] : Number(item[valueKey]) || 0;
    grouped[category] = (grouped[category] || 0) + value;
  });

  // Sort by value and take top N
  const sorted = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCategories - 1)
    .map(([category, value]) => ({
      [categoryKey]: category,
      [valueKey]: value
    }));

  // Add "Others" category if there are more
  const totalOthers = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(maxCategories - 1)
    .reduce((sum, [, value]) => sum + value, 0);

  if (totalOthers > 0) {
    sorted.push({
      [categoryKey]: 'Others',
      [valueKey]: totalOthers
    });
  }

  return sorted;
};

/**
 * Get paginated data for tables
 */
export const getPaginatedData = (
  data: any[],
  page: number = 1,
  pageSize: number = 100
): { data: any[]; totalPages: number; totalRows: number } => {
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = data.slice(startIndex, endIndex);
  const totalPages = Math.ceil(data.length / pageSize);

  return {
    data: paginatedData,
    totalPages,
    totalRows: data.length
  };
};

/**
 * Limit dataset for safe processing
 */
export const createSafeDataset = (dataset: Dataset): Dataset => {
  if (!isDatasetTooLarge(dataset)) {
    return dataset;
  }

  // Create a sampled version
  const sampleSize = Math.min(10000, dataset.rowCount);
  const step = Math.ceil(dataset.rowCount / sampleSize);
  const sampledData: any[] = [];

  for (let i = 0; i < dataset.data.length; i += step) {
    sampledData.push(dataset.data[i]);
    if (sampledData.length >= sampleSize) break;
  }

  return {
    ...dataset,
    data: sampledData,
    rowCount: sampledData.length,
    updatedAt: new Date()
  };
};

/**
 * Optimize visualization data
 */
export const optimizeVisualizationData = (
  data: any[],
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'table'
): any[] => {
  if (type === 'table') {
    // For tables, just limit rows
    return data.slice(0, RENDERING_LIMITS.MAX_TABLE_ROWS);
  }

  if (type === 'pie') {
    // For pie charts, aggregate if too many categories
    if (data.length > 20) {
      // Aggregate small slices into "Others"
      const sorted = [...data].sort((a, b) => {
        const valA = typeof a.value === 'number' ? a.value : Number(a.value) || 0;
        const valB = typeof b.value === 'number' ? b.value : Number(b.value) || 0;
        return valB - valA;
      });
      
      const top = sorted.slice(0, 19);
      const others = sorted.slice(19);
      
      if (others.length > 0) {
        const othersValue = others.reduce((sum, item) => {
          const val = typeof item.value === 'number' ? item.value : Number(item.value) || 0;
          return sum + val;
        }, 0);
        
        return [...top, { category: 'Others', value: othersValue }];
      }
      
      return top;
    }
    return data;
  }

  // For line/bar/area charts, sample data points
  return sampleDataForVisualization(data, RENDERING_LIMITS.MAX_CHART_POINTS);
};

/**
 * Check if operation should be cancelled due to size
 */
export const shouldCancelOperation = (dataset: Dataset, operation: string): boolean => {
  const sizeMB = estimateDatasetSize(dataset);
  
  // Cancel PDF generation for very large datasets
  if (operation === 'pdf' && sizeMB > 100) {
    return true;
  }
  
  // Cancel visualization for extremely large datasets
  if (operation === 'visualization' && dataset.rowCount > 500000) {
    return true;
  }
  
  return false;
};

/**
 * Get performance warning message
 */
export const getPerformanceWarning = (dataset: Dataset): string | null => {
  const sizeMB = estimateDatasetSize(dataset);
  
  if (sizeMB > 100) {
    return `Large dataset detected (${sizeMB.toFixed(1)} MB). Some features may be limited for performance.`;
  }
  
  if (dataset.rowCount > 50000) {
    return `Large dataset with ${dataset.rowCount.toLocaleString()} rows. Visualizations will show sampled data.`;
  }
  
  return null;
};
