// Smart Data Connector - Auto-detects relationships and enables composite views
// Enhanced with date table detection, semantic matching, improved cardinality, and referential integrity

import { Dataset, ColumnInfo, Relationship, TableClassification, SchemaDetectionResult, SchemaType, DateTableInfo, IntegrityReport } from './types';
import { detectDateColumns } from './timeSeriesEngine';

export interface AutoDetectedRelationship extends Omit<Relationship, 'id'> {
  matchScore: number;
  matchingValues: number;
  totalValues: number;
  suggestion: string;
  autoJoinRecommended: boolean;
}

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

export interface DataStreamConnection {
  id: string;
  name: string;
  type: 'file' | 'api' | 'database' | 'realtime';
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
  lastSync?: Date;
  refreshInterval?: number;
  config?: Record<string, any>;
}

/**
 * Calculate similarity score between two column names
 */
const calculateNameSimilarity = (name1: string, name2: string): number => {
  const n1 = name1.toLowerCase().replace(/[_\-\s]/g, '');
  const n2 = name2.toLowerCase().replace(/[_\-\s]/g, '');
  
  // Exact match
  if (n1 === n2) return 1;
  
  // Contains match
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;
  
  // Common prefixes/suffixes (id, key, code, etc.)
  const commonKeys = ['id', 'key', 'code', 'no', 'num', 'number', 'ref', 'reference'];
  for (const key of commonKeys) {
    if ((n1.endsWith(key) && n2.endsWith(key)) || 
        (n1.startsWith(key) && n2.startsWith(key))) {
      // Check if base names are similar
      const base1 = n1.replace(key, '');
      const base2 = n2.replace(key, '');
      if (base1 === base2) return 0.9;
      if (base1.includes(base2) || base2.includes(base1)) return 0.7;
    }
  }
  
  // Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  const similarity = 1 - distance / maxLen;
  
  return similarity > 0.6 ? similarity * 0.6 : 0;
};

/**
 * Levenshtein distance calculation
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  
  return dp[m][n];
};

/**
 * Calculate value overlap between two columns
 */
const calculateValueOverlap = (
  dataset1: Dataset,
  col1: string,
  dataset2: Dataset,
  col2: string
): { matchCount: number; totalUnique: number; overlapRatio: number } => {
  const values1 = new Set(dataset1.data.map(r => String(r[col1] || '').toLowerCase().trim()));
  const values2 = new Set(dataset2.data.map(r => String(r[col2] || '').toLowerCase().trim()));
  
  // Remove empty values
  values1.delete('');
  values2.delete('');
  
  let matchCount = 0;
  values1.forEach(v => {
    if (values2.has(v)) matchCount++;
  });
  
  const totalUnique = new Set([...values1, ...values2]).size;
  const overlapRatio = totalUnique > 0 ? matchCount / Math.min(values1.size, values2.size) : 0;
  
  return { matchCount, totalUnique, overlapRatio };
};

/**
 * Auto-detect relationships between datasets
 */
export const autoDetectRelationships = (datasets: Dataset[]): AutoDetectedRelationship[] => {
  const relationships: AutoDetectedRelationship[] = [];
  
  if (datasets.length < 2) return relationships;
  
  // Compare each pair of datasets
  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const ds1 = datasets[i];
      const ds2 = datasets[j];
      
      // Compare each column pair
      for (const col1 of ds1.columns) {
        for (const col2 of ds2.columns) {
          // Skip if types don't match
          if (col1.type !== col2.type && 
              !(col1.type === 'string' && col2.type === 'string') &&
              !(col1.type === 'number' && col2.type === 'number')) {
            continue;
          }
          
          const nameSimilarity = calculateNameSimilarity(col1.name, col2.name);
          const { matchCount, totalUnique, overlapRatio } = calculateValueOverlap(ds1, col1.name, ds2, col2.name);
          
          // Calculate overall match score
          const matchScore = nameSimilarity * 0.4 + overlapRatio * 0.6;
          
          if (matchScore > 0.3 && matchCount > 0) {
            // Determine relationship type
            const uniqueIn1 = col1.uniqueCount;
            const uniqueIn2 = col2.uniqueCount;
            let relType: Relationship['type'] = 'many-to-many';
            
            if (uniqueIn1 === ds1.rowCount && uniqueIn2 < ds2.rowCount) {
              relType = 'one-to-many';
            } else if (uniqueIn2 === ds2.rowCount && uniqueIn1 < ds1.rowCount) {
              relType = 'one-to-many';
            } else if (uniqueIn1 === ds1.rowCount && uniqueIn2 === ds2.rowCount) {
              relType = 'one-to-one';
            }
            
            // Generate suggestion
            let suggestion = '';
            if (matchScore > 0.7) {
              suggestion = `Highly recommended join: ${col1.name} ↔ ${col2.name} (${(overlapRatio * 100).toFixed(0)}% value match)`;
            } else if (matchScore > 0.5) {
              suggestion = `Potential join candidate: ${col1.name} ↔ ${col2.name}. Verify data compatibility.`;
            } else {
              suggestion = `Possible relationship detected. Review values before joining.`;
            }
            
            relationships.push({
              fromDataset: ds1.id,
              toDataset: ds2.id,
              fromColumn: col1.name,
              toColumn: col2.name,
              type: relType,
              confidence: matchScore,
              matchScore,
              matchingValues: matchCount,
              totalValues: totalUnique,
              suggestion,
              autoJoinRecommended: matchScore > 0.6 && overlapRatio > 0.5,
              schemaType: undefined
            });
          }
        }
      }
    }
  }
  
  // Sort by match score and deduplicate
  return relationships
    .sort((a, b) => b.matchScore - a.matchScore)
    .filter((rel, index, self) => 
      index === self.findIndex(r => 
        (r.fromDataset === rel.fromDataset && r.toDataset === rel.toDataset && 
         r.fromColumn === rel.fromColumn && r.toColumn === rel.toColumn) ||
        (r.fromDataset === rel.toDataset && r.toDataset === rel.fromDataset && 
         r.fromColumn === rel.toColumn && r.toColumn === rel.fromColumn)
      )
    );
};

