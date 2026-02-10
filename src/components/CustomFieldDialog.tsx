// Component for creating custom fields/columns
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ColumnInfo, DataType } from '@/lib/types';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface CustomFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (column: ColumnInfo) => void;
  existingColumns?: string[];
}

const CustomFieldDialog: React.FC<CustomFieldDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  existingColumns = []
}) => {
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<DataType>('string');
  const [isRequired, setIsRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState('');

  const validateFieldName = (name: string): boolean => {
    if (!name || name.trim() === '') {
      setError('Field name is required');
      return false;
    }

    // Check for valid identifier
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      setError('Field name must start with a letter or underscore and contain only letters, numbers, and underscores');
      return false;
    }

    // Check for duplicates
    if (existingColumns.includes(name)) {
      setError('A field with this name already exists');
      return false;
    }

    setError('');
    return true;
  };

  const handleSave = () => {
    if (!validateFieldName(fieldName)) {
      return;
    }

    const column: ColumnInfo = {
      name: fieldName,
      type: fieldType,
      sampleValues: [],
      nullCount: 0,
      uniqueCount: 0,
      isCustom: true,
      isRequired,
      defaultValue: fieldType === 'number' ? (defaultValue ? Number(defaultValue) : undefined) 
                   : fieldType === 'boolean' ? (defaultValue === 'true')
                   : defaultValue || undefined,
      validation: {
        ...(minValue && { min: Number(minValue) }),
        ...(maxValue && { max: Number(maxValue) }),
        ...(pattern && { pattern })
      }
    };

    onSave(column);
    
    // Reset form
    setFieldName('');
    setFieldType('string');
    setIsRequired(false);
    setDefaultValue('');
    setMinValue('');
    setMaxValue('');
    setPattern('');
    setError('');
    onOpenChange(false);
    
    toast.success(`Custom field "${fieldName}" created successfully`);
  };

  const handleFieldNameChange = (value: string) => {
    setFieldName(value);
    if (error) {
      validateFieldName(value);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Custom Field</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="fieldName">
              Field Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="fieldName"
              value={fieldName}
              onChange={(e) => handleFieldNameChange(e.target.value)}
              placeholder="e.g., customer_id, revenue, status"
              className={error ? 'border-red-500' : ''}
            />
            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Use letters, numbers, and underscores. Must start with a letter or underscore.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fieldType">
              Data Type <span className="text-red-500">*</span>
            </Label>
            <Select value={fieldType} onValueChange={(value: DataType) => {
              setFieldType(value);
              setDefaultValue(''); // Reset default value when type changes
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">String (Text)</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="boolean">Boolean (True/False)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isRequired"
              checked={isRequired}
              onCheckedChange={(checked) => setIsRequired(checked as boolean)}
            />
            <Label htmlFor="isRequired" className="cursor-pointer">
              Required field
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultValue">Default Value</Label>
            {fieldType === 'boolean' ? (
              <Select value={defaultValue} onValueChange={setDefaultValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select default value" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No default</SelectItem>
                  <SelectItem value="true">True</SelectItem>
                  <SelectItem value="false">False</SelectItem>
                </SelectContent>
              </Select>
            ) : fieldType === 'date' ? (
              <Input
                id="defaultValue"
                type="date"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="Select default date"
              />
            ) : fieldType === 'number' ? (
              <Input
                id="defaultValue"
                type="number"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="Enter default number"
              />
            ) : (
              <Input
                id="defaultValue"
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="Enter default text"
              />
            )}
          </div>

          {fieldType === 'number' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minValue">Minimum Value</Label>
                <Input
                  id="minValue"
                  type="number"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxValue">Maximum Value</Label>
                <Input
                  id="maxValue"
                  type="number"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          {fieldType === 'string' && (
            <div className="space-y-2">
              <Label htmlFor="pattern">Validation Pattern (Regex)</Label>
              <Input
                id="pattern"
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., ^[A-Z0-9]+$ for uppercase alphanumeric"
              />
              <p className="text-xs text-gray-500">
                Optional: Enter a regular expression pattern to validate input
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!fieldName || !!error}>
            Create Field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CustomFieldDialog;


