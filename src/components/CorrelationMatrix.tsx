// Correlation Matrix with Heatmap - Visualize all variable relationships at once
// Helps analysts discover hidden connections in data

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Grid3X3, Info, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { Dataset } from '@/lib/types';

interface CorrelationMatrixProps {
  dataset: Dataset | null;
}

interface CorrelationCell {
  row: string;
  col: string;
  value: number;
}

const CorrelationMatrix: React.FC<CorrelationMatrixProps> = ({ dataset }) => {
  const [zoomLevel, setZoomLevel] = useState(1);

  // Calculate Pearson correlation matrix
  const { matrix, columns, correlations } = useMemo(() => {
    if (!dataset) return { matrix: [], columns: [], correlations: [] };

    const numericColumns = dataset.columns.filter(c => c.type === 'number');
    if (numericColumns.length < 2) return { matrix: [], columns: [], correlations: [] };

    const columnNames = numericColumns.map(c => c.name);
    
    // Get numeric values for each column
    const columnValues: Record<string, number[]> = {};
    columnNames.forEach(colName => {
      columnValues[colName] = dataset.data.map(row => {
        const val = Number(row[colName]);
        return isNaN(val) ? 0 : val;
      });
    });

    // Calculate correlation for each pair
    const calculateCorrelation = (x: number[], y: number[]): number => {
      const n = x.length;
      if (n === 0) return 0;

      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = y.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
      const sumX2 = x.reduce((a, b) => a + b * b, 0);
      const sumY2 = y.reduce((a, b) => a + b * b, 0);

      const numerator = n * sumXY - sumX * sumY;
      const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

      if (denominator === 0) return 0;
      return numerator / denominator;
    };

    // Build correlation matrix
    const correlationMatrix: number[][] = [];
    const allCorrelations: CorrelationCell[] = [];

    for (let i = 0; i < columnNames.length; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < columnNames.length; j++) {
        const corr = calculateCorrelation(
          columnValues[columnNames[i]],
          columnValues[columnNames[j]]
        );
        correlationMatrix[i][j] = Math.round(corr * 100) / 100;
        
        if (i < j) { // Only add unique pairs
          allCorrelations.push({
            row: columnNames[i],
            col: columnNames[j],
            value: correlationMatrix[i][j]
          });
        }
      }
    }

    // Sort correlations by absolute value
    allCorrelations.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    return {
      matrix: correlationMatrix,
      columns: columnNames,
      correlations: allCorrelations
    };
  }, [dataset]);

  // Get color for correlation value
  const getCorrelationColor = (value: number): string => {
    // Blue for negative, White for zero, Red for positive
    const absValue = Math.abs(value);
    
    if (value > 0) {
      // Positive: white to red
      const intensity = Math.min(absValue, 1);
      const r = 255;
      const g = Math.round(255 * (1 - intensity * 0.7));
      const b = Math.round(255 * (1 - intensity * 0.8));
      return `rgb(${r}, ${g}, ${b})`;
    } else if (value < 0) {
      // Negative: white to blue
      const intensity = Math.min(absValue, 1);
      const r = Math.round(255 * (1 - intensity * 0.8));
      const g = Math.round(255 * (1 - intensity * 0.6));
      const b = 255;
      return `rgb(${r}, ${g}, ${b})`;
    }
    return 'rgb(255, 255, 255)';
  };

  const getTextColor = (value: number): string => {
    return Math.abs(value) > 0.5 ? 'white' : 'black';
  };

  const getStrengthLabel = (value: number): string => {
    const abs = Math.abs(value);
    if (abs >= 0.7) return 'Strong';
    if (abs >= 0.4) return 'Moderate';
    if (abs >= 0.2) return 'Weak';
    return 'None';
  };

  const exportMatrix = () => {
    if (columns.length === 0) return;
    
    let csv = ',' + columns.join(',') + '\n';
    matrix.forEach((row, i) => {
      csv += columns[i] + ',' + row.join(',') + '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'correlation_matrix.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!dataset) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Grid3X3 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">Correlation Matrix</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Upload a dataset with numeric columns to see how variables correlate with each other.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (columns.length < 2) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Grid3X3 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">Insufficient Numeric Data</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            At least 2 numeric columns are required to create a correlation matrix.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cellSize = 50 * zoomLevel;
  const labelWidth = 100 * zoomLevel;
  const fontSize = 11 * zoomLevel;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Grid3X3 className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Correlation Matrix
                <Badge variant="secondary" className="text-xs">
                  {columns.length}×{columns.length}
                </Badge>
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Discover relationships between all numeric variables
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.25))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={exportMatrix}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Color Scale Legend */}
        <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-24 h-4 rounded" style={{
              background: 'linear-gradient(to right, rgb(50, 100, 255), white, rgb(255, 70, 70))'
            }} />
            <div className="flex justify-between w-32">
              <span>-1 (Negative)</span>
              <span>+1 (Positive)</span>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  Correlation measures how two variables move together. 
                  +1 means perfect positive correlation, -1 means perfect negative correlation, 
                  0 means no linear relationship.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Matrix Heatmap */}
        <div className="overflow-auto">
          <div style={{ display: 'inline-block', minWidth: labelWidth + columns.length * cellSize }}>
            {/* Header Row */}
            <div style={{ display: 'flex', marginLeft: labelWidth }}>
              {columns.map((col, i) => (
                <div 
                  key={i}
                  style={{ 
                    width: cellSize, 
                    height: labelWidth * 0.8,
                    fontSize: fontSize,
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    transform: 'rotate(180deg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    padding: '4px',
                    fontWeight: 500,
                    color: '#374151'
                  }}
                  title={col}
                >
                  <span style={{ 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    maxHeight: labelWidth * 0.7
                  }}>
                    {col}
                  </span>
                </div>
              ))}
            </div>

            {/* Matrix Rows */}
            {matrix.map((row, i) => (
              <div key={i} style={{ display: 'flex' }}>
                {/* Row Label */}
                <div 
                  style={{ 
                    width: labelWidth, 
                    height: cellSize,
                    fontSize: fontSize,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: '8px',
                    fontWeight: 500,
                    color: '#374151'
                  }}
                  title={columns[i]}
                >
                  <span style={{ 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: labelWidth - 16
                  }}>
                    {columns[i]}
                  </span>
                </div>

                {/* Cells */}
                {row.map((value, j) => (
                  <TooltipProvider key={j}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          style={{
                            width: cellSize,
                            height: cellSize,
                            backgroundColor: getCorrelationColor(value),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: fontSize,
                            fontWeight: Math.abs(value) > 0.5 ? 600 : 400,
                            color: getTextColor(value),
                            border: i === j ? '2px solid #6366f1' : '1px solid #e5e7eb',
                            cursor: 'pointer',
                            transition: 'transform 0.1s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.1)';
                            e.currentTarget.style.zIndex = '10';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.zIndex = '0';
                          }}
                        >
                          {value.toFixed(2)}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <p className="font-medium">{columns[i]} ↔ {columns[j]}</p>
                          <p>Correlation: <span className="font-mono">{value.toFixed(3)}</span></p>
                          <p>Strength: <span className="font-medium">{getStrengthLabel(value)}</span></p>
                          {i !== j && Math.abs(value) > 0.3 && (
                            <p className="text-xs text-gray-400 mt-1">
                              {value > 0 
                                ? 'Variables tend to increase together'
                                : 'Variables tend to move in opposite directions'}
                            </p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Top Correlations Summary */}
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Strongest Correlations</h4>
          <div className="grid grid-cols-2 gap-2">
            {correlations.slice(0, 6).map((corr, i) => (
              <div 
                key={i}
                className="flex items-center justify-between p-2 rounded-lg text-sm"
                style={{ backgroundColor: getCorrelationColor(corr.value * 0.3) }}
              >
                <span className="text-gray-700">
                  {corr.row} ↔ {corr.col}
                </span>
                <Badge 
                  variant={Math.abs(corr.value) > 0.5 ? 'default' : 'secondary'}
                  className={corr.value > 0 ? 'bg-red-500' : 'bg-blue-500'}
                >
                  {corr.value > 0 ? '+' : ''}{corr.value.toFixed(2)}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CorrelationMatrix;