/**
 * Suggest the best join key between two datasets
 */
export const suggestJoinKey = (
  dataset1: Dataset,
  dataset2: Dataset
): { column1: string; column2: string; confidence: number; reason: string } | null => {
  const relationships = autoDetectRelationships([dataset1, dataset2]);
  
  if (relationships.length === 0) return null;
  
  const best = relationships[0];
  return {
    column1: best.fromColumn,
    column2: best.toColumn,
    confidence: best.confidence,
    reason: best.suggestion
  };
};

/**
 * Merge two datasets using detected or specified relationship
 */
export const mergeDatasets = (
  dataset1: Dataset,
  dataset2: Dataset,
  joinColumn1: string,
  joinColumn2: string,
  joinType: 'inner' | 'left' | 'right' | 'full' = 'left'
): { data: any[]; columns: ColumnInfo[] } => {
  // Create lookup map for dataset2
  const lookup = new Map<string, any[]>();
  dataset2.data.forEach(row => {
    const key = String(row[joinColumn2] || '').toLowerCase().trim();
    if (!lookup.has(key)) {
      lookup.set(key, []);
    }
    lookup.get(key)!.push(row);
  });
  
  // Get column names with prefixes to avoid conflicts
  const ds1Prefix = dataset1.name.split('.')[0].substring(0, 3).toLowerCase() + '_';
  const ds2Prefix = dataset2.name.split('.')[0].substring(0, 3).toLowerCase() + '_';
  
  // Rename conflicting columns
  const ds2Columns = dataset2.columns.map(col => ({
    ...col,
    name: dataset1.columns.some(c => c.name === col.name) && col.name !== joinColumn2
      ? `${ds2Prefix}${col.name}`
      : col.name
  }));
  
  const mergedData: any[] = [];
  const matchedKeys = new Set<string>();
  
  // Process dataset1
  dataset1.data.forEach(row1 => {
    const key = String(row1[joinColumn1] || '').toLowerCase().trim();
    const matchingRows = lookup.get(key) || [];
    matchedKeys.add(key);
    
    if (matchingRows.length > 0) {
      matchingRows.forEach(row2 => {
        const mergedRow: any = { ...row1 };
        ds2Columns.forEach(col => {
          const originalName = col.name.startsWith(ds2Prefix) 
            ? col.name.substring(ds2Prefix.length) 
            : col.name;
          mergedRow[col.name] = row2[originalName];
        });
        mergedData.push(mergedRow);
      });
    } else if (joinType === 'left' || joinType === 'full') {
      const mergedRow: any = { ...row1 };
      ds2Columns.forEach(col => {
        if (col.name !== joinColumn2) {
          mergedRow[col.name] = null;
        }
      });
      mergedData.push(mergedRow);
    }
  });
  
  // For right and full joins, add unmatched rows from dataset2
  if (joinType === 'right' || joinType === 'full') {
    dataset2.data.forEach(row2 => {
      const key = String(row2[joinColumn2] || '').toLowerCase().trim();
      if (!matchedKeys.has(key)) {
        const mergedRow: any = {};
        dataset1.columns.forEach(col => {
          mergedRow[col.name] = col.name === joinColumn1 ? row2[joinColumn2] : null;
        });
        ds2Columns.forEach(col => {
          const originalName = col.name.startsWith(ds2Prefix) 
            ? col.name.substring(ds2Prefix.length) 
            : col.name;
          mergedRow[col.name] = row2[originalName];
        });
        mergedData.push(mergedRow);
      }
    });
  }
  
  // Combine columns
  const allColumns = [
    ...dataset1.columns,
    ...ds2Columns.filter(c => c.name !== joinColumn2 || joinColumn1 !== joinColumn2)
  ];
  
  return { data: mergedData, columns: allColumns };
};

/**
 * Create a composite view from multiple datasets
 */
