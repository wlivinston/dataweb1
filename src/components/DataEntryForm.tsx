// Component for manually entering observations/rows
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ColumnInfo, Dataset } from '@/lib/types';
import { validateValue, createEmptyObservation } from '@/lib/dataUtils';
import { Plus, Save, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface DataEntryFormProps {
  dataset: Dataset;
  onSave: (observation: any) => void;
  onCancel?: () => void;
  initialData?: any;
}

const DataEntryForm: React.FC<DataEntryFormProps> = ({ 
  dataset, 
  onSave, 
  onCancel,
  initialData 
}) => {
  const [formData, setFormData] = useState<any>(
    initialData || createEmptyObservation(dataset.columns)
  );
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const handleFieldChange = (columnName: string, value: any) => {
    const column = dataset.columns.find(col => col.name === columnName);
    if (!column) return;

    // Type conversion
    let convertedValue = value;
    if (column.type === 'number') {
      convertedValue = value === '' ? null : Number(value);
    } else if (column.type === 'boolean') {
      convertedValue = typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
    } else if (column.type === 'date') {
      convertedValue = value;
    }

    setFormData((prev: any) => ({
      ...prev,
      [columnName]: convertedValue
    }));

    // Clear error for this field
    if (errors[columnName]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[columnName];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};
    
    dataset.columns.forEach(column => {
      const value = formData[column.name];
      const validation = validateValue(value, column);
      
      if (!validation.valid) {
        newErrors[column.name] = validation.error || 'Invalid value';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors before saving');
      return;
    }

    onSave(formData);
  };

  const renderField = (column: ColumnInfo) => {
    const value = formData[column.name];
    const error = errors[column.name];
    const hasError = !!error;

    switch (column.type) {
      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={column.name}
              checked={value || false}
              onCheckedChange={(checked) => handleFieldChange(column.name, checked)}
            />
            <Label htmlFor={column.name} className="cursor-pointer">
              {column.name}
              {column.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2">
            <Label htmlFor={column.name}>
              {column.name}
              {column.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={column.name}
              type="number"
              value={value ?? ''}
              onChange={(e) => handleFieldChange(column.name, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={column.defaultValue?.toString() || '0'}
              min={column.validation?.min}
              max={column.validation?.max}
            />
            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>
        );

      case 'date':
        return (
          <div className="space-y-2">
            <Label htmlFor={column.name}>
              {column.name}
              {column.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={column.name}
              type="date"
              value={value || ''}
              onChange={(e) => handleFieldChange(column.name, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
            />
            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>
        );

      default: // string
        return (
          <div className="space-y-2">
            <Label htmlFor={column.name}>
              {column.name}
              {column.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={column.name}
              type="text"
              value={value || ''}
              onChange={(e) => handleFieldChange(column.name, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={column.defaultValue?.toString() || `Enter ${column.name}`}
            />
            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {dataset.columns.map(column => (
          <div key={column.name}>
            {renderField(column)}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        )}
        <Button type="submit">
          <Save className="h-4 w-4 mr-2" />
          Save Observation
        </Button>
      </div>
    </form>
  );
};

export default DataEntryForm;


