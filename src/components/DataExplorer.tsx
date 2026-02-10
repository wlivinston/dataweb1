// Enhanced Data Explorer Component with inline editing and insights
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dataset, ColumnInfo, DataInsight } from '@/lib/types';
import { updateDatasetStats, generateInsights, validateValue } from '@/lib/dataUtils';
import { Edit2, Trash2, Save, X, Eye, Lightbulb, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import PaginatedTable from './PaginatedTable';
import { isDatasetTooLarge, RENDERING_LIMITS } from '@/lib/dataOptimization';

interface DataExplorerProps {
  dataset: Dataset;
  onUpdate: (updatedDataset: Dataset) => void;
  onDeleteRow?: (rowIndex: number) => void;
}

const DataExplorer: React.FC<DataExplorerProps> = ({ dataset, onUpdate, onDeleteRow }) => {
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnName: string } | null>(null);
  const [editValue, setEditValue] = useState<any>('');
  const [insights, setInsights] = useState<DataInsight[]>([]);
  const [showInsights, setShowInsights] = useState(false);

  React.useEffect(() => {
    const generatedInsights = generateInsights(dataset);
    setInsights(generatedInsights);
  }, [dataset]);

  const handleCellClick = (rowIndex: number, columnName: string, currentValue: any) => {
    setEditingCell({ rowIndex, columnName });
    setEditValue(currentValue);
  };

  const handleCellSave = () => {
    if (!editingCell) return;

    const { rowIndex, columnName } = editingCell;
    const column = dataset.columns.find(col => col.name === columnName);
    
    if (!column) return;

    // Validate value
    const validation = validateValue(editValue, column);
    if (!validation.valid) {
      toast.error(validation.error || 'Invalid value');
      return;
    }

    // Update data
    const updatedData = [...dataset.data];
    updatedData[rowIndex] = {
      ...updatedData[rowIndex],
      [columnName]: editValue
    };

    const updatedDataset = {
      ...dataset,
      data: updatedData
    };

    // Update statistics
    const finalDataset = updateDatasetStats(updatedDataset);
    onUpdate(finalDataset);
    
    setEditingCell(null);
    toast.success('Cell updated successfully');
  };

  const handleCellCancel = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (onDeleteRow) {
      onDeleteRow(rowIndex);
    } else {
      const updatedData = dataset.data.filter((_, index) => index !== rowIndex);
      const updatedDataset = updateDatasetStats({
        ...dataset,
        data: updatedData
      });
      onUpdate(updatedDataset);
      toast.success('Row deleted');
    }
  };

  const renderCell = (rowIndex: number, column: ColumnInfo, value: any) => {
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === column.name;

    if (isEditing) {
      return (
        <div className="flex items-center gap-2">
          {column.type === 'number' ? (
            <Input
              type="number"
              value={editValue ?? ''}
              onChange={(e) => setEditValue(e.target.value === '' ? null : Number(e.target.value))}
              className="h-8 w-24"
              autoFocus
            />
          ) : column.type === 'date' ? (
            <Input
              type="date"
              value={editValue || ''}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8 w-32"
              autoFocus
            />
          ) : column.type === 'boolean' ? (
            <select
              value={String(editValue ?? '')}
              onChange={(e) => setEditValue(e.target.value === 'true')}
              className="h-8 px-2 border rounded"
              autoFocus
            >
              <option value="">--</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          ) : (
            <Input
              type="text"
              value={editValue ?? ''}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8"
              autoFocus
            />
          )}
          <Button size="sm" variant="ghost" onClick={handleCellSave}>
            <Save className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCellCancel}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div
        className="flex items-center justify-between group cursor-pointer hover:bg-gray-50 p-1 rounded"
        onClick={() => handleCellClick(rowIndex, column.name, value)}
      >
        <span className="truncate">{value ?? <span className="text-gray-400">—</span>}</span>
        <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-50" />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{dataset.name}</h3>
          <p className="text-sm text-gray-500">
            {dataset.rowCount} rows × {dataset.columns.length} columns
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInsights(!showInsights)}
          >
            <Lightbulb className="h-4 w-4 mr-2" />
            Insights ({insights.length})
          </Button>
        </div>
      </div>

      {showInsights && insights.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Data Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <div key={index} className="flex items-start gap-2 p-2 bg-white rounded">
                  <Badge variant={insight.severity === 'high' ? 'destructive' : 'secondary'}>
                    {insight.type}
                  </Badge>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{insight.title}</p>
                    <p className="text-xs text-gray-600">{insight.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isDatasetTooLarge(dataset) ? (
            // Use paginated table for large datasets
            <div className="p-4">
              <PaginatedTable
                data={dataset.data}
                columns={['#', ...dataset.columns.map(c => c.name), 'Actions']}
                pageSize={100}
                maxRows={RENDERING_LIMITS.MAX_TABLE_ROWS}
              />
              <p className="text-xs text-orange-600 mt-2">
                ⚠️ Large dataset: Inline editing is disabled. Use Data Cleaning tab for bulk operations.
              </p>
            </div>
          ) : (
            // Use editable table for smaller datasets
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    {dataset.columns.map(column => (
                      <TableHead key={column.name} className="min-w-[150px]">
                        <div className="flex items-center gap-2">
                          {column.name}
                          {column.isCustom && (
                            <Badge variant="outline" className="text-xs">Custom</Badge>
                          )}
                          {column.isRequired && (
                            <span className="text-red-500 text-xs">*</span>
                          )}
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataset.data.slice(0, RENDERING_LIMITS.MAX_TABLE_ROWS).map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      <TableCell className="font-mono text-xs text-gray-500">
                        {rowIndex + 1}
                      </TableCell>
                      {dataset.columns.map(column => (
                        <TableCell key={column.name} className="p-2">
                          {renderCell(rowIndex, column, row[column.name])}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRow(rowIndex)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!isDatasetTooLarge(dataset) && dataset.data.length > RENDERING_LIMITS.MAX_TABLE_ROWS && (
            <div className="p-4 text-center text-sm text-gray-500 border-t">
              Showing first {RENDERING_LIMITS.MAX_TABLE_ROWS} of {dataset.data.length.toLocaleString()} rows
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DataExplorer;