export const createCompositeView = (
  datasets: Dataset[],
  relationships: Relationship[],
  joinType: 'inner' | 'left' | 'right' | 'full' = 'left'
): CompositeDataView => {
  if (datasets.length === 0) {
    throw new Error('At least one dataset is required');
  }
  
  if (datasets.length === 1) {
    return {
      id: `composite-${Date.now()}`,
      name: `Composite View - ${datasets[0].name}`,
      sourceDatasets: [datasets[0].id],
      relationships: [],
      mergedData: datasets[0].data,
      columns: datasets[0].columns,
      rowCount: datasets[0].rowCount,
      joinType,
      createdAt: new Date()
    };
  }
  
  // Start with the first dataset
  let currentData = datasets[0].data;
  let currentColumns = datasets[0].columns;
  const usedDatasets = new Set([datasets[0].id]);
  
  // Iteratively join datasets based on relationships
  for (const rel of relationships) {
    const fromInCurrent = usedDatasets.has(rel.fromDataset);
    const toInCurrent = usedDatasets.has(rel.toDataset);
    
    if (fromInCurrent && !toInCurrent) {
      const toDataset = datasets.find(d => d.id === rel.toDataset);
      if (toDataset) {
        const result = mergeDatasets(
          { ...datasets[0], data: currentData, columns: currentColumns } as Dataset,
          toDataset,
          rel.fromColumn,
          rel.toColumn,
          joinType
        );
        currentData = result.data;
        currentColumns = result.columns;
        usedDatasets.add(rel.toDataset);
      }
    } else if (!fromInCurrent && toInCurrent) {
      const fromDataset = datasets.find(d => d.id === rel.fromDataset);
      if (fromDataset) {
        const result = mergeDatasets(
          fromDataset,
          { ...datasets[0], data: currentData, columns: currentColumns } as Dataset,
          rel.fromColumn,
          rel.toColumn,
          joinType
        );
        currentData = result.data;
        currentColumns = result.columns;
        usedDatasets.add(rel.fromDataset);
      }
    }
  }
  
  return {
    id: `composite-${Date.now()}`,
    name: `Composite View - ${datasets.map(d => d.name.split('.')[0]).join(' + ')}`,
    sourceDatasets: Array.from(usedDatasets),
    relationships,
    mergedData: currentData,
    columns: currentColumns,
    rowCount: currentData.length,
    joinType,
    createdAt: new Date()
  };
};

/**
 * Find common dimensions across multiple datasets
 */
export const findCommonDimensions = (datasets: Dataset[]): {
  dimension: string;
  datasets: string[];
  columns: { datasetId: string; columnName: string }[];
}[] => {
  const dimensionMap = new Map<string, { datasetId: string; columnName: string }[]>();
  
  datasets.forEach(ds => {
    ds.columns.forEach(col => {
      // Normalize column name for matching
      const normalizedName = col.name.toLowerCase()
        .replace(/[_\-\s]/g, '')
        .replace(/id$/, '')
        .replace(/key$/, '')
        .replace(/code$/, '');
      
      if (normalizedName.length > 2) {
        if (!dimensionMap.has(normalizedName)) {
          dimensionMap.set(normalizedName, []);
        }
        dimensionMap.get(normalizedName)!.push({
          datasetId: ds.id,
          columnName: col.name
        });
      }
    });
  });
  
  // Return dimensions present in multiple datasets
  return Array.from(dimensionMap.entries())
    .filter(([_, cols]) => {
      const uniqueDatasets = new Set(cols.map(c => c.datasetId));
      return uniqueDatasets.size > 1;
    })
    .map(([dimension, columns]) => ({
      dimension,
      datasets: Array.from(new Set(columns.map(c => c.datasetId))),
      columns
    }))
    .sort((a, b) => b.datasets.length - a.datasets.length);
};

/**
 * Generate join suggestions for analysts
 */
export const generateJoinSuggestions = (datasets: Dataset[]): {
  primary: AutoDetectedRelationship | null;
  alternatives: AutoDetectedRelationship[];
  explanation: string;
}[] => {
  const allRelationships = autoDetectRelationships(datasets);
  const suggestions: {
    primary: AutoDetectedRelationship | null;
    alternatives: AutoDetectedRelationship[];
    explanation: string;
  }[] = [];
  
  // Group relationships by dataset pairs
  const pairMap = new Map<string, AutoDetectedRelationship[]>();
  allRelationships.forEach(rel => {
    const key = [rel.fromDataset, rel.toDataset].sort().join('-');
    if (!pairMap.has(key)) {
      pairMap.set(key, []);
    }
    pairMap.get(key)!.push(rel);
  });
  
  pairMap.forEach((rels, key) => {
    const primary = rels[0];
    const alternatives = rels.slice(1, 4);
    
    const ds1 = datasets.find(d => d.id === primary.fromDataset);
    const ds2 = datasets.find(d => d.id === primary.toDataset);
    
    let explanation = '';
    if (primary.autoJoinRecommended) {
      explanation = `Recommended: Join ${ds1?.name || 'Dataset 1'} and ${ds2?.name || 'Dataset 2'} using ${primary.fromColumn} ↔ ${primary.toColumn}. ${(primary.matchScore * 100).toFixed(0)}% match confidence.`;
    } else if (primary.matchScore > 0.4) {
      explanation = `Potential join between ${ds1?.name || 'Dataset 1'} and ${ds2?.name || 'Dataset 2'}. Review data compatibility before joining.`;
    } else {
      explanation = `Weak relationship detected. Consider manual column mapping or data transformation.`;
    }
    
    suggestions.push({ primary, alternatives, explanation });
  });
  
  return suggestions;
};

/**
 * Validate a proposed relationship
 */
