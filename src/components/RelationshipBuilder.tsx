// Relationship Builder Component for Star and Snowflake Schemas
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Dataset, Relationship } from '@/lib/types';
import { Plus, Star, Snowflake, Link, Trash2, Database, List, Network, Zap, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RelationshipModelView from './RelationshipModelView';

interface RelationshipBuilderProps {
  datasets: Dataset[];
  relationships: Relationship[];
  onAddRelationship: (relationship: Omit<Relationship, 'id'>) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  onApplyRelationships?: () => void;
  schemaType: 'star' | 'snowflake' | 'none';
  onSchemaTypeChange: (type: 'star' | 'snowflake' | 'none') => void;
}

const RelationshipBuilder: React.FC<RelationshipBuilderProps> = ({
  datasets,
  relationships,
  onAddRelationship,
  onDeleteRelationship,
  onApplyRelationships,
  schemaType,
  onSchemaTypeChange
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'model'>('model');
  const [newRelationship, setNewRelationship] = useState<Partial<Omit<Relationship, 'id'>>>({
    fromDataset: '',
    toDataset: '',
    fromColumn: '',
    toColumn: '',
    type: 'one-to-many',
    schemaType: 'star',
    confidence: 1.0
  });

  const handleCreateRelationship = () => {
    if (!newRelationship.fromDataset || !newRelationship.toDataset || 
        !newRelationship.fromColumn || !newRelationship.toColumn) {
      toast.error('Please fill in all relationship fields');
      return;
    }

    // Ensure relationship uses the current schema type to prevent mixing
    const currentSchemaType = schemaType !== 'none' ? schemaType : 'star';

    onAddRelationship({
      fromDataset: newRelationship.fromDataset!,
      toDataset: newRelationship.toDataset!,
      fromColumn: newRelationship.fromColumn!,
      toColumn: newRelationship.toColumn!,
      type: newRelationship.type || 'one-to-many',
      confidence: newRelationship.confidence || 1.0,
      schemaType: currentSchemaType as 'star' | 'snowflake', // Always use current schema type
      isFactTable: newRelationship.isFactTable,
      isDimensionTable: newRelationship.isDimensionTable
    });

    setNewRelationship({
      fromDataset: '',
      toDataset: '',
      fromColumn: '',
      toColumn: '',
      type: 'one-to-many',
      schemaType: 'star',
      confidence: 1.0
    });
    setShowDialog(false);
    toast.success('Relationship created successfully!');
  };

  const fromDataset = datasets.find(d => d.id === newRelationship.fromDataset);
  const toDataset = datasets.find(d => d.id === newRelationship.toDataset);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            Schema Relationships
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={schemaType} onValueChange={(value: 'star' | 'snowflake' | 'none') => onSchemaTypeChange(value)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Schema</SelectItem>
                <SelectItem value="star">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4" />
                    Star Schema
                  </div>
                </SelectItem>
                <SelectItem value="snowflake">
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-4 w-4" />
                    Snowflake Schema
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Relationship
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Relationship</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>From Dataset (Fact Table)</Label>
                      <Select
                        value={newRelationship.fromDataset}
                        onValueChange={(value) => setNewRelationship({ ...newRelationship, fromDataset: value, fromColumn: '', isFactTable: true })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select dataset" />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.map(ds => (
                            <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>From Column</Label>
                      <Select
                        value={newRelationship.fromColumn}
                        onValueChange={(value) => setNewRelationship({ ...newRelationship, fromColumn: value })}
                        disabled={!newRelationship.fromDataset}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {fromDataset?.columns.map(col => (
                            <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>To Dataset (Dimension Table)</Label>
                      <Select
                        value={newRelationship.toDataset}
                        onValueChange={(value) => setNewRelationship({ ...newRelationship, toDataset: value, toColumn: '', isDimensionTable: true })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select dataset" />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.filter(d => d.id !== newRelationship.fromDataset).map(ds => (
                            <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>To Column</Label>
                      <Select
                        value={newRelationship.toColumn}
                        onValueChange={(value) => setNewRelationship({ ...newRelationship, toColumn: value })}
                        disabled={!newRelationship.toDataset}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {toDataset?.columns.map(col => (
                            <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Relationship Type</Label>
                      <Select
                        value={newRelationship.type}
                        onValueChange={(value: 'one-to-one' | 'one-to-many' | 'many-to-many') => 
                          setNewRelationship({ ...newRelationship, type: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="one-to-one">One-to-One</SelectItem>
                          <SelectItem value="one-to-many">One-to-Many</SelectItem>
                          <SelectItem value="many-to-many">Many-to-Many</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Schema Type</Label>
                      <Select
                        value={newRelationship.schemaType || schemaType !== 'none' ? schemaType : 'star'}
                        onValueChange={(value: 'star' | 'snowflake') => 
                          setNewRelationship({ ...newRelationship, schemaType: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="star">
                            <div className="flex items-center gap-2">
                              <Star className="h-4 w-4" />
                              Star Schema
                            </div>
                          </SelectItem>
                          <SelectItem value="snowflake">
                            <div className="flex items-center gap-2">
                              <Snowflake className="h-4 w-4" />
                              Snowflake Schema
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateRelationship}>
                    Create Relationship
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {schemaType === 'none' ? (
          <div className="text-center py-8 text-gray-500">
            <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>Select a schema type to create relationships</p>
          </div>
        ) : relationships.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Link className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No relationships created yet</p>
            <p className="text-sm text-gray-400 mt-2">Click "Create Relationship" to get started</p>
          </div>
        ) : (
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'list' | 'model')} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="model" className="flex items-center gap-2">
                <Network className="h-4 w-4" />
                Model View
              </TabsTrigger>
              <TabsTrigger value="list" className="flex items-center gap-2">
                <List className="h-4 w-4" />
                List View
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="model" className="space-y-4">
              <RelationshipModelView
                datasets={datasets}
                relationships={relationships}
                schemaType={schemaType}
                onAddRelationship={onAddRelationship}
                onDeleteRelationship={onDeleteRelationship}
              />
            </TabsContent>
            
            <TabsContent value="list" className="space-y-3">
              {relationships.length > 0 && schemaType !== 'none' && onApplyRelationships && (
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                  <div className="flex items-center gap-2 text-sm text-blue-800">
                    <Database className="h-4 w-4" />
                    <span>
                      {relationships.length} relationship{relationships.length === 1 ? '' : 's'} created. 
                      Click "Apply Relationships" to update data model and visualizations.
                    </span>
                  </div>
                  <Button
                    onClick={onApplyRelationships}
                    size="sm"
                    className="gap-2"
                  >
                    <Zap className="h-3 w-3" />
                    Apply Now
                  </Button>
                </div>
              )}
              {relationships.map(rel => {
                const fromDs = datasets.find(d => d.id === rel.fromDataset);
                const toDs = datasets.find(d => d.id === rel.toDataset);
                return (
                  <Card key={rel.id} className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={rel.isFactTable ? 'default' : 'secondary'}>
                            {rel.isFactTable ? 'Fact' : 'Dimension'}
                          </Badge>
                          <span className="font-medium text-sm">
                            {fromDs?.name || rel.fromDataset}.{rel.fromColumn}
                          </span>
                          <Link className="h-3 w-3 text-gray-400" />
                          <span className="font-medium text-sm">
                            {toDs?.name || rel.toDataset}.{rel.toColumn}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Badge variant="outline">{rel.type}</Badge>
                          {rel.schemaType && (
                            <Badge variant="outline" className="flex items-center gap-1">
                              {rel.schemaType === 'star' ? <Star className="h-3 w-3" /> : <Snowflake className="h-3 w-3" />}
                              {rel.schemaType}
                            </Badge>
                          )}
                          <span>Confidence: {(rel.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteRelationship(rel.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};

export default RelationshipBuilder;

