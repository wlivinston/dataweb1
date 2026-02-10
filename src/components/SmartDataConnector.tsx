// Smart Data Connector - Auto-detects relationships and creates composite views
// Enables analysts to find connections between multiple data streams

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Link2, Zap, Database, Check, X, AlertTriangle, ChevronRight,
  Layers, GitMerge, Eye, Sparkles, ArrowRight, RefreshCw, CheckCircle
} from 'lucide-react';
import { Dataset, Relationship } from '@/lib/types';
import {
  autoDetectRelationships,
  AutoDetectedRelationship,
  validateRelationship,
  mergeDatasets,
  createCompositeView,
  findCommonDimensions,
  generateJoinSuggestions,
  detectSchema
} from '@/lib/smartDataConnector';
import { SchemaDetectionResult } from '@/lib/types';
import { toast } from 'sonner';

interface SmartDataConnectorProps {
  datasets: Dataset[];
  onRelationshipCreated?: (relationship: Relationship) => void;
  onCompositeViewCreated?: (data: any[], columns: any[]) => void;
}

const SmartDataConnector: React.FC<SmartDataConnectorProps> = ({
  datasets,
  onRelationshipCreated,
  onCompositeViewCreated
}) => {
  const [detectedRelationships, setDetectedRelationships] = useState<AutoDetectedRelationship[]>([]);
  const [selectedRelationship, setSelectedRelationship] = useState<AutoDetectedRelationship | null>(null);
  const [validationResult, setValidationResult] = useState<ReturnType<typeof validateRelationship> | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [commonDimensions, setCommonDimensions] = useState<any[]>([]);
  const [joinType, setJoinType] = useState<'inner' | 'left' | 'right' | 'full'>('left');
  const [schemaResult, setSchemaResult] = useState<SchemaDetectionResult | null>(null);

  const runAutoDetection = async () => {
    if (datasets.length < 2) {
      toast.error('Upload at least 2 datasets to detect relationships');
      return;
    }

    setIsAnalyzing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500)); // UX delay

      // Use schema detection which includes relationship detection
      const schema = detectSchema(datasets);
      setSchemaResult(schema);
      setDetectedRelationships(schema.relationships as AutoDetectedRelationship[]);

      const dimensions = findCommonDimensions(datasets);
      setCommonDimensions(dimensions);

      if (schema.relationships.length > 0) {
        const schemaLabel = schema.schemaType !== 'none' && schema.schemaType !== 'flat'
          ? ` (${schema.schemaType} schema detected)`
          : '';
        toast.success(`Found ${schema.relationships.length} potential relationships!${schemaLabel}`);
      } else {
        toast.info('No automatic relationships detected. Consider manual mapping.');
      }
    } catch (error) {
      console.error('Detection error:', error);
      toast.error('Failed to analyze relationships');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRelationshipSelect = (rel: AutoDetectedRelationship) => {
    setSelectedRelationship(rel);
    
    // Validate the relationship
    const ds1 = datasets.find(d => d.id === rel.fromDataset);
    const ds2 = datasets.find(d => d.id === rel.toDataset);
    
    if (ds1 && ds2) {
      const validation = validateRelationship(ds1, ds2, rel.fromColumn, rel.toColumn);
      setValidationResult(validation);
    }
  };

  const handleCreateRelationship = () => {
    if (!selectedRelationship) return;

    const detectedSchemaType = schemaResult?.schemaType;
    const resolvedSchemaType = detectedSchemaType && detectedSchemaType !== 'none' && detectedSchemaType !== 'flat'
      ? detectedSchemaType as 'star' | 'snowflake'
      : 'star';

    const relationship: Relationship = {
      id: `rel-${Date.now()}`,
      fromDataset: selectedRelationship.fromDataset,
      toDataset: selectedRelationship.toDataset,
      fromColumn: selectedRelationship.fromColumn,
      toColumn: selectedRelationship.toColumn,
      type: selectedRelationship.type,
      confidence: selectedRelationship.confidence,
      schemaType: resolvedSchemaType,
      isFactTable: schemaResult?.factTables.some(f => f.datasetId === selectedRelationship.fromDataset),
      isDimensionTable: schemaResult?.dimensionTables.some(d => d.datasetId === selectedRelationship.toDataset)
    };

    onRelationshipCreated?.(relationship);
    toast.success('Relationship created successfully!');
  };

  const handleCreateCompositeView = () => {
    if (!selectedRelationship) return;
    
    const ds1 = datasets.find(d => d.id === selectedRelationship.fromDataset);
    const ds2 = datasets.find(d => d.id === selectedRelationship.toDataset);
    
    if (ds1 && ds2) {
      try {
        const { data, columns } = mergeDatasets(
          ds1, 
          ds2, 
          selectedRelationship.fromColumn, 
          selectedRelationship.toColumn,
          joinType
        );
        
        onCompositeViewCreated?.(data, columns);
        toast.success(`Composite view created with ${data.length} rows!`);
      } catch (error) {
        console.error('Merge error:', error);
        toast.error('Failed to create composite view');
      }
    }
  };

  const getMatchScoreColor = (score: number) => {
    if (score >= 0.7) return 'bg-green-500';
    if (score >= 0.4) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getDatasetName = (id: string) => {
    const ds = datasets.find(d => d.id === id);
    return ds?.name.split('.')[0] || id;
  };

  if (datasets.length < 2) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Layers className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">Smart Data Connector</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Upload at least 2 datasets to automatically detect relationships 
            and create composite views for comprehensive analysis.
          </p>
          <div className="flex justify-center gap-4 mt-6 text-sm text-gray-400">
            <span className="flex items-center gap-1"><Database className="h-4 w-4" /> {datasets.length}/2 datasets</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <GitMerge className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Smart Data Connector
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Auto-Detection
                </Badge>
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Automatically find relationships between your datasets
              </p>
            </div>
          </div>
          <Button
            onClick={runAutoDetection}
            disabled={isAnalyzing}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Detect Relationships
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Dataset Overview */}
        <div className="grid grid-cols-2 gap-3">
          {datasets.slice(0, 4).map(ds => (
            <Card key={ds.id} className="p-3 bg-gray-50">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-sm truncate">{ds.name}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {ds.rowCount.toLocaleString()} rows • {ds.columns.length} columns
              </div>
            </Card>
          ))}
        </div>

        {/* Schema Detection Summary */}
        {schemaResult && schemaResult.schemaType !== 'none' && schemaResult.schemaType !== 'flat' && (
          <Card className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="font-semibold text-sm text-blue-900">
                {schemaResult.schemaType === 'star' ? 'Star' : 'Snowflake'} Schema Detected
              </span>
              <Badge variant="outline" className="text-xs ml-auto">
                {(schemaResult.confidence * 100).toFixed(0)}% confidence
              </Badge>
            </div>
            <p className="text-xs text-blue-700 mb-2">{schemaResult.explanation}</p>
            <div className="flex gap-4 text-xs">
              {schemaResult.factTables.length > 0 && (
                <div>
                  <span className="font-medium text-blue-800">Fact Tables:</span>{' '}
                  <span className="text-blue-600">{schemaResult.factTables.map(f => f.datasetName).join(', ')}</span>
                </div>
              )}
              {schemaResult.dimensionTables.length > 0 && (
                <div>
                  <span className="font-medium text-green-800">Dimensions:</span>{' '}
                  <span className="text-green-600">{schemaResult.dimensionTables.map(d => d.datasetName).join(', ')}</span>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Detected Relationships */}
        {detectedRelationships.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-500" />
                Detected Relationships ({detectedRelationships.length})
              </h4>
            </div>
            
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {detectedRelationships.map((rel, index) => (
                  <Card 
                    key={index}
                    className={`p-3 cursor-pointer transition-all ${
                      selectedRelationship === rel 
                        ? 'border-emerald-500 bg-emerald-50' 
                        : 'hover:border-gray-300'
                    }`}
                    onClick={() => handleRelationshipSelect(rel)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="text-sm">
                          <span className="font-medium">{getDatasetName(rel.fromDataset)}</span>
                          <span className="text-gray-400">.{rel.fromColumn}</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-gray-400" />
                        <div className="text-sm">
                          <span className="font-medium">{getDatasetName(rel.toDataset)}</span>
                          <span className="text-gray-400">.{rel.toColumn}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{rel.type}</Badge>
                        <div className={`w-2 h-2 rounded-full ${getMatchScoreColor(rel.matchScore)}`} />
                        <span className="text-xs text-gray-500">
                          {(rel.matchScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{rel.matchingValues} matching values</span>
                      {rel.autoJoinRecommended && (
                        <Badge className="bg-green-100 text-green-700 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Recommended
                        </Badge>
                      )}
                    </div>
                    
                    <Progress 
                      value={rel.matchScore * 100} 
                      className="h-1 mt-2"
                    />
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Validation Results */}
        {selectedRelationship && validationResult && (
          <Card className={`p-4 ${validationResult.isValid ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <div className="flex items-center gap-2 mb-3">
              {validationResult.isValid ? (
                <Check className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
              <span className="font-medium">
                Relationship Validation
              </span>
              <Badge variant={validationResult.isValid ? 'default' : 'secondary'}>
                {(validationResult.matchRate * 100).toFixed(0)}% match rate
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Orphan records:</span>
                <div className="font-mono text-xs mt-1">
                  {getDatasetName(selectedRelationship.fromDataset)}: {validationResult.orphanCount.ds1}
                  <br />
                  {getDatasetName(selectedRelationship.toDataset)}: {validationResult.orphanCount.ds2}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Duplicate keys:</span>
                <div className="font-mono text-xs mt-1">
                  {getDatasetName(selectedRelationship.fromDataset)}: {validationResult.duplicateKeyCount.ds1}
                  <br />
                  {getDatasetName(selectedRelationship.toDataset)}: {validationResult.duplicateKeyCount.ds2}
                </div>
              </div>
            </div>

            {validationResult.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {validationResult.warnings.map((warning, i) => (
                  <p key={i} className="text-xs text-yellow-700 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    {warning}
                  </p>
                ))}
              </div>
            )}

            {validationResult.recommendations.length > 0 && (
              <div className="mt-3 space-y-1">
                {validationResult.recommendations.map((rec, i) => (
                  <p key={i} className="text-xs text-gray-600 flex items-start gap-1">
                    <ChevronRight className="h-3 w-3 flex-shrink-0 mt-0.5 text-emerald-500" />
                    {rec}
                  </p>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Common Dimensions */}
        {commonDimensions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-500" />
              Common Dimensions
            </h4>
            <div className="flex flex-wrap gap-2">
              {commonDimensions.slice(0, 5).map((dim, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {dim.dimension} ({dim.datasets.length} datasets)
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {selectedRelationship && (
          <div className="flex items-center gap-3 pt-4 border-t">
            <Select value={joinType} onValueChange={(v: any) => setJoinType(v)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left Join</SelectItem>
                <SelectItem value="inner">Inner Join</SelectItem>
                <SelectItem value="right">Right Join</SelectItem>
                <SelectItem value="full">Full Join</SelectItem>
              </SelectContent>
            </Select>
            
            <Button
              onClick={handleCreateRelationship}
              variant="outline"
            >
              <Link2 className="h-4 w-4 mr-2" />
              Save Relationship
            </Button>
            
            <Button
              onClick={handleCreateCompositeView}
              className="bg-gradient-to-r from-emerald-600 to-teal-600"
            >
              <GitMerge className="h-4 w-4 mr-2" />
              Create Composite View
            </Button>
          </div>
        )}

        {/* Empty State */}
        {detectedRelationships.length === 0 && !isAnalyzing && (
          <div className="text-center py-8 text-gray-500">
            <Link2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>Click "Detect Relationships" to analyze your datasets</p>
            <p className="text-sm text-gray-400 mt-1">
              We'll automatically find potential join columns
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SmartDataConnector;
