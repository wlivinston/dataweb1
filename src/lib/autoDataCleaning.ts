// Automated Data Cleaning - One-click solution to fix all data quality issues
// Intelligently applies cleaning operations based on AI recommendations

import { Dataset, AIInsightSummary } from './types';
import {
  removeDuplicates,
  removeMissingRows,
  fillMissingWithMean,
  fillMissingWithMedian,
  fillMissingWithDefault,
  trimWhitespace,
  removeOutliers,
  CleaningResult
} from './dataCleaningUtils';
import { updateDatasetStats } from './dataUtils';
import { calculateDataQualityScore } from './aiInsightEngine';

export interface AutoCleaningPlan {
  operations: Array<{
    type: string;
    description: string;
    columns?: string[];
    priority: number;
  }>;
  estimatedQualityImprovement: number;
  estimatedRowsRemoved: number;
}

export interface AutoCleaningResult {
  cleanedDataset: Dataset;
  operationsPerformed: string[];
  qualityBefore: number;
  qualityAfter: number;
  rowsRemoved: number;
  details: Array<{
    operation: string;
    impact: string;
  }>;
}

/**
 * Analyze dataset and create an automated cleaning plan
 */
export const createCleaningPlan = (
  dataset: Dataset,
  aiInsights?: AIInsightSummary | null
): AutoCleaningPlan => {
  const operations: AutoCleaningPlan['operations'] = [];
  let estimatedRowsRemoved = 0;
  
  // 1. Remove duplicates (highest priority - no data loss risk)
  const uniqueRows = new Set(dataset.data.map(row => JSON.stringify(row))).size;
  const duplicateCount = dataset.rowCount - uniqueRows;
  if (duplicateCount > 0) {
    operations.push({
      type: 'removeDuplicates',
      description: `Remove ${duplicateCount} duplicate rows`,
      priority: 1
    });
    estimatedRowsRemoved += duplicateCount;
  }
  
  // 2. Handle missing values based on column type and percentage
  dataset.columns.forEach(col => {
    const missingPercentage = (col.nullCount / dataset.rowCount) * 100;
    
    if (missingPercentage > 50) {
      // If >50% missing, recommend removal
      operations.push({
        type: 'removeColumn',
        description: `Remove column "${col.name}" (${missingPercentage.toFixed(1)}% missing)`,
        columns: [col.name],
        priority: 2
      });
    } else if (missingPercentage > 10 && missingPercentage <= 50) {
      // If 10-50% missing, impute based on type
      if (col.type === 'number') {
        operations.push({
          type: 'fillMissingNumeric',
          description: `Fill missing values in "${col.name}" with median (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 3
        });
      } else if (col.type === 'string') {
        operations.push({
          type: 'fillMissingString',
          description: `Fill missing values in "${col.name}" with "Unknown" (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 3
        });
      } else if (col.type === 'date') {
        operations.push({
          type: 'fillMissingDate',
          description: `Fill missing dates in "${col.name}" with mode value (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 3
        });
      } else if (col.type === 'boolean') {
        operations.push({
          type: 'fillMissingBoolean',
          description: `Fill missing booleans in "${col.name}" with false (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 3
        });
      }
    } else if (missingPercentage > 0 && missingPercentage <= 10) {
      // If <10% missing, fill with appropriate defaults
      if (col.type === 'number') {
        operations.push({
          type: 'fillMissingNumeric',
          description: `Fill missing values in "${col.name}" with mean (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 4
        });
      } else if (col.type === 'string') {
        operations.push({
          type: 'fillMissingString',
          description: `Fill missing values in "${col.name}" with empty string (${missingPercentage.toFixed(1)}% missing)`,
          columns: [col.name],
          priority: 4
        });
      }
    }
  });
  
  // 3. Trim whitespace from string columns
  const stringColumns = dataset.columns
    .filter(col => col.type === 'string')
    .map(col => col.name);
  if (stringColumns.length > 0) {
    operations.push({
      type: 'trimWhitespace',
      description: `Trim whitespace from ${stringColumns.length} string columns`,
      columns: stringColumns,
      priority: 5
    });
  }
  
  // 4. Remove rows with all null values
  const rowsWithAllNulls = dataset.data.filter(row => {
    return dataset.columns.every(col => {
      const val = row[col.name];
      return val === null || val === undefined || val === '';
    });
  }).length;
  
  if (rowsWithAllNulls > 0) {
    operations.push({
      type: 'removeEmptyRows',
      description: `Remove ${rowsWithAllNulls} completely empty rows`,
      priority: 2
    });
    estimatedRowsRemoved += rowsWithAllNulls;
  }
  
  // Calculate estimated quality improvement
  const currentQuality = calculateDataQualityScore(dataset);
  const totalCells = dataset.rowCount * dataset.columns.length;
  const currentMissing = dataset.columns.reduce((sum, col) => sum + col.nullCount, 0);
  const estimatedMissingAfter = Math.max(0, currentMissing - (estimatedRowsRemoved * dataset.columns.length));
  const estimatedQuality = totalCells > 0 
    ? Math.min(100, Math.round(((totalCells - estimatedMissingAfter) / totalCells) * 100))
    : 100;
  const estimatedImprovement = estimatedQuality - currentQuality;
  
  return {
    operations: operations.sort((a, b) => a.priority - b.priority),
    estimatedQualityImprovement: estimatedImprovement,
    estimatedRowsRemoved
  };
};

/**
 * Helper to yield control to browser
 */
const yieldToBrowser = (): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * Execute automated cleaning plan (async version with progress)
 */
export const executeAutoCleaningAsync = async (
  dataset: Dataset,
  plan?: AutoCleaningPlan,
  aiInsights?: AIInsightSummary | null,
  onProgress?: (progress: number, message: string) => void
): Promise<AutoCleaningResult> => {
  const qualityBefore = calculateDataQualityScore(dataset);
  let currentDataset = { ...dataset };
  const operationsPerformed: string[] = [];
  const details: AutoCleaningResult['details'] = [];
  let totalRowsRemoved = 0;
  
  // Use provided plan or create one
  const cleaningPlan = plan || createCleaningPlan(dataset, aiInsights);
  const totalOperations = cleaningPlan.operations.length;
  
  if (totalOperations === 0) {
    return {
      cleanedDataset: dataset,
      operationsPerformed: [],
      qualityBefore,
      qualityAfter: qualityBefore,
      rowsRemoved: 0,
      details: []
    };
  }
  
  // Execute operations in priority order with progress updates
  for (let i = 0; i < cleaningPlan.operations.length; i++) {
    const operation = cleaningPlan.operations[i];
    const progress = ((i + 1) / totalOperations) * 100;
    
    if (onProgress) {
      onProgress(progress * 0.9, `Applying: ${operation.description}`);
    }
    await yieldToBrowser();
    
    try {
      let result: CleaningResult | null = null;
      
      switch (operation.type) {
        case 'removeDuplicates':
          result = removeDuplicates(currentDataset);
          currentDataset = result.dataset;
          operationsPerformed.push('Removed duplicates');
          details.push({
            operation: 'Remove Duplicates',
            impact: `Removed ${result.rowsRemoved} duplicate rows`
          });
          totalRowsRemoved += result.rowsRemoved;
          break;
          
        case 'removeEmptyRows':
          result = removeMissingRows(currentDataset);
          currentDataset = result.dataset;
          operationsPerformed.push('Removed empty rows');
          details.push({
            operation: 'Remove Empty Rows',
            impact: `Removed ${result.rowsRemoved} completely empty rows`
          });
          totalRowsRemoved += result.rowsRemoved;
          break;
          
        case 'fillMissingNumeric':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'number') {
                result = fillMissingWithMedian(currentDataset, colName);
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing values in ${colName} with median`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with median`
                });
                await yieldToBrowser();
              }
            }
          }
          break;
          
        case 'fillMissingString':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'string') {
                result = fillMissingWithDefault(currentDataset, colName, 'Unknown');
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing values in ${colName} with "Unknown"`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with "Unknown"`
                });
                await yieldToBrowser();
              }
            }
          }
          break;
          
        case 'fillMissingDate':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'date') {
                const dates = currentDataset.data
                  .map(row => row[colName])
                  .filter(d => d !== null && d !== undefined && d !== '');
                
                if (dates.length > 0) {
                  const dateCounts: Record<string, number> = {};
                  dates.forEach(d => {
                    const dateStr = String(d);
                    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
                  });
                  
                  const modeDate = Object.entries(dateCounts)
                    .sort((a, b) => b[1] - a[1])[0]?.[0] || dates[0];
                  
                  result = fillMissingWithDefault(currentDataset, colName, modeDate);
                  currentDataset = result.dataset;
                  operationsPerformed.push(`Filled missing dates in ${colName} with mode value`);
                  details.push({
                    operation: `Fill Missing: ${colName}`,
                    impact: `Filled ${col.nullCount} missing dates with mode value`
                  });
                  await yieldToBrowser();
                }
              }
            }
          }
          break;
          
        case 'fillMissingBoolean':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'boolean') {
                result = fillMissingWithDefault(currentDataset, colName, false);
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing booleans in ${colName} with false`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with false`
                });
                await yieldToBrowser();
              }
            }
          }
          break;
          
        case 'trimWhitespace':
          if (operation.columns && operation.columns.length > 0) {
            result = trimWhitespace(currentDataset, operation.columns);
            currentDataset = result.dataset;
            operationsPerformed.push(`Trimmed whitespace from ${operation.columns.length} columns`);
            details.push({
              operation: 'Trim Whitespace',
              impact: `Cleaned whitespace in ${operation.columns.length} string columns`
            });
          }
          break;
          
        case 'removeColumn':
          if (operation.columns && operation.columns.length > 0) {
            const columnsToKeep = currentDataset.columns.filter(
              col => !operation.columns!.includes(col.name)
            );
            const cleanedData = currentDataset.data.map(row => {
              const newRow: any = {};
              columnsToKeep.forEach(col => {
                newRow[col.name] = row[col.name];
              });
              return newRow;
            });
            
            currentDataset = {
              ...currentDataset,
              columns: columnsToKeep,
              data: cleanedData,
              rowCount: cleanedData.length,
              dataTypes: Object.fromEntries(columnsToKeep.map(col => [col.name, col.type])),
              updatedAt: new Date()
            };
            
            operationsPerformed.push(`Removed ${operation.columns.length} columns with >50% missing data`);
            details.push({
              operation: 'Remove Low-Quality Columns',
              impact: `Removed columns: ${operation.columns.join(', ')}`
            });
          }
          break;
      }
      
      // Update dataset stats after each operation
      if (result) {
        currentDataset = updateDatasetStats(currentDataset);
        await yieldToBrowser();
      }
    } catch (error) {
      console.warn(`Failed to execute operation ${operation.type}:`, error);
      // Continue with next operation
    }
  }
  
  if (onProgress) {
    onProgress(95, 'Finalizing cleaned dataset...');
  }
  await yieldToBrowser();
  
  // Final stats update
  currentDataset = updateDatasetStats(currentDataset);
  const qualityAfter = calculateDataQualityScore(currentDataset);
  
  if (onProgress) {
    onProgress(100, 'Cleaning complete!');
  }
  
  return {
    cleanedDataset: currentDataset,
    operationsPerformed,
    qualityBefore,
    qualityAfter,
    rowsRemoved: totalRowsRemoved,
    details
  };
};

/**
 * Execute automated cleaning plan (synchronous version for backward compatibility)
 */
export const executeAutoCleaning = (
  dataset: Dataset,
  plan?: AutoCleaningPlan,
  aiInsights?: AIInsightSummary | null
): AutoCleaningResult => {
  const qualityBefore = calculateDataQualityScore(dataset);
  let currentDataset = { ...dataset };
  const operationsPerformed: string[] = [];
  const details: AutoCleaningResult['details'] = [];
  let totalRowsRemoved = 0;
  
  // Use provided plan or create one
  const cleaningPlan = plan || createCleaningPlan(dataset, aiInsights);
  
  // Execute operations in priority order
  for (const operation of cleaningPlan.operations) {
    try {
      let result: CleaningResult | null = null;
      
      switch (operation.type) {
        case 'removeDuplicates':
          result = removeDuplicates(currentDataset);
          currentDataset = result.dataset;
          operationsPerformed.push('Removed duplicates');
          details.push({
            operation: 'Remove Duplicates',
            impact: `Removed ${result.rowsRemoved} duplicate rows`
          });
          totalRowsRemoved += result.rowsRemoved;
          break;
          
        case 'removeEmptyRows':
          result = removeMissingRows(currentDataset);
          currentDataset = result.dataset;
          operationsPerformed.push('Removed empty rows');
          details.push({
            operation: 'Remove Empty Rows',
            impact: `Removed ${result.rowsRemoved} completely empty rows`
          });
          totalRowsRemoved += result.rowsRemoved;
          break;
          
        case 'fillMissingNumeric':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'number') {
                result = fillMissingWithMedian(currentDataset, colName);
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing values in ${colName} with median`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with median`
                });
              }
            }
          }
          break;
          
        case 'fillMissingString':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'string') {
                result = fillMissingWithDefault(currentDataset, colName, 'Unknown');
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing values in ${colName} with "Unknown"`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with "Unknown"`
                });
              }
            }
          }
          break;
          
        case 'fillMissingDate':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'date') {
                const dates = currentDataset.data
                  .map(row => row[colName])
                  .filter(d => d !== null && d !== undefined && d !== '');
                
                if (dates.length > 0) {
                  const dateCounts: Record<string, number> = {};
                  dates.forEach(d => {
                    const dateStr = String(d);
                    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
                  });
                  
                  const modeDate = Object.entries(dateCounts)
                    .sort((a, b) => b[1] - a[1])[0]?.[0] || dates[0];
                  
                  result = fillMissingWithDefault(currentDataset, colName, modeDate);
                  currentDataset = result.dataset;
                  operationsPerformed.push(`Filled missing dates in ${colName} with mode value`);
                  details.push({
                    operation: `Fill Missing: ${colName}`,
                    impact: `Filled ${col.nullCount} missing dates with mode value`
                  });
                }
              }
            }
          }
          break;
          
        case 'fillMissingBoolean':
          if (operation.columns && operation.columns.length > 0) {
            for (const colName of operation.columns) {
              const col = currentDataset.columns.find(c => c.name === colName);
              if (col && col.type === 'boolean') {
                result = fillMissingWithDefault(currentDataset, colName, false);
                currentDataset = result.dataset;
                operationsPerformed.push(`Filled missing booleans in ${colName} with false`);
                details.push({
                  operation: `Fill Missing: ${colName}`,
                  impact: `Filled ${col.nullCount} missing values with false`
                });
              }
            }
          }
          break;
          
        case 'trimWhitespace':
          if (operation.columns && operation.columns.length > 0) {
            result = trimWhitespace(currentDataset, operation.columns);
            currentDataset = result.dataset;
            operationsPerformed.push(`Trimmed whitespace from ${operation.columns.length} columns`);
            details.push({
              operation: 'Trim Whitespace',
              impact: `Cleaned whitespace in ${operation.columns.length} string columns`
            });
          }
          break;
          
        case 'removeColumn':
          if (operation.columns && operation.columns.length > 0) {
            const columnsToKeep = currentDataset.columns.filter(
              col => !operation.columns!.includes(col.name)
            );
            const cleanedData = currentDataset.data.map(row => {
              const newRow: any = {};
              columnsToKeep.forEach(col => {
                newRow[col.name] = row[col.name];
              });
              return newRow;
            });
            
            currentDataset = {
              ...currentDataset,
              columns: columnsToKeep,
              data: cleanedData,
              rowCount: cleanedData.length,
              dataTypes: Object.fromEntries(columnsToKeep.map(col => [col.name, col.type])),
              updatedAt: new Date()
            };
            
            operationsPerformed.push(`Removed ${operation.columns.length} columns with >50% missing data`);
            details.push({
              operation: 'Remove Low-Quality Columns',
              impact: `Removed columns: ${operation.columns.join(', ')}`
            });
          }
          break;
      }
      
      // Update dataset stats after each operation
      if (result) {
        currentDataset = updateDatasetStats(currentDataset);
      }
    } catch (error) {
      console.warn(`Failed to execute operation ${operation.type}:`, error);
      // Continue with next operation
    }
  }
  
  // Final stats update
  currentDataset = updateDatasetStats(currentDataset);
  const qualityAfter = calculateDataQualityScore(currentDataset);
  
  return {
    cleanedDataset: currentDataset,
    operationsPerformed,
    qualityBefore,
    qualityAfter,
    rowsRemoved: totalRowsRemoved,
    details
  };
};

/**
 * Quick fix for specific recommendation
 */
export const quickFixRecommendation = (
  dataset: Dataset,
  recommendation: string
): CleaningResult | null => {
  // Parse recommendation text to determine action
  const lowerRec = recommendation.toLowerCase();
  
  // Check for missing data recommendation
  if (lowerRec.includes('missing') && lowerRec.includes('imputing')) {
    // Extract column names from recommendation
    const columnMatch = recommendation.match(/imputing or removing ([^,]+(?:, [^,]+)*)/);
    if (columnMatch) {
      const columnNames = columnMatch[1].split(',').map(c => c.trim());
      
      // Apply appropriate filling strategy for each column
      let result: CleaningResult | null = null;
      let currentDataset = dataset;
      
      columnNames.forEach(colName => {
        const col = dataset.columns.find(c => c.name === colName);
        if (col) {
          if (col.type === 'number') {
            result = fillMissingWithMedian(currentDataset, colName);
          } else if (col.type === 'string') {
            result = fillMissingWithDefault(currentDataset, colName, 'Unknown');
          } else if (col.type === 'boolean') {
            result = fillMissingWithDefault(currentDataset, colName, false);
          }
          
          if (result) {
            currentDataset = result.dataset;
          }
        }
      });
      
      return result;
    }
  }
  
  // Check for duplicate removal
  if (lowerRec.includes('duplicate')) {
    return removeDuplicates(dataset);
  }
  
  // Check for whitespace trimming
  if (lowerRec.includes('whitespace') || lowerRec.includes('trim')) {
    return trimWhitespace(dataset);
  }
  
  return null;
};