export const validateRelationship = (
  dataset1: Dataset,
  dataset2: Dataset,
  column1: string,
  column2: string
): {
  isValid: boolean;
  matchRate: number;
  orphanCount: { ds1: number; ds2: number };
  duplicateKeyCount: { ds1: number; ds2: number };
  warnings: string[];
  recommendations: string[];
} => {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  
  const values1 = dataset1.data.map(r => String(r[column1] || '').toLowerCase().trim());
  const values2 = dataset2.data.map(r => String(r[column2] || '').toLowerCase().trim());
  
  const set1 = new Set(values1.filter(v => v !== ''));
  const set2 = new Set(values2.filter(v => v !== ''));
  
  // Count matches
  let matchCount = 0;
  set1.forEach(v => {
    if (set2.has(v)) matchCount++;
  });
  
  const matchRate = set1.size > 0 ? matchCount / set1.size : 0;
  
  // Count orphans (values in one set but not the other)
  const orphans1 = Array.from(set1).filter(v => !set2.has(v)).length;
  const orphans2 = Array.from(set2).filter(v => !set1.has(v)).length;
  
  // Count duplicate keys
  const countMap1 = new Map<string, number>();
  const countMap2 = new Map<string, number>();
  values1.forEach(v => countMap1.set(v, (countMap1.get(v) || 0) + 1));
  values2.forEach(v => countMap2.set(v, (countMap2.get(v) || 0) + 1));
  
  const duplicates1 = Array.from(countMap1.values()).filter(c => c > 1).length;
  const duplicates2 = Array.from(countMap2.values()).filter(c => c > 1).length;
  
  // Generate warnings
  if (matchRate < 0.5) {
    warnings.push(`Low match rate (${(matchRate * 100).toFixed(1)}%). Many records won't join.`);
  }
  
  if (orphans1 > set1.size * 0.3) {
    warnings.push(`${orphans1} values in ${column1} have no match in ${column2}.`);
  }
  
  if (duplicates1 > 0 || duplicates2 > 0) {
    warnings.push(`Duplicate keys detected. This may result in row multiplication.`);
    recommendations.push(`Consider using aggregation before joining to avoid duplicates.`);
  }
  
  // Generate recommendations
  if (matchRate > 0.8) {
    recommendations.push(`High match rate. An inner join is recommended.`);
  } else if (matchRate > 0.5) {
    recommendations.push(`Moderate match rate. Consider left join to preserve all records from primary dataset.`);
  } else {
    recommendations.push(`Low match rate. Verify column selection or consider data cleaning first.`);
  }
  
  return {
    isValid: matchRate > 0.1,
    matchRate,
    orphanCount: { ds1: orphans1, ds2: orphans2 },
    duplicateKeyCount: { ds1: duplicates1, ds2: duplicates2 },
    warnings,
    recommendations
  };
};

/**
 * Sample a dataset for detection operations on large datasets
 */
export const sampleForDetection = (dataset: Dataset, maxRows: number = 5000): Dataset => {
  if (dataset.data.length <= maxRows) return dataset;

  const step = Math.ceil(dataset.data.length / maxRows);
  const sampledData = dataset.data.filter((_, i) => i % step === 0);

  return {
    ...dataset,
    data: sampledData,
    rowCount: sampledData.length
  };
};

/**
 * Classify a dataset as fact, dimension, or unknown table
 */
