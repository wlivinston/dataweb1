// Natural Language Query Engine - Makes analytics accessible to everyone
// Allows users averse to technology to interact with data using plain English

import { Dataset, ColumnInfo, Visualization, Relationship } from './types';
import { forecast as timeSeriesForecast, aggregateByDatePeriod, calculateGrowthRates, detectDateColumns } from './timeSeriesEngine';
import { calculateTotalYTD, calculateYoYChange, calculateQoQChange, calculateMoMChange } from './kpiFormulaEngine';
import { tTest, kMeansClustering, multipleRegression } from './advancedStatistics';

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

export interface QuerySuggestion {
  text: string;
  category: 'aggregation' | 'comparison' | 'trend' | 'filter' | 'relationship' | 'time_intelligence' | 'statistical' | 'what_if';
  icon: string;
}

// Common query patterns
const QUERY_PATTERNS = {
  // Aggregation patterns
  sum: /(?:what is the |what's the |find the |calculate the |show me the )?(?:total|sum|combined|aggregate)(?: of| for)?\s+(.+)/i,
  average: /(?:what is the |what's the |find the |calculate the |show me the )?(?:average|mean|avg)(?: of| for)?\s+(.+)/i,
  count: /(?:how many|count|number of|total count of)\s+(.+)/i,
  max: /(?:what is the |what's the |find the )?(?:highest|maximum|max|largest|biggest|top)(?: value)?(?: of| for| in)?\s+(.+)/i,
  min: /(?:what is the |what's the |find the )?(?:lowest|minimum|min|smallest|bottom)(?: value)?(?: of| for| in)?\s+(.+)/i,
  
  // Comparison patterns
  compare: /compare\s+(.+?)\s+(?:and|vs|versus|with|to)\s+(.+)/i,
  difference: /(?:what is the )?difference\s+(?:between\s+)?(.+?)\s+(?:and|vs)\s+(.+)/i,
  
  // Filter patterns
  filter: /(?:show|find|get|filter|display)\s+(?:me\s+)?(?:all\s+)?(?:rows|records|data|items)?\s*(?:where|with|having|when|if)\s+(.+)/i,
  topN: /(?:show|find|get|list)\s+(?:me\s+)?(?:the\s+)?(?:top|first|best)\s+(\d+)\s+(.+?)(?:\s+by\s+(.+))?$/i,
  bottomN: /(?:show|find|get|list)\s+(?:me\s+)?(?:the\s+)?(?:bottom|last|worst)\s+(\d+)\s+(.+?)(?:\s+by\s+(.+))?$/i,
  
  // Trend patterns
  trend: /(?:what is the |show me the |is there a )?trend\s+(?:of|for|in)\s+(.+)/i,
  growth: /(?:what is the |show me the )?(?:growth|increase|change|progression)\s+(?:of|for|in)\s+(.+)/i,
  
  // Distribution patterns
  distribution: /(?:show|what is the )?distribution\s+(?:of|for)\s+(.+)/i,
  breakdown: /(?:show|give me a )?breakdown\s+(?:of|for|by)\s+(.+)/i,
  
  // Relationship patterns
  correlation: /(?:is there a |what is the )?(?:correlation|relationship|connection)\s+(?:between\s+)?(.+?)\s+(?:and|with)\s+(.+)/i,
  
  // Simple questions
  what: /what\s+(?:is|are)\s+(?:the\s+)?(.+)/i,
  howMuch: /how much\s+(?:is|are|does)\s+(.+)/i,
  
  // Group by patterns
  groupBy: /(?:group|summarize|aggregate)\s+(?:by|on)\s+(.+)/i,
  perCategory: /(.+)\s+(?:per|by|for each|for every)\s+(.+)/i,

  // Time intelligence patterns (Phase B7)
  salesLastPeriod: /(.+?)(?:\s+in|\s+for|\s+during)?\s+(?:last|previous|prior)\s+(month|quarter|year|week)/i,
  ytd: /(?:year to date|ytd)\s+(?:of|for)?\s*(.+)/i,
  yoyChange: /(?:year over year|yoy|year-over-year)\s+(?:change|growth|difference)?\s*(?:of|for|in)?\s*(.+)/i,
  qoqChange: /(?:quarter over quarter|qoq|quarter-over-quarter)\s+(?:change|growth|difference)?\s*(?:of|for|in)?\s*(.+)/i,
  momChange: /(?:month over month|mom|month-over-month)\s+(?:change|growth|difference)?\s*(?:of|for|in)?\s*(.+)/i,
  compareQuarters: /compare\s+(?:q(\d)|quarter\s*(\d))\s+(?:and|vs|versus|with|to)\s+(?:q(\d)|quarter\s*(\d))/i,
  forecastQuery: /(?:forecast|predict|project|estimate)\s+(?:next\s+)?(\d+)?\s*(?:months?|quarters?|periods?|weeks?|days?)?\s*(?:of|for)?\s*(.+)/i,
  trendOverTime: /(?:trend|show|plot)\s+(?:of\s+)?(.+?)\s+(?:over|across|during)\s+(?:the\s+)?(?:last\s+)?(?:(\d+)\s+)?(?:months?|years?|quarters?|weeks?|time)/i,

  // Compound condition patterns (Phase B7)
  compoundAnd: /(?:show|find|get|filter|display)\s+(?:me\s+)?(?:all\s+)?(?:rows|records|data)?\s*(?:where|with|having)\s+(.+?)\s+(?:and|&)\s+(.+)/i,
  compoundOr: /(?:show|find|get|filter|display)\s+(?:me\s+)?(?:all\s+)?(?:rows|records|data)?\s*(?:where|with|having)\s+(.+?)\s+(?:or|\|)\s+(.+)/i,
  topNWhere: /(?:top|first|best)\s+(\d+)\s+(.+?)\s+(?:where|with|having|when|if)\s+(.+)/i,

  // Statistical query patterns (Phase B7)
  significantDiff: /(?:is there a |are there )?(?:significant|statistical)\s+(?:difference|differences?)\s+(?:between|in)\s+(.+?)\s+(?:and|vs|versus|by)\s+(.+)/i,
  clusterQuery: /(?:cluster|segment|group)\s+(?:the\s+)?(?:data|customers?|users?|records?)?\s*(?:by|using|on|based on)?\s*(.+)/i,
  predictQuery: /(?:what\s+)?(?:predict|predicts?|drives?|explains?|determines?)\s+(.+)/i,

  // What-if patterns (Phase B7)
  whatIfIncrease: /what\s+if\s+(.+?)\s+(?:increase|go up|rise|grow)(?:s|es|d)?\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(%|percent)?/i,
  whatIfDecrease: /what\s+if\s+(.+?)\s+(?:decrease|go down|drop|fall|decline)(?:s|es|d)?\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(%|percent)?/i,
  whatIfRemoveOutliers: /what\s+if\s+(?:we\s+)?(?:remove|exclude|filter out)\s+(?:the\s+)?outliers?\s*(?:from|in)?\s*(.+)?/i
};

/**
 * Find the best matching column for a given term
 */
const findMatchingColumn = (term: string, columns: ColumnInfo[]): ColumnInfo | null => {
  const normalizedTerm = term.toLowerCase().replace(/[_\-\s]/g, '');
  
  // Exact match
  let match = columns.find(c => c.name.toLowerCase() === term.toLowerCase());
  if (match) return match;
  
  // Normalized match
  match = columns.find(c => c.name.toLowerCase().replace(/[_\-\s]/g, '') === normalizedTerm);
  if (match) return match;
  
  // Partial match
  match = columns.find(c => c.name.toLowerCase().includes(term.toLowerCase()));
  if (match) return match;
  
  // Fuzzy match (contains any word)
  const words = term.toLowerCase().split(/\s+/);
  match = columns.find(c => 
    words.some(word => c.name.toLowerCase().includes(word) && word.length > 2)
  );
  if (match) return match;
  
  return null;
};

/**
 * Parse a filter condition from natural language
 */
const parseFilterCondition = (condition: string, columns: ColumnInfo[]): {
  column: string;
  operator: string;
  value: any;
} | null => {
  // Pattern: column operator value
  const patterns = [
    /(.+?)\s+(?:is|equals?|=|==)\s+['"]?(.+?)['"]?$/i,
    /(.+?)\s+(?:is not|isn't|!=|<>)\s+['"]?(.+?)['"]?$/i,
    /(.+?)\s+(?:greater than|>|more than|above|over)\s+(\d+(?:\.\d+)?)/i,
    /(.+?)\s+(?:less than|<|below|under)\s+(\d+(?:\.\d+)?)/i,
    /(.+?)\s+(?:contains?|includes?|has)\s+['"]?(.+?)['"]?$/i,
    /(.+?)\s+(?:starts? with|begins? with)\s+['"]?(.+?)['"]?$/i,
    /(.+?)\s+(?:ends? with)\s+['"]?(.+?)['"]?$/i,
    /(.+?)\s+(?:between)\s+(\d+(?:\.\d+)?)\s+(?:and)\s+(\d+(?:\.\d+)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = condition.match(pattern);
    if (match) {
      const col = findMatchingColumn(match[1].trim(), columns);
      if (col) {
        let operator = '=';
        if (pattern.source.includes('not|isn')) operator = '!=';
        else if (pattern.source.includes('greater')) operator = '>';
        else if (pattern.source.includes('less')) operator = '<';
        else if (pattern.source.includes('contain')) operator = 'contains';
        else if (pattern.source.includes('starts')) operator = 'startsWith';
        else if (pattern.source.includes('ends')) operator = 'endsWith';
        else if (pattern.source.includes('between')) operator = 'between';
        
        return {
          column: col.name,
          operator,
          value: operator === 'between' ? [match[2], match[3]] : match[2]
        };
      }
    }
  }
  
  return null;
};

/**
 * Apply a filter condition to a single data row
 */
const applyCondition = (row: Record<string, any>, condition: { column: string; operator: string; value: any }): boolean => {
  const cellValue = row[condition.column];
  const strValue = String(cellValue || '').toLowerCase();
  const condValue = String(condition.value || '').toLowerCase();

  switch (condition.operator) {
    case '=':
      return strValue === condValue;
    case '!=':
      return strValue !== condValue;
    case '>':
      return Number(cellValue) > Number(condition.value);
    case '<':
      return Number(cellValue) < Number(condition.value);
    case '>=':
      return Number(cellValue) >= Number(condition.value);
    case '<=':
      return Number(cellValue) <= Number(condition.value);
    case 'contains':
      return strValue.includes(condValue);
    case 'startsWith':
      return strValue.startsWith(condValue);
    case 'endsWith':
      return strValue.endsWith(condValue);
    case 'between':
      if (Array.isArray(condition.value)) {
        const num = Number(cellValue);
        return num >= Number(condition.value[0]) && num <= Number(condition.value[1]);
      }
      return false;
    default:
      return false;
  }
};

/**
 * Execute a natural language query on a dataset
 */
export const executeQuery = (query: string, dataset: Dataset): QueryResult => {
  const originalQuery = query;
  query = query.trim();
  
  // Default result
  const defaultResult: QueryResult = {
    success: false,
    query: originalQuery,
    interpretation: '',
    result: null,
    resultType: 'text',
    explanation: "I couldn't understand that query. Try asking something like 'What is the total sales?' or 'Show me the average price by category'.",
    confidence: 0,
    alternativeQueries: generateSuggestions(dataset).map(s => s.text).slice(0, 3)
  };
  
  try {
    // Check for SUM/TOTAL pattern
    let match = query.match(QUERY_PATTERNS.sum);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      if (column && column.type === 'number') {
        const values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        const sum = values.reduce((a, b) => a + b, 0);
        return {
          success: true,
          query: originalQuery,
          interpretation: `Calculate the sum of ${column.name}`,
          result: sum,
          resultType: 'number',
          explanation: `The total sum of ${column.name} across ${values.length} records is ${sum.toLocaleString()}.`,
          confidence: 0.95,
          suggestedVisualization: {
            type: 'gauge',
            title: `Total ${column.name}`
          }
        };
      }
    }
    
    // Check for AVERAGE pattern
    match = query.match(QUERY_PATTERNS.average);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      if (column && column.type === 'number') {
        const values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return {
          success: true,
          query: originalQuery,
          interpretation: `Calculate the average of ${column.name}`,
          result: Math.round(avg * 100) / 100,
          resultType: 'number',
          explanation: `The average ${column.name} is ${avg.toLocaleString(undefined, { maximumFractionDigits: 2 })} based on ${values.length} records.`,
          confidence: 0.95
        };
      }
    }
    
    // Check for COUNT pattern
    match = query.match(QUERY_PATTERNS.count);
    if (match) {
      const term = match[1].trim().toLowerCase();
      
      // Count all rows
      if (term.includes('row') || term.includes('record') || term.includes('item') || term === 'all') {
        return {
          success: true,
          query: originalQuery,
          interpretation: 'Count all records',
          result: dataset.rowCount,
          resultType: 'number',
          explanation: `There are ${dataset.rowCount.toLocaleString()} records in the dataset.`,
          confidence: 0.95
        };
      }
      
      // Count by category
      const column = findMatchingColumn(term.replace(/unique |distinct /i, ''), dataset.columns);
      if (column) {
        if (term.includes('unique') || term.includes('distinct')) {
          return {
            success: true,
            query: originalQuery,
            interpretation: `Count unique values in ${column.name}`,
            result: column.uniqueCount,
            resultType: 'number',
            explanation: `There are ${column.uniqueCount.toLocaleString()} unique values in ${column.name}.`,
            confidence: 0.9
          };
        }
        
        // Count by category
        const counts: Record<string, number> = {};
        dataset.data.forEach(row => {
          const val = String(row[column.name] || 'Unknown');
          counts[val] = (counts[val] || 0) + 1;
        });
        
        const tableData = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([category, count]) => ({ [column.name]: category, Count: count }));
        
        return {
          success: true,
          query: originalQuery,
          interpretation: `Count records by ${column.name}`,
          result: tableData,
          resultType: 'table',
          explanation: `Counted ${dataset.rowCount} records grouped by ${column.name}. Found ${Object.keys(counts).length} categories.`,
          confidence: 0.85,
          suggestedVisualization: {
            type: 'bar',
            title: `Count by ${column.name}`,
            data: tableData.slice(0, 10).map(r => ({ category: r[column.name], value: r.Count }))
          }
        };
      }
    }
    
    // Check for MAX pattern
    match = query.match(QUERY_PATTERNS.max);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      if (column && column.type === 'number') {
        return {
          success: true,
          query: originalQuery,
          interpretation: `Find maximum ${column.name}`,
          result: column.max,
          resultType: 'number',
          explanation: `The maximum value of ${column.name} is ${column.max?.toLocaleString()}.`,
          confidence: 0.95
        };
      }
    }
    
    // Check for MIN pattern
    match = query.match(QUERY_PATTERNS.min);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      if (column && column.type === 'number') {
        return {
          success: true,
          query: originalQuery,
          interpretation: `Find minimum ${column.name}`,
          result: column.min,
          resultType: 'number',
          explanation: `The minimum value of ${column.name} is ${column.min?.toLocaleString()}.`,
          confidence: 0.95
        };
      }
    }
    
    // Check for TOP N pattern
    match = query.match(QUERY_PATTERNS.topN);
    if (match) {
      const n = parseInt(match[1]);
      const targetTerm = match[2].trim();
      const sortByTerm = match[3]?.trim();
      
      let sortColumn: ColumnInfo | null = null;
      if (sortByTerm) {
        sortColumn = findMatchingColumn(sortByTerm, dataset.columns);
      }
      if (!sortColumn) {
        sortColumn = dataset.columns.find(c => c.type === 'number') || null;
      }
      
      if (sortColumn) {
        const sorted = [...dataset.data]
          .sort((a, b) => Number(b[sortColumn!.name]) - Number(a[sortColumn!.name]))
          .slice(0, n);
        
        return {
          success: true,
          query: originalQuery,
          interpretation: `Get top ${n} records by ${sortColumn.name}`,
          result: sorted,
          resultType: 'table',
          explanation: `Here are the top ${n} records sorted by ${sortColumn.name} (highest first).`,
          confidence: 0.85,
          suggestedVisualization: {
            type: 'bar',
            title: `Top ${n} by ${sortColumn.name}`
          }
        };
      }
    }
    
    // Check for FILTER pattern
    match = query.match(QUERY_PATTERNS.filter);
    if (match) {
      const condition = parseFilterCondition(match[1], dataset.columns);
      if (condition) {
        let filtered = dataset.data;
        
        switch (condition.operator) {
          case '=':
            filtered = dataset.data.filter(r => 
              String(r[condition.column]).toLowerCase() === String(condition.value).toLowerCase()
            );
            break;
          case '!=':
            filtered = dataset.data.filter(r => 
              String(r[condition.column]).toLowerCase() !== String(condition.value).toLowerCase()
            );
            break;
          case '>':
            filtered = dataset.data.filter(r => 
              Number(r[condition.column]) > Number(condition.value)
            );
            break;
          case '<':
            filtered = dataset.data.filter(r => 
              Number(r[condition.column]) < Number(condition.value)
            );
            break;
          case 'contains':
            filtered = dataset.data.filter(r => 
              String(r[condition.column]).toLowerCase().includes(String(condition.value).toLowerCase())
            );
            break;
        }
        
        return {
          success: true,
          query: originalQuery,
          interpretation: `Filter where ${condition.column} ${condition.operator} ${condition.value}`,
          result: filtered.slice(0, 100),
          resultType: 'table',
          explanation: `Found ${filtered.length} records where ${condition.column} ${condition.operator} "${condition.value}".${filtered.length > 100 ? ' Showing first 100.' : ''}`,
          confidence: 0.8
        };
      }
    }
    
    // Check for BREAKDOWN/PER CATEGORY pattern
    match = query.match(QUERY_PATTERNS.perCategory);
    if (match) {
      const metricTerm = match[1].trim();
      const groupTerm = match[2].trim();
      
      const metricCol = findMatchingColumn(metricTerm.replace(/total |sum of |average |mean /i, ''), dataset.columns);
      const groupCol = findMatchingColumn(groupTerm, dataset.columns);
      
      if (metricCol && groupCol && metricCol.type === 'number') {
        const isSum = /total|sum/i.test(metricTerm);
        const isAvg = /average|mean|avg/i.test(metricTerm);
        
        const grouped: Record<string, number[]> = {};
        dataset.data.forEach(row => {
          const category = String(row[groupCol.name] || 'Unknown');
          const value = Number(row[metricCol.name]);
          if (!isNaN(value)) {
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(value);
          }
        });
        
        const result = Object.entries(grouped).map(([category, values]) => ({
          [groupCol.name]: category,
          [isAvg ? `Avg ${metricCol.name}` : `Total ${metricCol.name}`]: isAvg 
            ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100
            : values.reduce((a, b) => a + b, 0)
        })).sort((a, b) => {
          const key = Object.keys(a)[1];
          return (b[key] as number) - (a[key] as number);
        });
        
        return {
          success: true,
          query: originalQuery,
          interpretation: `${isAvg ? 'Average' : 'Total'} ${metricCol.name} by ${groupCol.name}`,
          result,
          resultType: 'table',
          explanation: `Calculated ${isAvg ? 'average' : 'total'} ${metricCol.name} for each ${groupCol.name}. Found ${result.length} categories.`,
          confidence: 0.9,
          suggestedVisualization: {
            type: 'bar',
            title: `${isAvg ? 'Average' : 'Total'} ${metricCol.name} by ${groupCol.name}`,
            data: result.slice(0, 10).map(r => ({ 
              category: r[groupCol.name] as string, 
              value: r[Object.keys(r)[1]] as number 
            }))
          }
        };
      }
    }
    
    // Check for DISTRIBUTION pattern
    match = query.match(QUERY_PATTERNS.distribution);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      if (column) {
        if (column.type === 'string') {
          const counts: Record<string, number> = {};
          dataset.data.forEach(row => {
            const val = String(row[column.name] || 'Unknown');
            counts[val] = (counts[val] || 0) + 1;
          });
          
          const result = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([category, count]) => ({
              [column.name]: category,
              Count: count,
              Percentage: `${((count / dataset.rowCount) * 100).toFixed(1)}%`
            }));
          
          return {
            success: true,
            query: originalQuery,
            interpretation: `Distribution of ${column.name}`,
            result,
            resultType: 'table',
            explanation: `Distribution of ${column.name} across ${dataset.rowCount} records.`,
            confidence: 0.9,
            suggestedVisualization: {
              type: 'pie',
              title: `Distribution of ${column.name}`,
              data: result.slice(0, 8).map(r => ({ category: r[column.name] as string, value: r.Count }))
            }
          };
        } else if (column.type === 'number') {
          // Create histogram buckets
          const values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
          const min = Math.min(...values);
          const max = Math.max(...values);
          const bucketSize = (max - min) / 10;
          
          const buckets: Record<string, number> = {};
          values.forEach(v => {
            const bucketIndex = Math.min(Math.floor((v - min) / bucketSize), 9);
            const bucketLabel = `${(min + bucketIndex * bucketSize).toFixed(0)}-${(min + (bucketIndex + 1) * bucketSize).toFixed(0)}`;
            buckets[bucketLabel] = (buckets[bucketLabel] || 0) + 1;
          });
          
          const result = Object.entries(buckets).map(([range, count]) => ({
            Range: range,
            Count: count
          }));
          
          return {
            success: true,
            query: originalQuery,
            interpretation: `Distribution of ${column.name}`,
            result,
            resultType: 'table',
            explanation: `Histogram of ${column.name} values. Range: ${min.toFixed(2)} to ${max.toFixed(2)}.`,
            confidence: 0.85,
            suggestedVisualization: {
              type: 'bar',
              title: `Distribution of ${column.name}`,
              data: result.map(r => ({ category: r.Range, value: r.Count }))
            }
          };
        }
      }
    }
    
    // Check for CORRELATION pattern
    match = query.match(QUERY_PATTERNS.correlation);
    if (match) {
      const col1 = findMatchingColumn(match[1].trim(), dataset.columns);
      const col2 = findMatchingColumn(match[2].trim(), dataset.columns);
      
      if (col1 && col2 && col1.type === 'number' && col2.type === 'number') {
        const pairs = dataset.data
          .map(r => ({ x: Number(r[col1.name]), y: Number(r[col2.name]) }))
          .filter(p => !isNaN(p.x) && !isNaN(p.y));
        
        if (pairs.length > 3) {
          const n = pairs.length;
          const sumX = pairs.reduce((a, p) => a + p.x, 0);
          const sumY = pairs.reduce((a, p) => a + p.y, 0);
          const sumXY = pairs.reduce((a, p) => a + p.x * p.y, 0);
          const sumX2 = pairs.reduce((a, p) => a + p.x ** 2, 0);
          const sumY2 = pairs.reduce((a, p) => a + p.y ** 2, 0);
          
          const correlation = (n * sumXY - sumX * sumY) / 
            Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
          
          const strength = Math.abs(correlation) > 0.7 ? 'strong' : 
                          Math.abs(correlation) > 0.4 ? 'moderate' : 
                          Math.abs(correlation) > 0.2 ? 'weak' : 'no significant';
          const direction = correlation > 0.1 ? 'positive' : correlation < -0.1 ? 'negative' : '';
          
          return {
            success: true,
            query: originalQuery,
            interpretation: `Calculate correlation between ${col1.name} and ${col2.name}`,
            result: Math.round(correlation * 1000) / 1000,
            resultType: 'number',
            explanation: `There is a ${strength} ${direction} correlation (${(correlation * 100).toFixed(1)}%) between ${col1.name} and ${col2.name}.${
              Math.abs(correlation) > 0.5 ? ` This suggests that as ${col1.name} ${correlation > 0 ? 'increases' : 'decreases'}, ${col2.name} tends to ${correlation > 0 ? 'increase' : 'decrease'} as well.` : ''
            }`,
            confidence: 0.95,
            suggestedVisualization: {
              type: 'scatter',
              title: `${col1.name} vs ${col2.name}`
            }
          };
        }
      }
    }
    
    // ============================================================
    // Phase B7: Time Intelligence Queries
    // ============================================================

    // Year-to-Date query
    match = query.match(QUERY_PATTERNS.ytd);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');
      if (column && column.type === 'number' && dateCol) {
        const ytdValue = calculateTotalYTD(dataset, column.name, dateCol.name);
        return {
          success: true,
          query: originalQuery,
          interpretation: `Year-to-date total of ${column.name}`,
          result: ytdValue,
          resultType: 'number',
          explanation: `The year-to-date total of ${column.name} is ${ytdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
          confidence: 0.9,
          suggestedVisualization: { type: 'gauge', title: `YTD ${column.name}` }
        };
      }
    }

    // Year-over-Year change
    match = query.match(QUERY_PATTERNS.yoyChange);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');
      if (column && column.type === 'number' && dateCol) {
        const yoyResult = calculateYoYChange(dataset, column.name, dateCol.name);
        const direction = yoyResult.percentage >= 0 ? 'increase' : 'decrease';
        return {
          success: true,
          query: originalQuery,
          interpretation: `Year-over-year change in ${column.name}`,
          result: { absolute: yoyResult.absolute, percentage: yoyResult.percentage, currentYear: yoyResult.currentYear, previousYear: yoyResult.previousYear },
          resultType: 'table',
          explanation: `${column.name} shows a ${Math.abs(yoyResult.percentage).toFixed(1)}% ${direction} year-over-year (${yoyResult.previousYear.toLocaleString()} → ${yoyResult.currentYear.toLocaleString()}, change: ${yoyResult.absolute >= 0 ? '+' : ''}${yoyResult.absolute.toLocaleString()}).`,
          confidence: 0.9
        };
      }
    }

    // Quarter-over-Quarter change
    match = query.match(QUERY_PATTERNS.qoqChange);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');
      if (column && column.type === 'number' && dateCol) {
        const qoqResult = calculateQoQChange(dataset, column.name, dateCol.name);
        const direction = qoqResult.percentage >= 0 ? 'increase' : 'decrease';
        return {
          success: true,
          query: originalQuery,
          interpretation: `Quarter-over-quarter change in ${column.name}`,
          result: qoqResult,
          resultType: 'number',
          explanation: `${column.name} shows a ${Math.abs(qoqResult.percentage).toFixed(1)}% ${direction} quarter-over-quarter (change: ${qoqResult.absolute >= 0 ? '+' : ''}${qoqResult.absolute.toLocaleString()}).`,
          confidence: 0.9
        };
      }
    }

    // Month-over-Month change
    match = query.match(QUERY_PATTERNS.momChange);
    if (match) {
      const column = findMatchingColumn(match[1].trim(), dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');
      if (column && column.type === 'number' && dateCol) {
        const momResult = calculateMoMChange(dataset, column.name, dateCol.name);
        const direction = momResult.percentage >= 0 ? 'increase' : 'decrease';
        return {
          success: true,
          query: originalQuery,
          interpretation: `Month-over-month change in ${column.name}`,
          result: momResult,
          resultType: 'number',
          explanation: `${column.name} shows a ${Math.abs(momResult.percentage).toFixed(1)}% ${direction} month-over-month (change: ${momResult.absolute >= 0 ? '+' : ''}${momResult.absolute.toLocaleString()}).`,
          confidence: 0.9
        };
      }
    }

    // Values in last period (last month, last quarter, last year)
    match = query.match(QUERY_PATTERNS.salesLastPeriod);
    if (match) {
      const columnTerm = match[1].trim();
      const period = match[2].toLowerCase();
      const column = findMatchingColumn(columnTerm, dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');

      if (column && column.type === 'number' && dateCol) {
        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        if (period === 'month') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        } else if (period === 'quarter') {
          const currentQ = Math.floor(now.getMonth() / 3);
          startDate = new Date(now.getFullYear(), (currentQ - 1) * 3, 1);
          endDate = new Date(now.getFullYear(), currentQ * 3, 0);
        } else if (period === 'year') {
          startDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate = new Date(now.getFullYear() - 1, 11, 31);
        } else {
          // week
          const dayOfWeek = now.getDay();
          startDate = new Date(now);
          startDate.setDate(now.getDate() - dayOfWeek - 7);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
        }

        const filtered = dataset.data.filter(row => {
          const d = new Date(row[dateCol.name]);
          return d >= startDate && d <= endDate;
        });

        const values = filtered.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        const total = values.reduce((a, b) => a + b, 0);

        return {
          success: true,
          query: originalQuery,
          interpretation: `Total ${column.name} for last ${period}`,
          result: total,
          resultType: 'number',
          explanation: `The total ${column.name} for last ${period} (${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}) is ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} across ${values.length} records.`,
          confidence: 0.85
        };
      }
    }

    // Forecast query
    match = query.match(QUERY_PATTERNS.forecastQuery);
    if (match) {
      const periods = parseInt(match[1]) || 3;
      const columnTerm = match[2]?.trim();
      const column = columnTerm ? findMatchingColumn(columnTerm, dataset.columns) : dataset.columns.find(c => c.type === 'number');
      const dateCol = dataset.columns.find(c => c.type === 'date');

      if (column && column.type === 'number') {
        let values: number[];
        if (dateCol) {
          // Sort by date and extract values
          const sorted = [...dataset.data]
            .filter(r => !isNaN(new Date(r[dateCol.name]).getTime()) && !isNaN(Number(r[column.name])))
            .sort((a, b) => new Date(a[dateCol.name]).getTime() - new Date(b[dateCol.name]).getTime());
          values = sorted.map(r => Number(r[column.name]));
        } else {
          values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        }

        if (values.length >= 5) {
          const forecastResult = timeSeriesForecast(values, Math.min(periods, 12), 'exponential');
          const lastActual = values[values.length - 1];
          const finalForecast = forecastResult[forecastResult.length - 1];

          return {
            success: true,
            query: originalQuery,
            interpretation: `Forecast next ${periods} periods for ${column.name}`,
            result: forecastResult.map((fp, i) => ({
              Period: `Period +${i + 1}`,
              Forecast: Math.round(fp.value * 100) / 100,
              Lower: Math.round((fp.lower || fp.value * 0.9) * 100) / 100,
              Upper: Math.round((fp.upper || fp.value * 1.1) * 100) / 100
            })),
            resultType: 'table',
            explanation: `Forecast for ${column.name} over the next ${periods} periods. Current value: ${lastActual.toLocaleString()}. Projected to reach ${Math.round(finalForecast.value).toLocaleString()} (range: ${Math.round(finalForecast.lower || finalForecast.value * 0.9).toLocaleString()} to ${Math.round(finalForecast.upper || finalForecast.value * 1.1).toLocaleString()}).`,
            confidence: 0.75,
            suggestedVisualization: { type: 'line', title: `${column.name} Forecast` }
          };
        }
      }
    }

    // Trend over time query
    match = query.match(QUERY_PATTERNS.trendOverTime);
    if (match) {
      const columnTerm = match[1].trim();
      const column = findMatchingColumn(columnTerm, dataset.columns);
      const dateCol = dataset.columns.find(c => c.type === 'date');

      if (column && column.type === 'number' && dateCol) {
        const aggregated = aggregateByDatePeriod(dataset.data, dateCol.name, column.name, 'monthly');
        if (aggregated.length > 0) {
          return {
            success: true,
            query: originalQuery,
            interpretation: `Monthly trend of ${column.name}`,
            result: aggregated.map(a => ({
              Period: a.period,
              Total: Math.round(a.sum * 100) / 100,
              Average: Math.round(a.avg * 100) / 100,
              Count: a.count
            })),
            resultType: 'table',
            explanation: `Monthly trend of ${column.name} over ${aggregated.length} periods. Ranges from ${Math.round(Math.min(...aggregated.map(a => a.sum))).toLocaleString()} to ${Math.round(Math.max(...aggregated.map(a => a.sum))).toLocaleString()}.`,
            confidence: 0.85,
            suggestedVisualization: {
              type: 'line',
              title: `${column.name} Monthly Trend`,
              data: aggregated.map(a => ({ category: a.period, value: a.sum }))
            }
          };
        }
      }
    }

    // ============================================================
    // Phase B7: Compound Condition Queries
    // ============================================================

    // Compound AND filter
    match = query.match(QUERY_PATTERNS.compoundAnd);
    if (match) {
      const cond1 = parseFilterCondition(match[1].trim(), dataset.columns);
      const cond2 = parseFilterCondition(match[2].trim(), dataset.columns);

      if (cond1 && cond2) {
        const filtered = dataset.data.filter(row => {
          const pass1 = applyCondition(row, cond1);
          const pass2 = applyCondition(row, cond2);
          return pass1 && pass2;
        });

        return {
          success: true,
          query: originalQuery,
          interpretation: `Filter where ${cond1.column} ${cond1.operator} ${cond1.value} AND ${cond2.column} ${cond2.operator} ${cond2.value}`,
          result: filtered.slice(0, 100),
          resultType: 'table',
          explanation: `Found ${filtered.length} records matching both conditions.${filtered.length > 100 ? ' Showing first 100.' : ''}`,
          confidence: 0.8
        };
      }
    }

    // Compound OR filter
    match = query.match(QUERY_PATTERNS.compoundOr);
    if (match) {
      const cond1 = parseFilterCondition(match[1].trim(), dataset.columns);
      const cond2 = parseFilterCondition(match[2].trim(), dataset.columns);

      if (cond1 && cond2) {
        const filtered = dataset.data.filter(row => {
          const pass1 = applyCondition(row, cond1);
          const pass2 = applyCondition(row, cond2);
          return pass1 || pass2;
        });

        return {
          success: true,
          query: originalQuery,
          interpretation: `Filter where ${cond1.column} ${cond1.operator} ${cond1.value} OR ${cond2.column} ${cond2.operator} ${cond2.value}`,
          result: filtered.slice(0, 100),
          resultType: 'table',
          explanation: `Found ${filtered.length} records matching either condition.${filtered.length > 100 ? ' Showing first 100.' : ''}`,
          confidence: 0.8
        };
      }
    }

    // Top N with WHERE clause
    match = query.match(QUERY_PATTERNS.topNWhere);
    if (match) {
      const n = parseInt(match[1]);
      const targetTerm = match[2].trim();
      const conditionStr = match[3].trim();

      const sortColumn = findMatchingColumn(targetTerm, dataset.columns) || dataset.columns.find(c => c.type === 'number');
      const condition = parseFilterCondition(conditionStr, dataset.columns);

      if (sortColumn && sortColumn.type === 'number' && condition) {
        const filtered = dataset.data.filter(row => applyCondition(row, condition));
        const sorted = [...filtered]
          .sort((a, b) => Number(b[sortColumn.name]) - Number(a[sortColumn.name]))
          .slice(0, n);

        return {
          success: true,
          query: originalQuery,
          interpretation: `Top ${n} by ${sortColumn.name} where ${condition.column} ${condition.operator} ${condition.value}`,
          result: sorted,
          resultType: 'table',
          explanation: `Top ${n} records by ${sortColumn.name} from ${filtered.length} records matching the condition.`,
          confidence: 0.8,
          suggestedVisualization: { type: 'bar', title: `Top ${n} ${sortColumn.name} (filtered)` }
        };
      }
    }

    // ============================================================
    // Phase B7: Statistical Queries
    // ============================================================

    // Significant difference test
    match = query.match(QUERY_PATTERNS.significantDiff);
    if (match) {
      const term1 = match[1].trim();
      const term2 = match[2].trim();

      // Try to interpret as column comparison or group comparison
      const col1 = findMatchingColumn(term1, dataset.columns);
      const col2 = findMatchingColumn(term2, dataset.columns);

      if (col1 && col2 && col1.type === 'number' && col2.type === 'number') {
        // Compare two numeric columns
        const values1 = dataset.data.map(r => Number(r[col1.name])).filter(v => !isNaN(v));
        const values2 = dataset.data.map(r => Number(r[col2.name])).filter(v => !isNaN(v));

        if (values1.length >= 5 && values2.length >= 5) {
          const testResult = tTest(values1, values2);
          return {
            success: true,
            query: originalQuery,
            interpretation: `Statistical test: ${col1.name} vs ${col2.name}`,
            result: { testName: testResult.testName, tStatistic: testResult.statistic, pValue: testResult.pValue, significant: testResult.significant, effectSize: testResult.effectSize },
            resultType: 'table',
            explanation: testResult.interpretation,
            confidence: 0.9
          };
        }
      } else if (col2 && col2.type === 'string') {
        // Compare groups defined by a categorical column
        const numCol = dataset.columns.find(c => c.type === 'number' && c.name.toLowerCase().includes(term1.toLowerCase()))
          || dataset.columns.find(c => c.type === 'number');

        if (numCol) {
          const groups: Record<string, number[]> = {};
          dataset.data.forEach(row => {
            const cat = String(row[col2.name] || '');
            const val = Number(row[numCol.name]);
            if (cat && !isNaN(val)) {
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(val);
            }
          });

          const groupNames = Object.keys(groups);
          if (groupNames.length >= 2) {
            const testResult = tTest(groups[groupNames[0]], groups[groupNames[1]]);
            return {
              success: true,
              query: originalQuery,
              interpretation: `Statistical test: ${numCol.name} between ${groupNames[0]} and ${groupNames[1]}`,
              result: { groups: groupNames.slice(0, 2), testName: testResult.testName, pValue: testResult.pValue, significant: testResult.significant },
              resultType: 'table',
              explanation: `${testResult.interpretation} Comparing "${groupNames[0]}" (n=${groups[groupNames[0]].length}) vs "${groupNames[1]}" (n=${groups[groupNames[1]].length}) on ${numCol.name}.`,
              confidence: 0.85
            };
          }
        }
      }
    }

    // Cluster/segment query
    match = query.match(QUERY_PATTERNS.clusterQuery);
    if (match) {
      const columnTerms = match[1].trim();
      const numericCols = dataset.columns.filter(c => c.type === 'number');
      const colNames = numericCols.slice(0, 5).map(c => c.name);

      if (colNames.length >= 2) {
        const result = kMeansClustering(dataset, colNames);
        return {
          success: true,
          query: originalQuery,
          interpretation: `K-means clustering using ${colNames.join(', ')}`,
          result: result.clusters.map(c => ({
            Cluster: `Cluster ${c.clusterId + 1}`,
            Size: c.size,
            Description: c.characteristics,
            ...c.centroid
          })),
          resultType: 'table',
          explanation: `${result.interpretation} Found ${result.optimalK} natural segments (silhouette score: ${result.silhouetteScore.toFixed(3)}).`,
          confidence: 0.8
        };
      }
    }

    // Predict/regression query
    match = query.match(QUERY_PATTERNS.predictQuery);
    if (match) {
      const targetTerm = match[1].trim();
      const targetCol = findMatchingColumn(targetTerm, dataset.columns);

      if (targetCol && targetCol.type === 'number') {
        const predictors = dataset.columns
          .filter(c => c.type === 'number' && c.name !== targetCol.name)
          .slice(0, 5)
          .map(c => c.name);

        if (predictors.length >= 1) {
          const regResult = multipleRegression(dataset, targetCol.name, predictors);
          return {
            success: true,
            query: originalQuery,
            interpretation: `Regression analysis: what predicts ${targetCol.name}`,
            result: {
              equation: regResult.equation,
              rSquared: regResult.rSquared,
              adjustedRSquared: regResult.adjustedRSquared,
              significantPredictors: regResult.significantPredictors,
              coefficients: regResult.coefficients
            },
            resultType: 'table',
            explanation: regResult.interpretation,
            confidence: 0.8
          };
        }
      }
    }

    // ============================================================
    // Phase B7: What-If Queries
    // ============================================================

    // What if increase
    match = query.match(QUERY_PATTERNS.whatIfIncrease);
    if (match) {
      const columnTerm = match[1].trim();
      const amount = parseFloat(match[2]);
      const isPercent = match[3] !== undefined;
      const column = findMatchingColumn(columnTerm, dataset.columns);

      if (column && column.type === 'number' && !isNaN(amount)) {
        const values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        const currentSum = values.reduce((a, b) => a + b, 0);
        const currentAvg = currentSum / values.length;

        const factor = isPercent ? (1 + amount / 100) : undefined;
        const newValues = isPercent
          ? values.map(v => v * (1 + amount / 100))
          : values.map(v => v + amount);

        const newSum = newValues.reduce((a, b) => a + b, 0);
        const newAvg = newSum / newValues.length;

        // Check impact on correlated columns
        const numericCols = dataset.columns.filter(c => c.type === 'number' && c.name !== column.name);
        const impactNotes: string[] = [];

        numericCols.slice(0, 3).forEach(otherCol => {
          const otherValues = dataset.data.map(r => Number(r[otherCol.name])).filter(v => !isNaN(v));
          if (otherValues.length === values.length) {
            const n = values.length;
            const sumX = values.reduce((a, b) => a + b, 0);
            const sumY = otherValues.reduce((a, b) => a + b, 0);
            const sumXY = values.reduce((t, xi, i) => t + xi * otherValues[i], 0);
            const sumX2 = values.reduce((a, b) => a + b * b, 0);
            const sumY2 = otherValues.reduce((a, b) => a + b * b, 0);
            const denom = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
            const corr = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

            if (Math.abs(corr) > 0.5) {
              const changePercent = isPercent ? amount : ((amount / currentAvg) * 100);
              const estimatedImpact = (changePercent * corr).toFixed(1);
              impactNotes.push(`${otherCol.name} may ${corr > 0 ? 'increase' : 'decrease'} by ~${Math.abs(parseFloat(estimatedImpact))}% (correlation: ${corr.toFixed(2)})`);
            }
          }
        });

        return {
          success: true,
          query: originalQuery,
          interpretation: `What-if: ${column.name} increases by ${amount}${isPercent ? '%' : ''}`,
          result: {
            currentTotal: Math.round(currentSum * 100) / 100,
            projectedTotal: Math.round(newSum * 100) / 100,
            currentAverage: Math.round(currentAvg * 100) / 100,
            projectedAverage: Math.round(newAvg * 100) / 100,
            change: Math.round((newSum - currentSum) * 100) / 100
          },
          resultType: 'table',
          explanation: `If ${column.name} increases by ${amount}${isPercent ? '%' : ''}: Total changes from ${currentSum.toLocaleString()} to ${newSum.toLocaleString()} (${isPercent ? '+' + amount + '%' : '+' + amount + ' per record'}). Average: ${currentAvg.toFixed(2)} → ${newAvg.toFixed(2)}.${impactNotes.length > 0 ? ' Ripple effects: ' + impactNotes.join('; ') + '.' : ''}`,
          confidence: 0.8
        };
      }
    }

    // What if decrease
    match = query.match(QUERY_PATTERNS.whatIfDecrease);
    if (match) {
      const columnTerm = match[1].trim();
      const amount = parseFloat(match[2]);
      const isPercent = match[3] !== undefined;
      const column = findMatchingColumn(columnTerm, dataset.columns);

      if (column && column.type === 'number' && !isNaN(amount)) {
        const values = dataset.data.map(r => Number(r[column.name])).filter(v => !isNaN(v));
        const currentSum = values.reduce((a, b) => a + b, 0);
        const currentAvg = currentSum / values.length;

        const newValues = isPercent
          ? values.map(v => v * (1 - amount / 100))
          : values.map(v => v - amount);

        const newSum = newValues.reduce((a, b) => a + b, 0);
        const newAvg = newSum / newValues.length;

        return {
          success: true,
          query: originalQuery,
          interpretation: `What-if: ${column.name} decreases by ${amount}${isPercent ? '%' : ''}`,
          result: {
            currentTotal: Math.round(currentSum * 100) / 100,
            projectedTotal: Math.round(newSum * 100) / 100,
            currentAverage: Math.round(currentAvg * 100) / 100,
            projectedAverage: Math.round(newAvg * 100) / 100,
            change: Math.round((newSum - currentSum) * 100) / 100
          },
          resultType: 'table',
          explanation: `If ${column.name} decreases by ${amount}${isPercent ? '%' : ''}: Total changes from ${currentSum.toLocaleString()} to ${newSum.toLocaleString()}. Average: ${currentAvg.toFixed(2)} → ${newAvg.toFixed(2)}.`,
          confidence: 0.8
        };
      }
    }

    // What if remove outliers
    match = query.match(QUERY_PATTERNS.whatIfRemoveOutliers);
    if (match) {
      const columnTerm = match[1]?.trim();
      const targetCols = columnTerm
        ? [findMatchingColumn(columnTerm, dataset.columns)].filter(Boolean) as ColumnInfo[]
        : dataset.columns.filter(c => c.type === 'number');

      const results: any[] = [];
      targetCols.slice(0, 5).forEach(col => {
        const values = dataset.data.map(r => Number(r[col.name])).filter(v => !isNaN(v));
        if (values.length < 10) return;

        const sorted = [...values].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 1.5 * iqr;

        const cleaned = values.filter(v => v >= lower && v <= upper);
        const removed = values.length - cleaned.length;

        if (removed > 0) {
          const oldAvg = values.reduce((a, b) => a + b, 0) / values.length;
          const newAvg = cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
          const oldStd = Math.sqrt(values.reduce((s, v) => s + (v - oldAvg) ** 2, 0) / values.length);
          const newStd = Math.sqrt(cleaned.reduce((s, v) => s + (v - newAvg) ** 2, 0) / cleaned.length);

          results.push({
            Column: col.name,
            'Outliers Removed': removed,
            'Old Average': Math.round(oldAvg * 100) / 100,
            'New Average': Math.round(newAvg * 100) / 100,
            'Avg Change': `${((newAvg - oldAvg) / oldAvg * 100).toFixed(1)}%`,
            'Old StdDev': Math.round(oldStd * 100) / 100,
            'New StdDev': Math.round(newStd * 100) / 100,
            'Variance Reduction': `${((1 - newStd / oldStd) * 100).toFixed(1)}%`
          });
        }
      });

      if (results.length > 0) {
        const totalRemoved = results.reduce((s, r) => s + r['Outliers Removed'], 0);
        return {
          success: true,
          query: originalQuery,
          interpretation: `What-if: remove outliers from ${results.map(r => r.Column).join(', ')}`,
          result: results,
          resultType: 'table',
          explanation: `Removing ${totalRemoved} outlier(s) using IQR method. ${results.map(r => `${r.Column}: average shifts by ${r['Avg Change']}, variance reduces by ${r['Variance Reduction']}`).join('. ')}.`,
          confidence: 0.85
        };
      }
    }

    // If no pattern matched, try to understand the intent
    const numericColumns = dataset.columns.filter(c => c.type === 'number');
    const categoricalColumns = dataset.columns.filter(c => c.type === 'string');
    
    // Check if any column name is mentioned
    for (const col of dataset.columns) {
      if (query.toLowerCase().includes(col.name.toLowerCase())) {
        if (col.type === 'number') {
          // Show summary for numeric column
          const values = dataset.data.map(r => Number(r[col.name])).filter(v => !isNaN(v));
          const sum = values.reduce((a, b) => a + b, 0);
          const avg = sum / values.length;
          
          return {
            success: true,
            query: originalQuery,
            interpretation: `Summary statistics for ${col.name}`,
            result: {
              Sum: sum,
              Average: Math.round(avg * 100) / 100,
              Min: col.min,
              Max: col.max,
              Count: values.length
            },
            resultType: 'table',
            explanation: `Here's a summary of ${col.name}. Try asking specific questions like "what is the average ${col.name}?" or "show ${col.name} by category".`,
            confidence: 0.6,
            alternativeQueries: [
              `What is the total ${col.name}?`,
              `What is the average ${col.name}?`,
              categoricalColumns[0] ? `Show ${col.name} by ${categoricalColumns[0].name}` : `What is the maximum ${col.name}?`
            ]
          };
        } else {
          // Show distribution for categorical column
          const counts: Record<string, number> = {};
          dataset.data.forEach(row => {
            const val = String(row[col.name] || 'Unknown');
            counts[val] = (counts[val] || 0) + 1;
          });
          
          return {
            success: true,
            query: originalQuery,
            interpretation: `Distribution of ${col.name}`,
            result: Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([category, count]) => ({ [col.name]: category, Count: count })),
            resultType: 'table',
            explanation: `Here's the distribution of ${col.name}. There are ${col.uniqueCount} unique values.`,
            confidence: 0.6,
            alternativeQueries: [
              `How many ${col.name}s are there?`,
              numericColumns[0] ? `Total ${numericColumns[0].name} by ${col.name}` : `Show distribution of ${col.name}`
            ]
          };
        }
      }
    }
    
    return defaultResult;
    
  } catch (error) {
    console.error('Query execution error:', error);
    return {
      ...defaultResult,
      explanation: `An error occurred while processing your query. Please try rephrasing it.`
    };
  }
};

