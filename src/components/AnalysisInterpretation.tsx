// Analysis Interpretation Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText, Save, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

interface AnalysisInterpretationProps {
  interpretation: string;
  onSave: (interpretation: string) => void;
}

const AnalysisInterpretation: React.FC<AnalysisInterpretationProps> = ({
  interpretation,
  onSave
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [currentInterpretation, setCurrentInterpretation] = useState(interpretation);

  const handleSave = () => {
    onSave(currentInterpretation);
    setIsEditing(false);
    toast.success('Interpretation saved successfully!');
  };

  const handleCancel = () => {
    setCurrentInterpretation(interpretation);
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Analysis Interpretation
          </CardTitle>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-4 w-4 mr-2" />
              {interpretation ? 'Edit' : 'Add'} Interpretation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Write your analysis interpretation</Label>
              <Textarea
                value={currentInterpretation}
                onChange={(e) => setCurrentInterpretation(e.target.value)}
                placeholder="Enter your analysis, insights, findings, and recommendations here..."
                rows={8}
                className="resize-none"
              />
              <p className="text-xs text-gray-500">
                Describe key findings, trends, patterns, and actionable insights from your data analysis.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} className="flex-1">
                <Save className="h-4 w-4 mr-2" />
                Save Interpretation
              </Button>
              <Button variant="outline" onClick={handleCancel} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {interpretation ? (
              <div className="prose prose-sm max-w-none">
                <p className="text-gray-700 whitespace-pre-wrap">{interpretation}</p>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No interpretation added yet</p>
                <p className="text-sm text-gray-400 mt-2">
                  Click "Add Interpretation" to write your analysis insights
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AnalysisInterpretation;