export const classifyTable = (dataset: Dataset, allDatasets: Dataset[]): TableClassification => {
  const reasons: string[] = [];

  const totalColumns = dataset.columns.length;
  if (totalColumns === 0) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      role: 'unknown',
      confidence: 0,
      reasons: ['No columns found'],
      metrics: { rowCount: 0, numericColumnRatio: 0, foreignKeyScore: 0, cardinalityRatio: 0, descriptiveColumnRatio: 0, hasHighCardinality: false }
    };
  }

  const numericColumns = dataset.columns.filter(c => c.type === 'number');
  const stringColumns = dataset.columns.filter(c => c.type === 'string');
  const dateColumns = dataset.columns.filter(c => c.type === 'date');

  const numericColumnRatio = numericColumns.length / totalColumns;
  const descriptiveColumnRatio = stringColumns.length / totalColumns;

  // FK-like columns: names ending with _id, _key, _code, _no, _ref, or exact 'id'
  const fkPatterns = /(_id|_key|_code|_no|_ref|_num|_number|_reference)$/i;
  const fkColumns = dataset.columns.filter(c =>
    fkPatterns.test(c.name) || c.name.toLowerCase() === 'id'
  );
  const foreignKeyScore = fkColumns.length / totalColumns;

  // Cardinality ratio: average uniqueCount/rowCount across columns
  const cardinalityRatios = dataset.columns
    .filter(c => c.uniqueCount !== undefined && dataset.rowCount > 0)
    .map(c => c.uniqueCount / dataset.rowCount);
  const cardinalityRatio = cardinalityRatios.length > 0
    ? cardinalityRatios.reduce((a, b) => a + b, 0) / cardinalityRatios.length
    : 0.5;

  // Is this a high-cardinality (many rows) table relative to others?
  const medianRowCount = [...allDatasets]
    .map(d => d.rowCount)
    .sort((a, b) => a - b)[Math.floor(allDatasets.length / 2)] || 0;
  const hasHighCardinality = dataset.rowCount > medianRowCount;

  // Has primary-key-like column (uniqueCount == rowCount)?
  const hasPKColumn = dataset.columns.some(c =>
    c.uniqueCount === dataset.rowCount && dataset.rowCount > 0
  );

  // --- FACT TABLE SCORING ---
  let factScore = 0;

  // High row count relative to others
  if (hasHighCardinality && allDatasets.length > 1) {
    const maxRowCount = Math.max(...allDatasets.map(d => d.rowCount));
    if (dataset.rowCount >= maxRowCount * 0.8) {
      factScore += 0.30;
      reasons.push(`Highest row count (${dataset.rowCount.toLocaleString()} rows)`);
    } else if (dataset.rowCount > medianRowCount) {
      factScore += 0.15;
    }
  }

  // High numeric column ratio (measures/metrics)
  if (numericColumnRatio > 0.4) {
    factScore += 0.25;
    reasons.push(`High numeric ratio (${(numericColumnRatio * 100).toFixed(0)}%)`);
  } else if (numericColumnRatio > 0.25) {
    factScore += 0.12;
  }

  // Many FK-like columns (references to dimensions)
  if (foreignKeyScore > 0.2) {
    factScore += 0.25;
    reasons.push(`Multiple FK columns (${fkColumns.length})`);
  } else if (foreignKeyScore > 0.1) {
    factScore += 0.12;
  }

  // Has date/time columns (transactional data)
  if (dateColumns.length > 0) {
    factScore += 0.10;
    reasons.push('Contains date/time columns');
  }

  // Lower average cardinality (FK values repeat)
  if (cardinalityRatio < 0.3 && dataset.rowCount > 10) {
    factScore += 0.10;
  }

  // --- DIMENSION TABLE SCORING ---
  let dimensionScore = 0;

  // Lower row count relative to fact tables
  if (allDatasets.length > 1 && !hasHighCardinality) {
    dimensionScore += 0.30;
    reasons.push(`Lower row count (${dataset.rowCount.toLocaleString()} rows)`);
  }

  // High descriptive column ratio (names, descriptions, labels)
  if (descriptiveColumnRatio > 0.5) {
    dimensionScore += 0.25;
    reasons.push(`High descriptive ratio (${(descriptiveColumnRatio * 100).toFixed(0)}%)`);
  } else if (descriptiveColumnRatio > 0.3) {
    dimensionScore += 0.12;
  }

  // Has a PK-like column (lookup table characteristic)
  if (hasPKColumn) {
    dimensionScore += 0.15;
    reasons.push('Has primary key column');
  }

  // High cardinality ratio (unique values = lookup)
  if (cardinalityRatio > 0.7 && dataset.rowCount > 1) {
    dimensionScore += 0.20;
    reasons.push('High cardinality (lookup table)');
  }

  // Low FK columns
  if (foreignKeyScore < 0.1) {
    dimensionScore += 0.10;
  }

  // Determine role
  let role: TableClassification['role'] = 'unknown';
  let confidence = 0;

  if (factScore > 0.45 && factScore > dimensionScore) {
    role = 'fact';
    confidence = Math.min(factScore, 1);
  } else if (dimensionScore > 0.45 && dimensionScore > factScore) {
    role = 'dimension';
    confidence = Math.min(dimensionScore, 1);
  } else if (factScore > 0.3 && factScore > dimensionScore) {
    role = 'fact';
    confidence = factScore * 0.7; // Lower confidence
  } else if (dimensionScore > 0.3) {
    role = 'dimension';
    confidence = dimensionScore * 0.7;
  }

  return {
    datasetId: dataset.id,
    datasetName: dataset.name,
    role,
    confidence,
    reasons,
    metrics: {
      rowCount: dataset.rowCount,
      numericColumnRatio,
      foreignKeyScore,
      cardinalityRatio,
      descriptiveColumnRatio,
      hasHighCardinality
    }
  };
};

/**
 * Detect the schema type (star, snowflake, flat, or none) from datasets
 */
