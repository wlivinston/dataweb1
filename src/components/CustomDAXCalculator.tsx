// Custom DAX Calculation Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Dataset, DAXCalculation } from '@/lib/types';
import { Plus, Calculator, Zap, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface CustomDAXCalculatorProps {
  datasets: Dataset[];
  customCalculations: DAXCalculation[];
  onAddCalculation: (calculation: Omit<DAXCalculation, 'id'>) => void;
  onDeleteCalculation: (calculationId: string) => void;
  onExecuteCalculation: (calculation: DAXCalculation, dataset: Dataset) => any;
}

const CustomDAXCalculator: React.FC<CustomDAXCalculatorProps> = ({
  datasets,
  customCalculations,
  onAddCalculation,
  onDeleteCalculation,
  onExecuteCalculation
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const [newCalculation, setNewCalculation] = useState<Partial<Omit<DAXCalculation, 'id'>>>({
    name: '',
    formula: '',
    description: '',
    category: 'aggregation',
    applicable: true,
    confidence: 1.0
  });

  const handleCreateCalculation = () => {
    if (!newCalculation.name || !newCalculation.formula) {
      toast.error('Please provide a name and formula');
      return;
    }

    onAddCalculation({
      name: newCalculation.name!,
      formula: newCalculation.formula!,
      description: newCalculation.description || '',
      category: newCalculation.category || 'aggregation',
      applicable: newCalculation.applicable ?? true,
      confidence: newCalculation.confidence || 1.0
    });

    setNewCalculation({
      name: '',
      formula: '',
      description: '',
      category: 'aggregation',
      applicable: true,
      confidence: 1.0
    });
    setShowDialog(false);
    toast.success('Custom calculation created!');
  };

  const executeCalculation = (calc: DAXCalculation, datasetId: string) => {
    const dataset = datasets.find(d => d.id === datasetId);
    if (!dataset) {
      toast.error('Dataset not found');
      return;
    }

    try {
      const result = onExecuteCalculation(calc, dataset);
      toast.success(`Calculation executed: ${result}`);
    } catch (error) {
      toast.error(`Error executing calculation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const daxExamples = [
    { name: 'Total Sum', formula: 'SUM(ColumnName)', description: 'Sum of all values in a column' },
    { name: 'Average', formula: 'AVERAGE(ColumnName)', description: 'Average value of a column' },
    { name: 'Count Rows', formula: 'COUNTROWS(Table)', description: 'Total number of rows' },
    { name: 'Max Value', formula: 'MAX(ColumnName)', description: 'Maximum value in a column' },
    { name: 'Min Value', formula: 'MIN(ColumnName)', description: 'Minimum value in a column' },
    { name: 'Year Extract', formula: 'YEAR(DateColumn)', description: 'Extract year from date' }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Custom DAX Calculations
          </CardTitle>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Custom Calculation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Custom DAX Calculation</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Calculation Name *</Label>
                  <Input
                    value={newCalculation.name}
                    onChange={(e) => setNewCalculation({ ...newCalculation, name: e.target.value })}
                    placeholder="e.g., Total Revenue, Average Sales"
                  />
                </div>
                <div className="space-y-2">
                  <Label>DAX Formula *</Label>
                  <Textarea
                    value={newCalculation.formula}
                    onChange={(e) => setNewCalculation({ ...newCalculation, formula: e.target.value })}
                    placeholder="e.g., SUM(Sales[Amount])"
                    rows={3}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500">
                    Enter a valid DAX expression. Use column names from your datasets.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={newCalculation.description}
                    onChange={(e) => setNewCalculation({ ...newCalculation, description: e.target.value })}
                    placeholder="Describe what this calculation does..."
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newCalculation.category}
                      onValueChange={(value: DAXCalculation['category']) => 
                        setNewCalculation({ ...newCalculation, category: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aggregation">Aggregation</SelectItem>
                        <SelectItem value="time">Time</SelectItem>
                        <SelectItem value="statistical">Statistical</SelectItem>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="logical">Logical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Confidence</Label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={newCalculation.confidence || 1.0}
                      onChange={(e) => setNewCalculation({ ...newCalculation, confidence: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">DAX Examples</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {daxExamples.map((example, index) => (
                      <Card key={index} className="p-2 cursor-pointer hover:bg-gray-50" onClick={() => {
                        setNewCalculation({
                          ...newCalculation,
                          name: example.name,
                          formula: example.formula,
                          description: example.description
                        });
                      }}>
                        <p className="text-xs font-medium">{example.name}</p>
                        <p className="text-xs text-gray-500 font-mono">{example.formula}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCalculation}>
                  Create Calculation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {customCalculations.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No custom calculations yet</p>
            <p className="text-sm text-gray-400 mt-2">Create custom DAX expressions to analyze your data</p>
          </div>
        ) : (
          <div className="space-y-3">
            {customCalculations.map(calc => (
              <Card key={calc.id} className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{calc.name}</h4>
                        <Badge variant="secondary">{calc.category}</Badge>
                        {calc.result !== undefined && calc.result !== null && (
                          <Badge variant="outline" className="text-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Executed
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{calc.description}</p>
                      <code className="text-xs bg-gray-100 p-2 rounded block font-mono">
                        {calc.formula}
                      </code>
                      {calc.result !== undefined && calc.result !== null && (
                        <div className="mt-2 p-2 bg-blue-50 rounded">
                          <p className="text-xs text-gray-600 mb-1">Result:</p>
                          <p className="text-lg font-bold text-blue-600">
                            {typeof calc.result === 'object' ? JSON.stringify(calc.result) : calc.result}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {datasets.length > 0 && (
                        <Select onValueChange={(datasetId) => executeCalculation(calc, datasetId)}>
                          <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="Execute on..." />
                          </SelectTrigger>
                          <SelectContent>
                            {datasets.map(ds => (
                              <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteCalculation(calc.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full" 
                        style={{ width: `${(calc.confidence || 0) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{Math.round((calc.confidence || 0) * 100)}% confidence</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomDAXCalculator;