/**
 * Generate smart query suggestions based on dataset
 */
export const generateSuggestions = (dataset: Dataset): QuerySuggestion[] => {
  const suggestions: QuerySuggestion[] = [];
  
  const numericColumns = dataset.columns.filter(c => c.type === 'number');
  const categoricalColumns = dataset.columns.filter(c => c.type === 'string');
  const dateColumns = dataset.columns.filter(c => c.type === 'date');
  
  // Aggregation suggestions
  if (numericColumns.length > 0) {
    const numCol = numericColumns[0];
    suggestions.push({
      text: `What is the total ${numCol.name}?`,
      category: 'aggregation',
      icon: '📊'
    });
    suggestions.push({
      text: `What is the average ${numCol.name}?`,
      category: 'aggregation',
      icon: '📈'
    });
  }
  
  // Comparison suggestions
  if (numericColumns.length > 0 && categoricalColumns.length > 0) {
    const numCol = numericColumns[0];
    const catCol = categoricalColumns[0];
    suggestions.push({
      text: `Show ${numCol.name} by ${catCol.name}`,
      category: 'comparison',
      icon: '📉'
    });
    suggestions.push({
      text: `Top 10 ${catCol.name} by ${numCol.name}`,
      category: 'comparison',
      icon: '🏆'
    });
  }
  
  // Distribution suggestions
  if (categoricalColumns.length > 0) {
    suggestions.push({
      text: `Show distribution of ${categoricalColumns[0].name}`,
      category: 'comparison',
      icon: '🥧'
    });
  }
  
  // Correlation suggestions
  if (numericColumns.length >= 2) {
    suggestions.push({
      text: `Is there a correlation between ${numericColumns[0].name} and ${numericColumns[1].name}?`,
      category: 'relationship',
      icon: '🔗'
    });
  }
  
  // Trend suggestions
  if (dateColumns.length > 0 && numericColumns.length > 0) {
    suggestions.push({
      text: `Show trend of ${numericColumns[0].name}`,
      category: 'trend',
      icon: '📈'
    });
  }
  
  // Filter suggestions
  if (categoricalColumns.length > 0) {
    const col = categoricalColumns[0];
    const sampleValue = col.sampleValues[0];
    if (sampleValue) {
      suggestions.push({
        text: `Show all records where ${col.name} is ${sampleValue}`,
        category: 'filter',
        icon: '🔍'
      });
    }
  }
  
  // Count suggestion
  suggestions.push({
    text: `How many records are there?`,
    category: 'aggregation',
    icon: '🔢'
  });

  // Phase B7: Time intelligence suggestions
  if (dateColumns.length > 0 && numericColumns.length > 0) {
    const numCol = numericColumns[0];
    suggestions.push({
      text: `YTD ${numCol.name}`,
      category: 'time_intelligence',
      icon: '📅'
    });
    suggestions.push({
      text: `Year over year change of ${numCol.name}`,
      category: 'time_intelligence',
      icon: '📊'
    });
    suggestions.push({
      text: `Forecast next 6 periods of ${numCol.name}`,
      category: 'time_intelligence',
      icon: '🔮'
    });
    suggestions.push({
      text: `Trend of ${numCol.name} over time`,
      category: 'time_intelligence',
      icon: '📈'
    });
    suggestions.push({
      text: `${numCol.name} last quarter`,
      category: 'time_intelligence',
      icon: '⏰'
    });
  }

  // Phase B7: Statistical suggestions
  if (numericColumns.length >= 2) {
    suggestions.push({
      text: `Segment the data`,
      category: 'statistical',
      icon: '🎯'
    });
    suggestions.push({
      text: `What predicts ${numericColumns[0].name}?`,
      category: 'statistical',
      icon: '🧪'
    });
  }
  if (numericColumns.length > 0 && categoricalColumns.length > 0) {
    suggestions.push({
      text: `Is there a significant difference in ${numericColumns[0].name} by ${categoricalColumns[0].name}?`,
      category: 'statistical',
      icon: '📐'
    });
  }

  // Phase B7: What-if suggestions
  if (numericColumns.length > 0) {
    const numCol = numericColumns[0];
    suggestions.push({
      text: `What if ${numCol.name} increases by 10%?`,
      category: 'what_if',
      icon: '💡'
    });
    suggestions.push({
      text: `What if we remove outliers from ${numCol.name}?`,
      category: 'what_if',
      icon: '🧹'
    });
  }

  return suggestions;
};