export const detectSchema = (datasets: Dataset[]): SchemaDetectionResult => {
  // No datasets
  if (datasets.length === 0) {
    return {
      schemaType: 'none',
      confidence: 1,
      factTables: [],
      dimensionTables: [],
      relationships: [],
      explanation: 'No datasets uploaded.',
      dimensionHierarchies: []
    };
  }

  // Single dataset
  if (datasets.length === 1) {
    return {
      schemaType: 'flat',
      confidence: 1,
      factTables: [],
      dimensionTables: [],
      relationships: [],
      explanation: `Single dataset "${datasets[0].name}" loaded. No schema relationships needed.`,
      dimensionHierarchies: []
    };
  }

  // Sample large datasets for performance
  const sampledDatasets = datasets.map(ds => sampleForDetection(ds));

  // Classify all tables
  const classifications = datasets.map(ds => classifyTable(ds, datasets));
  const factTables = classifications.filter(c => c.role === 'fact');
  const dimensionTables = classifications.filter(c => c.role === 'dimension');

  // If no fact table was identified, pick the one with most rows
  if (factTables.length === 0 && datasets.length >= 2) {
    const sorted = [...classifications].sort((a, b) => b.metrics.rowCount - a.metrics.rowCount);
    sorted[0].role = 'fact';
    sorted[0].confidence = 0.4;
    sorted[0].reasons.push('Selected as fact table (highest row count)');
    factTables.push(sorted[0]);

    // Mark remaining as dimensions
    sorted.slice(1).forEach(c => {
      if (c.role === 'unknown') {
        c.role = 'dimension';
        c.confidence = 0.4;
        c.reasons.push('Selected as dimension table (relative to fact)');
        dimensionTables.push(c);
      }
    });
  }

  // Detect relationships using sampled data
  const detectedRelationships = autoDetectRelationships(sampledDatasets);

  // Build adjacency graph to determine schema topology
  // Track which datasets connect to which
  const adjacency = new Map<string, Set<string>>();
  datasets.forEach(ds => adjacency.set(ds.id, new Set()));

  detectedRelationships.forEach(rel => {
    adjacency.get(rel.fromDataset)?.add(rel.toDataset);
    adjacency.get(rel.toDataset)?.add(rel.fromDataset);
  });

  // Check for dimension-to-dimension links (snowflake indicator)
  const dimensionIds = new Set(dimensionTables.map(d => d.datasetId));
  const factIds = new Set(factTables.map(f => f.datasetId));

  const dimensionHierarchies: SchemaDetectionResult['dimensionHierarchies'] = [];

  detectedRelationships.forEach(rel => {
    const fromIsDim = dimensionIds.has(rel.fromDataset);
    const toIsDim = dimensionIds.has(rel.toDataset);

    if (fromIsDim && toIsDim) {
      // Dimension-to-dimension link → snowflake indicator
      dimensionHierarchies.push({
        parentDimension: rel.fromDataset,
        childDimension: rel.toDataset,
        linkColumn: rel.fromColumn
      });
    }
  });

  // Determine schema type
  let schemaType: SchemaType;
  let confidence = 0;
  let explanation = '';

  if (factTables.length === 0 && detectedRelationships.length === 0) {
    schemaType = 'none';
    confidence = 0.5;
    explanation = 'No clear relationships detected between datasets. Consider creating manual relationships.';
  } else if (dimensionHierarchies.length > 0 && factTables.length > 0) {
    // Snowflake: dimension-to-dimension links exist
    schemaType = 'snowflake';
    confidence = Math.min(
      0.5 + (dimensionHierarchies.length * 0.15) + (factTables[0].confidence * 0.2),
      0.95
    );
    explanation = `Snowflake schema detected: ${factTables.length} fact table(s) with ${dimensionTables.length} dimension table(s) ` +
      `including ${dimensionHierarchies.length} hierarchical dimension relationship(s). ` +
      `Fact: ${factTables.map(f => f.datasetName).join(', ')}. ` +
      `Dimensions: ${dimensionTables.map(d => d.datasetName).join(', ')}.`;
  } else if (factTables.length > 0 && dimensionTables.length > 0) {
    // Star: fact table(s) with dimensions connecting directly to them
    schemaType = 'star';
    confidence = Math.min(
      0.5 + (detectedRelationships.length * 0.1) + (factTables[0].confidence * 0.2),
      0.95
    );
    explanation = `Star schema detected: ${factTables.length} fact table(s) at center with ${dimensionTables.length} dimension table(s). ` +
      `Fact: ${factTables.map(f => f.datasetName).join(', ')}. ` +
      `Dimensions: ${dimensionTables.map(d => d.datasetName).join(', ')}.`;
  } else {
    schemaType = 'star';
    confidence = 0.35;
    explanation = `Possible star schema. ${detectedRelationships.length} relationship(s) detected but classification confidence is low.`;
  }

  // Update relationships with schema metadata
  detectedRelationships.forEach(rel => {
    if (schemaType === 'star' || schemaType === 'snowflake') {
      rel.schemaType = schemaType === 'snowflake' ? 'snowflake' : 'star';

      if (factIds.has(rel.fromDataset)) {
        (rel as any).isFactTable = true;
      }
      if (dimensionIds.has(rel.toDataset)) {
        (rel as any).isDimensionTable = true;
      }
      // Handle reverse direction
      if (factIds.has(rel.toDataset)) {
        (rel as any).isFactTable = true;
      }
      if (dimensionIds.has(rel.fromDataset) && !factIds.has(rel.fromDataset)) {
        (rel as any).isDimensionTable = true;
      }
    }
  });

  return {
    schemaType,
    confidence,
    factTables,
    dimensionTables,
    relationships: detectedRelationships,
    explanation,
    dimensionHierarchies
  };
};

// ============================================================
// Phase B: Enhanced Relationship Detection
// ============================================================

/**
 * Detect date tables in a collection of datasets
 */
export const detectDateTables = (datasets: Dataset[]): DateTableInfo[] => {
  const allDateInfos: DateTableInfo[] = [];
  for (const ds of datasets) {
    const dateInfos = detectDateColumns(ds);
    allDateInfos.push(...dateInfos);
  }
  return allDateInfos;
};

/**
 * Detect temporal relationships between datasets that share date columns
 */
