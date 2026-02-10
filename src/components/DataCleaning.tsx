// Data Cleaning Component
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Sparkles, 
  Trash2, 
  RefreshCw, 
  Type, 
  TrendingDown, 
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Database,
  Filter,
  Scissors
} from 'lucide-react';
import { Dataset } from '@/lib/types';
import {
  removeDuplicates,
  removeMissingRows,
  fillMissingWithDefault,
  fillMissingWithMean,
  fillMissingWithMedian,
  trimWhitespace,
  removeOutliers,
  convertToLowerCase,
  convertToUpperCase,
  removeSpecialCharacters,
  CleaningResult
} from '@/lib/dataCleaningUtils';
import { toast } from 'sonner';

interface DataCleaningProps {
  dataset: Dataset;
  onDatasetUpdate: (dataset: Dataset) => void;
}

const DataCleaning: React.FC<DataCleaningProps> = ({ dataset, onDatasetUpdate }) => {
  const [history, setHistory] = useState<Dataset[]>([dataset]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [fillValue, setFillValue] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastResult, setLastResult] = useState<CleaningResult | null>(null);

  const currentDataset = history[historyIndex];
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const stringColumns = useMemo(() => 
    currentDataset.columns.filter(col => col.type === 'string').map(col => col.name),
    [currentDataset]
  );

  const numericColumns = useMemo(() => 
    currentDataset.columns.filter(col => col.type === 'number').map(col => col.name),
    [currentDataset]
  );

  const applyCleaning = (result: CleaningResult) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(result.dataset);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setLastResult(result);
    onDatasetUpdate(result.dataset);
    
    toast.success(
      `Cleaning applied: ${result.operationsPerformed.join(', ')}. ` +
      `${result.rowsRemoved > 0 ? `${result.rowsRemoved} rows removed. ` : ''}` +
      `Dataset now has ${result.dataset.rowCount} rows.`
    );
  };

  const handleRemoveDuplicates = () => {
    try {
      const result = removeDuplicates(currentDataset);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error removing duplicates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRemoveMissingRows = () => {
    try {
      const result = removeMissingRows(currentDataset);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error removing missing rows: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFillMissingDefault = () => {
    if (!selectedColumn) {
      toast.error('Please select a column');
      return;
    }
    if (fillValue === '') {
      toast.error('Please enter a default value');
      return;
    }

    try {
      const result = fillMissingWithDefault(currentDataset, selectedColumn, fillValue);
      applyCleaning(result);
      setFillValue('');
    } catch (error) {
      toast.error(`Error filling missing values: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFillMissingMean = () => {
    if (!selectedColumn || !numericColumns.includes(selectedColumn)) {
      toast.error('Please select a numeric column');
      return;
    }

    try {
      const result = fillMissingWithMean(currentDataset, selectedColumn);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error filling with mean: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFillMissingMedian = () => {
    if (!selectedColumn || !numericColumns.includes(selectedColumn)) {
      toast.error('Please select a numeric column');
      return;
    }

    try {
      const result = fillMissingWithMedian(currentDataset, selectedColumn);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error filling with median: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleTrimWhitespace = () => {
    try {
      const columns = selectedColumn ? [selectedColumn] : undefined;
      const result = trimWhitespace(currentDataset, columns);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error trimming whitespace: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRemoveOutliers = () => {
    if (!selectedColumn || !numericColumns.includes(selectedColumn)) {
      toast.error('Please select a numeric column');
      return;
    }

    try {
      const result = removeOutliers(currentDataset, selectedColumn);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error removing outliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleConvertCase = (caseType: 'lowercase' | 'uppercase') => {
    if (!selectedColumn || !stringColumns.includes(selectedColumn)) {
      toast.error('Please select a string column');
      return;
    }

    try {
      const result = caseType === 'lowercase' 
        ? convertToLowerCase(currentDataset, selectedColumn)
        : convertToUpperCase(currentDataset, selectedColumn);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error converting case: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRemoveSpecialChars = () => {
    if (!selectedColumn || !stringColumns.includes(selectedColumn)) {
      toast.error('Please select a string column');
      return;
    }

    try {
      const result = removeSpecialCharacters(currentDataset, selectedColumn);
      applyCleaning(result);
    } catch (error) {
      toast.error(`Error removing special characters: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleUndo = () => {
    if (canUndo) {
      setHistoryIndex(historyIndex - 1);
      onDatasetUpdate(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      setHistoryIndex(historyIndex + 1);
      onDatasetUpdate(history[historyIndex + 1]);
    }
  };

  const handleReset = () => {
    setHistory([dataset]);
    setHistoryIndex(0);
    setLastResult(null);
    onDatasetUpdate(dataset);
    toast.info('Dataset reset to original');
  };

  const totalNulls = currentDataset.columns.reduce((sum, col) => sum + col.nullCount, 0);
  const totalCells = currentDataset.rowCount * currentDataset.columns.length;
  const dataQuality = totalCells > 0 ? ((totalCells - totalNulls) / totalCells * 100).toFixed(1) : '0';

  return (
    <div className="space-y-4">
      {/* Header with Statistics */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                Data Cleaning
              </CardTitle>
              <CardDescription>
                Clean and prepare your data for analysis
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {canUndo && (
                <Button variant="outline" size="sm" onClick={handleUndo}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Undo
                </Button>
              )}
              {canRedo && (
                <Button variant="outline" size="sm" onClick={handleRedo} disabled={!canRedo}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Redo
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleReset}>
                <Database className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{currentDataset.rowCount}</div>
              <div className="text-sm text-gray-600">Total Rows</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{totalNulls}</div>
              <div className="text-sm text-gray-600">Null Values</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{dataQuality}%</div>
              <div className="text-sm text-gray-600">Data Quality</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">{currentDataset.columns.length}</div>
              <div className="text-sm text-gray-600">Columns</div>
            </div>
          </div>

          {lastResult && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-green-900">Last Operation</div>
                  <div className="text-sm text-green-700 mt-1">
                    {lastResult.operationsPerformed.join(', ')}
                  </div>
                  {lastResult.rowsRemoved > 0 && (
                    <div className="text-xs text-green-600 mt-1">
                      {lastResult.rowsRemoved} rows removed
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Column Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Column</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedColumn} onValueChange={setSelectedColumn}>
            <SelectTrigger>
              <SelectValue placeholder="Select a column to clean" />
            </SelectTrigger>
            <SelectContent>
              {currentDataset.columns.map(col => (
                <SelectItem key={col.name} value={col.name}>
                  {col.name} ({col.type}) - {col.nullCount} nulls
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Cleaning Operations */}
      <Tabs defaultValue="duplicates" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          <TabsTrigger value="missing">Missing Values</TabsTrigger>
          <TabsTrigger value="text">Text Cleaning</TabsTrigger>
          <TabsTrigger value="numeric">Numeric</TabsTrigger>
        </TabsList>

        {/* Remove Duplicates */}
        <TabsContent value="duplicates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Remove Duplicates
              </CardTitle>
              <CardDescription>
                Remove rows that are completely identical
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleRemoveDuplicates} className="w-full">
                Remove Duplicate Rows
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Missing Values */}
        <TabsContent value="missing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Handle Missing Values
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Button 
                  onClick={handleRemoveMissingRows} 
                  variant="outline" 
                  className="w-full mb-4"
                >
                  Remove Rows with Missing Values
                </Button>
                <p className="text-xs text-gray-500">
                  Removes entire rows that have any missing values
                </p>
              </div>

              <div className="border-t pt-4 space-y-4">
                <div>
                  <Label>Fill Missing Values</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      placeholder="Default value"
                      value={fillValue}
                      onChange={(e) => setFillValue(e.target.value)}
                      className="flex-1"
                    />
                    <Button 
                      onClick={handleFillMissingDefault}
                      disabled={!selectedColumn || !fillValue}
                    >
                      Fill
                    </Button>
                  </div>
                </div>

                {numericColumns.length > 0 && selectedColumn && numericColumns.includes(selectedColumn) && (
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleFillMissingMean} 
                      variant="outline" 
                      className="flex-1"
                    >
                      Fill with Mean
                    </Button>
                    <Button 
                      onClick={handleFillMissingMedian} 
                      variant="outline" 
                      className="flex-1"
                    >
                      Fill with Median
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Text Cleaning */}
        <TabsContent value="text" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Type className="h-4 w-4" />
                Text Cleaning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedColumn || !stringColumns.includes(selectedColumn) ? (
                <div className="text-center py-8 text-gray-500">
                  Please select a string column to clean text
                </div>
              ) : (
                <>
                  <Button 
                    onClick={handleTrimWhitespace} 
                    variant="outline" 
                    className="w-full"
                  >
                    <Scissors className="h-4 w-4 mr-2" />
                    Trim Whitespace
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                      onClick={() => handleConvertCase('lowercase')} 
                      variant="outline"
                    >
                      Convert to Lowercase
                    </Button>
                    <Button 
                      onClick={() => handleConvertCase('uppercase')} 
                      variant="outline"
                    >
                      Convert to Uppercase
                    </Button>
                  </div>

                  <Button 
                    onClick={handleRemoveSpecialChars} 
                    variant="outline" 
                    className="w-full"
                  >
                    Remove Special Characters
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numeric Operations */}
        <TabsContent value="numeric" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Numeric Operations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedColumn || !numericColumns.includes(selectedColumn) ? (
                <div className="text-center py-8 text-gray-500">
                  Please select a numeric column
                </div>
              ) : (
                <Button 
                  onClick={handleRemoveOutliers} 
                  variant="outline" 
                  className="w-full"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Remove Outliers (IQR Method)
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DataCleaning;