/**
 * Parse a simple query and return structured data
 */
export const parseQuery = (query: string): {
  action: string;
  columns: string[];
  conditions: string[];
  groupBy?: string;
  orderBy?: string;
  limit?: number;
} => {
  const result = {
    action: 'unknown',
    columns: [] as string[],
    conditions: [] as string[]
  };
  
  // Detect action
  if (/what\s+if/i.test(query)) result.action = 'what_if';
  else if (/forecast|predict(?!s)|project|estimate/i.test(query)) result.action = 'forecast';
  else if (/ytd|year.to.date/i.test(query)) result.action = 'ytd';
  else if (/yoy|year.over.year|qoq|quarter.over|mom|month.over/i.test(query)) result.action = 'period_comparison';
  else if (/cluster|segment/i.test(query)) result.action = 'cluster';
  else if (/significant|statistical/i.test(query)) result.action = 'hypothesis_test';
  else if (/predicts?|drives?|explains?|determines?/i.test(query)) result.action = 'regression';
  else if (/sum|total|add/i.test(query)) result.action = 'sum';
  else if (/average|mean|avg/i.test(query)) result.action = 'average';
  else if (/count|how many/i.test(query)) result.action = 'count';
  else if (/max|maximum|highest|top/i.test(query)) result.action = 'max';
  else if (/min|minimum|lowest|bottom/i.test(query)) result.action = 'min';
  else if (/show|display|list|find|get/i.test(query)) result.action = 'select';
  else if (/compare|vs|versus/i.test(query)) result.action = 'compare';
  else if (/trend|growth|change/i.test(query)) result.action = 'trend';
  else if (/correlation|relationship/i.test(query)) result.action = 'correlation';

  return result;
};

/**
 * Validate if a query is well-formed
 */
export const validateQuery = (query: string, dataset: Dataset): {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
} => {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  if (query.length < 5) {
    issues.push('Query is too short');
    suggestions.push('Try asking a complete question like "What is the total sales?"');
  }
  
  if (query.length > 500) {
    issues.push('Query is too long');
    suggestions.push('Try breaking down your question into simpler parts');
  }
  
  // Check if any column is referenced
  const mentionsColumn = dataset.columns.some(c => 
    query.toLowerCase().includes(c.name.toLowerCase())
  );
  
  if (!mentionsColumn && !/count|how many|rows|records/i.test(query)) {
    suggestions.push(`Try mentioning a specific column like "${dataset.columns[0].name}"`);
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    suggestions
  };
};