export const detectTemporalRelationships = (
  datasets: Dataset[],
  dateTableInfos: DateTableInfo[]
): AutoDetectedRelationship[] => {
  const relationships: AutoDetectedRelationship[] = [];

  // Group date columns by dataset
  const dateColumnsByDataset = new Map<string, DateTableInfo[]>();
  for (const info of dateTableInfos) {
    if (!dateColumnsByDataset.has(info.datasetId)) {
      dateColumnsByDataset.set(info.datasetId, []);
    }
    dateColumnsByDataset.get(info.datasetId)!.push(info);
  }

  const datasetIds = [...dateColumnsByDataset.keys()];

  for (let i = 0; i < datasetIds.length; i++) {
    for (let j = i + 1; j < datasetIds.length; j++) {
      const ds1Id = datasetIds[i];
      const ds2Id = datasetIds[j];
      const dates1 = dateColumnsByDataset.get(ds1Id) || [];
      const dates2 = dateColumnsByDataset.get(ds2Id) || [];

      for (const d1 of dates1) {
        for (const d2 of dates2) {
          // Check date range overlap
          const overlapStart = new Date(Math.max(d1.dateRange.min.getTime(), d2.dateRange.min.getTime()));
          const overlapEnd = new Date(Math.min(d1.dateRange.max.getTime(), d2.dateRange.max.getTime()));

          if (overlapStart > overlapEnd) continue; // No overlap

          const range1 = d1.dateRange.max.getTime() - d1.dateRange.min.getTime();
          const range2 = d2.dateRange.max.getTime() - d2.dateRange.min.getTime();
          const overlapRange = overlapEnd.getTime() - overlapStart.getTime();
          const overlapRatio = Math.min(range1, range2) > 0
            ? overlapRange / Math.min(range1, range2)
            : 0;

          // Score based on overlap and frequency match
          let score = overlapRatio * 0.6;
          if (d1.frequency === d2.frequency) score += 0.3;
          else score += 0.1;
          if (d1.isDateTable || d2.isDateTable) score += 0.1;

          if (score > 0.4) {
            relationships.push({
              fromDataset: ds1Id,
              toDataset: ds2Id,
              fromColumn: d1.columnName,
              toColumn: d2.columnName,
              type: 'many-to-many',
              confidence: Math.min(score, 0.95),
              matchScore: score,
              matchingValues: 0, // Temporal joins don't count individual matches
              totalValues: 0,
              suggestion: `Temporal join on date columns (${d1.frequency} ↔ ${d2.frequency}). ${(overlapRatio * 100).toFixed(0)}% date range overlap.`,
              autoJoinRecommended: score > 0.7,
              schemaType: undefined
            });
          }
        }
      }
    }
  }

  return relationships;
};

/**
 * Enhanced semantic column matching for FK patterns
 */
export const calculateSemanticSimilarity = (
  col1Name: string,
  col2Name: string,
  ds1Name: string,
  ds2Name: string
): number => {
  const n1 = col1Name.toLowerCase().replace(/[_\-\s]/g, '');
  const n2 = col2Name.toLowerCase().replace(/[_\-\s]/g, '');
  const table1 = ds1Name.toLowerCase().replace(/[_\-\s.]/g, '').replace(/\.(csv|xlsx|json)$/i, '');
  const table2 = ds2Name.toLowerCase().replace(/[_\-\s.]/g, '').replace(/\.(csv|xlsx|json)$/i, '');

  // Pattern 1: col1 = "{table2}_id" or "{table2}id"
  const fkPatterns = ['id', 'key', 'code', 'no', 'num', 'ref'];
  for (const suffix of fkPatterns) {
    // Check if col1 references table2
    if (n1 === table2 + suffix || n1 === 'fk' + table2 || n1 === table2 + '_' + suffix) {
      // And col2 is the PK of table2 (likely just "id" or "{table2}_id")
      if (n2 === suffix || n2 === table2 + suffix) {
        return 0.95;
      }
    }
    // Check if col2 references table1
    if (n2 === table1 + suffix || n2 === 'fk' + table1 || n2 === table1 + '_' + suffix) {
      if (n1 === suffix || n1 === table1 + suffix) {
        return 0.95;
      }
    }
  }

  // Pattern 2: Pluralization (e.g., "products" table has "product_id" FK elsewhere)
  const singularTable1 = table1.replace(/s$/, '');
  const singularTable2 = table2.replace(/s$/, '');

  for (const suffix of fkPatterns) {
    if (n1 === singularTable2 + suffix || n1 === singularTable2 + '_' + suffix) {
      if (n2 === suffix || n2 === singularTable2 + suffix) return 0.90;
    }
    if (n2 === singularTable1 + suffix || n2 === singularTable1 + '_' + suffix) {
      if (n1 === suffix || n1 === singularTable1 + suffix) return 0.90;
    }
  }

  return 0; // No semantic match
};

/**
 * Enhanced cardinality detection using actual value analysis
 */
export const detectCardinality = (
  dataset1: Dataset,
  col1: string,
  dataset2: Dataset,
  col2: string
): Relationship['type'] => {
  // Get actual values
  const values1 = dataset1.data.map(r => String(r[col1] || '').toLowerCase().trim()).filter(v => v !== '');
  const values2 = dataset2.data.map(r => String(r[col2] || '').toLowerCase().trim()).filter(v => v !== '');

  const unique1 = new Set(values1);
  const unique2 = new Set(values2);

  // Find matched values
  const matchedValues = new Set<string>();
  unique1.forEach(v => { if (unique2.has(v)) matchedValues.add(v); });

  if (matchedValues.size === 0) return 'many-to-many';

  // Check if each matched value appears once or multiple times on each side
  const counts1 = new Map<string, number>();
  const counts2 = new Map<string, number>();

  for (const v of values1) {
    if (matchedValues.has(v)) {
      counts1.set(v, (counts1.get(v) || 0) + 1);
    }
  }
  for (const v of values2) {
    if (matchedValues.has(v)) {
      counts2.set(v, (counts2.get(v) || 0) + 1);
    }
  }

  const allUniqueIn1 = [...counts1.values()].every(c => c === 1);
  const allUniqueIn2 = [...counts2.values()].every(c => c === 1);

  if (allUniqueIn1 && allUniqueIn2) return 'one-to-one';
  if (allUniqueIn1 && !allUniqueIn2) return 'one-to-many';
  if (!allUniqueIn1 && allUniqueIn2) return 'one-to-many'; // Reverse direction
  return 'many-to-many';
};

