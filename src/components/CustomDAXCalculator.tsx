// Custom DAX Calculation Component
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { DAXCalculation } from '@/lib/types';
import type { SemanticModel } from '@/lib/semantic/types';
import { checkDax, formatDaxValue } from '@/lib/dax/run';
import { columnRef, tableRef } from '@/lib/dax/printer';
import { Plus, Calculator, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface CustomDAXCalculatorProps {
  /**
   * The model expressions resolve against, or null before any data is
   * loaded. A DAX expression names its own tables, so there is no longer a
   * "run this against which dataset" question for the caller to answer.
   */
  model: SemanticModel | null;
  customCalculations: DAXCalculation[];
  onAddCalculation: (calculation: Omit<DAXCalculation, 'id'>) => void;
  onDeleteCalculation: (calculationId: string) => void;
  /** Evaluates and stores the result; the parent owns both. */
  onRunCalculation: (calculation: DAXCalculation) => void;
}

/**
 * Worked examples, built from the model's own table and column names.
 *
 * The fixed list this replaces - SUM(ColumnName), COUNTROWS(Table) - was not
 * valid DAX and named nothing that existed, so anyone who clicked one got a
 * formula that could not run. These are real references, taken from the data
 * actually loaded, and they parse.
 */
const examplesFor = (model: SemanticModel | null) => {
  if (!model) return [];

  const table =
    model.tables.find(t => !t.isGenerated && t.columns.some(c => c.role === 'measure')) ??
    model.tables.find(t => !t.isGenerated);
  if (!table) return [];

  const measure = table.columns.find(c => c.role === 'measure');
  const dimension = table.columns.find(c => c.role === 'dimension');

  const examples: { name: string; formula: string; description: string }[] = [
    {
      name: `Rows in ${table.name}`,
      formula: `COUNTROWS(${tableRef(table.name)})`,
      description: 'How many rows the table holds.',
    },
  ];

  if (measure) {
    const reference = columnRef(table.name, measure.name);
    examples.push(
      {
        name: `Total ${measure.name}`,
        formula: `SUM(${reference})`,
        description: `Sum of ${measure.name}.`,
      },
      {
        name: `Average ${measure.name}`,
        formula: `AVERAGE(${reference})`,
        description: `Mean ${measure.name}, ignoring blanks.`,
      }
    );

    if (dimension) {
      const example = table.rows.find(row => row[dimension.name] != null)?.[dimension.name];
      if (example !== undefined) {
        examples.push({
          name: `${measure.name} for one ${dimension.name}`,
          formula: `CALCULATE(SUM(${reference}), ${columnRef(table.name, dimension.name)} = "${String(
            example
          ).replace(/"/g, '""')}")`,
          description: 'An aggregation under a filter.',
        });
      }
    }
  }

  if (model.dateTableName) {
    const dateTable = model.tables.find(t => t.name === model.dateTableName);
    const dateColumn = dateTable?.columns.find(c => c.dataType === 'date');
    if (dateTable && dateColumn && measure) {
      examples.push({
        name: `${measure.name} year to date`,
        formula: `TOTALYTD(SUM(${columnRef(table.name, measure.name)}), ${columnRef(
          dateTable.name,
          dateColumn.name
        )})`,
        description: 'Accumulated from the start of the year.',
      });
    }
  }

  return examples;
};

const CustomDAXCalculator: React.FC<CustomDAXCalculatorProps> = ({
  model,
  customCalculations,
  onAddCalculation,
  onDeleteCalculation,
  onRunCalculation
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

  const daxExamples = useMemo(() => examplesFor(model), [model]);

  /**
   * Check the formula as it is typed.
   *
   * Validation is a name-resolution pass over the parsed tree, not an
   * evaluation, so it costs nothing on a large model and the user finds out
   * about a misspelled column before they save rather than after.
   */
  const issues = useMemo(() => {
    if (!model || !newCalculation.formula?.trim()) return [];
    return checkDax(newCalculation.formula, model);
  }, [model, newCalculation.formula]);

  const blocking = issues.filter(issue => issue.severity === 'error');

  const handleCreateCalculation = () => {
    if (!newCalculation.name || !newCalculation.formula) {
      toast.error('Please provide a name and formula');
      return;
    }

    // Refuse to store an expression that cannot resolve. The point of having
    // a validator is that a broken formula never becomes a saved card that
    // shows a blank where a number should be.
    if (blocking.length > 0) {
      toast.error(blocking[0].message);
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
              <Button size="sm" disabled={!model}>
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
                    placeholder={
                      daxExamples[0]?.formula ?? 'e.g., SUM(Sales[Amount])'
                    }
                    rows={3}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500">
                    Reference a column as Table[Column]. Names with spaces need single
                    quotes: 'Q1 Sales'[Net Amount].
                  </p>
                  {issues.length > 0 && (
                    <div className="space-y-1">
                      {issues.map((issue, index) => (
                        <p
                          key={`${issue.code}-${issue.start}-${index}`}
                          className={`text-xs ${
                            issue.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                          }`}
                        >
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
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
                {daxExamples.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Examples, using your own tables
                    </Label>
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
                          <p className="text-xs text-gray-500 font-mono break-all">{example.formula}</p>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCalculation} disabled={blocking.length > 0}>
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
            <p className="text-sm text-gray-400 mt-2">
              {model
                ? 'Create custom DAX expressions to analyze your data'
                : 'Upload a dataset to start writing DAX'}
            </p>
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
                        {calc.error ? (
                          <Badge variant="outline" className="text-red-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        ) : calc.evaluated ? (
                          <Badge variant="outline" className="text-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Executed
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{calc.description}</p>
                      <code className="text-xs bg-gray-100 p-2 rounded block font-mono">
                        {calc.formula}
                      </code>
                      {calc.error ? (
                        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
                          <p className="text-xs font-medium text-red-700">
                            This could not be calculated
                          </p>
                          <p className="mt-1 text-xs text-red-600">{calc.error}</p>
                          {calc.errorDetail && (
                            <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[11px] text-red-500">
                              {calc.errorDetail}
                            </pre>
                          )}
                        </div>
                      ) : calc.evaluated ? (
                        <div className="mt-2 p-2 bg-blue-50 rounded">
                          <p className="text-xs text-gray-600 mb-1">Result:</p>
                          <p className="text-lg font-bold text-blue-600">
                            {formatDaxValue(calc.result ?? null)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!model}
                        onClick={() => onRunCalculation(calc)}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Run
                      </Button>
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