/**
 * Check for circular dependencies in relationship graph
 */
export const hasCircularDependency = (
  relationships: { fromDataset: string; toDataset: string }[],
  newFrom: string,
  newTo: string
): boolean => {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const rel of relationships) {
    if (!adj.has(rel.fromDataset)) adj.set(rel.fromDataset, []);
    adj.get(rel.fromDataset)!.push(rel.toDataset);
  }

  // Add proposed edge
  if (!adj.has(newFrom)) adj.set(newFrom, []);
  adj.get(newFrom)!.push(newTo);

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const hasCycle = (node: string): boolean => {
    visited.add(node);
    inStack.add(node);

    for (const neighbor of adj.get(node) || []) {
      if (inStack.has(neighbor)) return true;
      if (!visited.has(neighbor) && hasCycle(neighbor)) return true;
    }

    inStack.delete(node);
    return false;
  };

  // Check all nodes
  for (const node of adj.keys()) {
    if (!visited.has(node)) {
      if (hasCycle(node)) return true;
    }
  }

  return false;
};

/**
 * Validate referential integrity between two datasets via a relationship
 */
export const validateReferentialIntegrity = (
  parentDataset: Dataset,
  childDataset: Dataset,
  parentColumn: string,
  childColumn: string
): IntegrityReport => {
  const parentValues = new Set(
    parentDataset.data
      .map(r => String(r[parentColumn] || '').toLowerCase().trim())
      .filter(v => v !== '')
  );

  const childValues = childDataset.data
    .map(r => String(r[childColumn] || '').toLowerCase().trim())
    .filter(v => v !== '');

  const childValueSet = new Set(childValues);

  // Orphans: child values not in parent
  let orphanCount = 0;
  for (const v of childValues) {
    if (!parentValues.has(v)) orphanCount++;
  }

  // Unused parents: parent values not referenced by any child
  let unusedParentCount = 0;
  for (const v of parentValues) {
    if (!childValueSet.has(v)) unusedParentCount++;
  }

  const totalChildRows = childValues.length;
  const totalParentRows = parentValues.size;
  const orphanPercentage = totalChildRows > 0 ? (orphanCount / totalChildRows) * 100 : 0;
  const unusedParentPercentage = totalParentRows > 0 ? (unusedParentCount / totalParentRows) * 100 : 0;
  const matchRate = totalChildRows > 0 ? ((totalChildRows - orphanCount) / totalChildRows) * 100 : 0;

  const issues: string[] = [];
  if (orphanPercentage > 10) {
    issues.push(`${orphanCount} orphan records (${orphanPercentage.toFixed(1)}%) in child table have no match in parent.`);
  }
  if (unusedParentPercentage > 50) {
    issues.push(`${unusedParentCount} parent records (${unusedParentPercentage.toFixed(1)}%) are never referenced.`);
  }

  // Score: 100 = perfect integrity, 0 = no matches
  const integrityScore = Math.round(Math.max(0, Math.min(100,
    matchRate * 0.7 + (100 - unusedParentPercentage) * 0.3
  )));

  return {
    relationshipId: '',
    orphanCount,
    orphanPercentage: Math.round(orphanPercentage * 10) / 10,
    unusedParentCount,
    unusedParentPercentage: Math.round(unusedParentPercentage * 10) / 10,
    matchRate: Math.round(matchRate * 10) / 10,
    integrityScore,
    issues
  };
};

/**
 * Enhanced classifyTable with date_dimension support
 */
export const classifyTableEnhanced = (
  dataset: Dataset,
  allDatasets: Dataset[],
  dateTableInfos: DateTableInfo[]
): TableClassification => {
  // Check if this dataset is primarily a date table
  const dateInfo = dateTableInfos.find(
    d => d.datasetId === dataset.id && d.isDateTable && d.coverage > 0.8
  );

  if (dateInfo) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      role: 'date_dimension',
      confidence: dateInfo.coverage,
      reasons: [
        `Date table detected: ${dateInfo.columnName}`,
        `Frequency: ${dateInfo.frequency}`,
        `Coverage: ${(dateInfo.coverage * 100).toFixed(0)}%`,
        `Range: ${dateInfo.dateRange.min.toISOString().split('T')[0]} to ${dateInfo.dateRange.max.toISOString().split('T')[0]}`
      ],
      metrics: {
        rowCount: dataset.rowCount,
        numericColumnRatio: dataset.columns.filter(c => c.type === 'number').length / Math.max(dataset.columns.length, 1),
        foreignKeyScore: 0,
        cardinalityRatio: dateInfo.uniqueDates / Math.max(dataset.rowCount, 1),
        descriptiveColumnRatio: 0,
        hasHighCardinality: false
      }
    };
  }

  // Fall back to standard classification
  return classifyTable(dataset, allDatasets);
};
