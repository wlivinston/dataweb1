// Relationship Model View - Interactive visual representation with drag, drop, and zoom
import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dataset, Relationship } from '@/lib/types';
import { Database, Star, Snowflake, ZoomIn, ZoomOut, RotateCcw, Maximize2, Hand } from 'lucide-react';

interface RelationshipModelViewProps {
  datasets: Dataset[];
  relationships: Relationship[];
  schemaType: 'star' | 'snowflake' | 'none';
  onAddRelationship?: (relationship: Omit<Relationship, 'id'>) => void;
  onDeleteRelationship?: (relationshipId: string) => void;
}

interface Node {
  id: string;
  dataset: Dataset;
  x: number;
  y: number;
  isFact: boolean;
  isDimension: boolean;
}

interface Connection {
  id: string;
  relationship: Relationship;
  fromNode: Node;
  toNode: Node;
}

const RelationshipModelView: React.FC<RelationshipModelViewProps> = ({
  datasets,
  relationships,
  schemaType,
  onAddRelationship,
  onDeleteRelationship
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<{ nodeId: string; columnName: string } | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isPanning, setIsPanning] = useState(false);
  const [panStartPos, setPanStartPos] = useState({ x: 0, y: 0 });
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef({ x: 0, y: 0, nodeId: '', offsetX: 0, offsetY: 0 });

  const minZoom = 0.3;
  const maxZoom = 3;
  const zoomStep = 0.2;

  // Calculate initial node positions based on schema type
  const calculateInitialPositions = useCallback(() => {
    if (datasets.length === 0) return new Map<string, { x: number; y: number }>();

    const positions = new Map<string, { x: number; y: number }>();
    const factTableIds = new Set<string>();
    const dimensionTableIds = new Set<string>();

    // Filter relationships by schema type to prevent mixing
    const filteredRelationships = relationships.filter(rel => {
      if (schemaType === 'none') return true;
      return rel.schemaType === schemaType;
    });

    filteredRelationships.forEach(rel => {
      if (rel.isFactTable) factTableIds.add(rel.fromDataset);
      if (rel.isDimensionTable) dimensionTableIds.add(rel.toDataset);
    });

    if (factTableIds.size === 0 && relationships.length > 0 && schemaType !== 'none') {
      factTableIds.add(relationships[0].fromDataset);
    }

    const factTable = datasets.find(d => factTableIds.has(d.id));
    const dimensions = datasets.filter(d => !factTableIds.has(d.id));

    if (schemaType === 'star' && factTable) {
      const centerX = 400;
      const centerY = 300;
      positions.set(factTable.id, { x: centerX, y: centerY });

      const radius = 250;
      const angleStep = (2 * Math.PI) / Math.max(dimensions.length, 1);
      dimensions.forEach((dim, index) => {
        const angle = index * angleStep;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        positions.set(dim.id, { x, y });
      });
    } else if (schemaType === 'snowflake' && factTable) {
      const centerX = 400;
      const centerY = 300;
      positions.set(factTable.id, { x: centerX, y: centerY });

      const firstLayerCount = Math.ceil(dimensions.length / 2);
      const firstLayerRadius = 200;
      const secondLayerRadius = 350;
      const angleStep = (2 * Math.PI) / Math.max(firstLayerCount, 1);

      dimensions.forEach((dim, index) => {
        const isFirstLayer = index < firstLayerCount;
        const radius = isFirstLayer ? firstLayerRadius : secondLayerRadius;
        const angle = (index % firstLayerCount) * angleStep;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        positions.set(dim.id, { x, y });
      });
    } else {
      // Grid layout
      const cols = Math.ceil(Math.sqrt(datasets.length));
      datasets.forEach((ds, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = 150 + col * 250;
        const y = 100 + row * 200;
        positions.set(ds.id, { x, y });
      });
    }

    return positions;
  }, [datasets, relationships, schemaType]);

  // Initialize positions on mount or when datasets/relationships change
  useEffect(() => {
    if (nodePositions.size === 0 || datasets.some(ds => !nodePositions.has(ds.id))) {
      const initialPositions = calculateInitialPositions();
      setNodePositions(initialPositions);
    }
  }, [datasets, relationships, schemaType, calculateInitialPositions, nodePositions.size]);

  // Build nodes and connections from current positions
  // Only show relationships matching the current schema type
  const { nodes, connections } = useMemo(() => {
    if (datasets.length === 0 || nodePositions.size === 0) {
      return { nodes: [], connections: [] };
    }

    // Filter relationships by schema type to prevent mixing star and snowflake
    const filteredRelationships = relationships.filter(rel => {
      if (schemaType === 'none') return true; // Show all if no schema selected
      return rel.schemaType === schemaType;
    });

    const factTableIds = new Set<string>();
    const dimensionTableIds = new Set<string>();

    // Only process relationships that match the current schema type
    filteredRelationships.forEach(rel => {
      if (rel.isFactTable) factTableIds.add(rel.fromDataset);
      if (rel.isDimensionTable) dimensionTableIds.add(rel.toDataset);
    });

    const nodeList: Node[] = datasets.map(ds => {
      const pos = nodePositions.get(ds.id) || { x: 200, y: 200 };
      return {
        id: ds.id,
        dataset: ds,
        x: pos.x,
        y: pos.y,
        isFact: factTableIds.has(ds.id),
        isDimension: dimensionTableIds.has(ds.id)
      };
    });

    // Only create connections for relationships matching the current schema
    const connectionList: Connection[] = filteredRelationships
      .map(rel => {
        const fromNode = nodeList.find(n => n.id === rel.fromDataset);
        const toNode = nodeList.find(n => n.id === rel.toDataset);
        if (fromNode && toNode) {
          return {
            id: rel.id,
            relationship: rel,
            fromNode,
            toNode
          };
        }
        return null;
      })
      .filter((conn): conn is Connection => conn !== null);

    return { nodes: nodeList, connections: connectionList };
  }, [datasets, relationships, nodePositions, schemaType]);

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + zoomStep, maxZoom));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - zoomStep, minZoom));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const initialPositions = calculateInitialPositions();
    setNodePositions(initialPositions);
  };

  const handleFitToView = () => {
    if (nodes.length === 0) return;
    
    const bounds = nodes.reduce((acc, node) => ({
      minX: Math.min(acc.minX, node.x),
      maxX: Math.max(acc.maxX, node.x),
      minY: Math.min(acc.minY, node.y),
      maxY: Math.max(acc.maxY, node.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const width = bounds.maxX - bounds.minX + 200;
    const height = bounds.maxY - bounds.minY + 200;
    const container = containerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight - 100; // Account for margins

    const scaleX = containerWidth / width;
    const scaleY = containerHeight / height;
    const newZoom = Math.min(scaleX, scaleY, maxZoom) * 0.9; // 90% to add padding

    setZoom(newZoom);
    setPan({
      x: (containerWidth / newZoom - (bounds.minX + bounds.maxX)) / 2,
      y: (containerHeight / newZoom - (bounds.minY + bounds.maxY)) / 2
    });
  };

  // Toggle node expansion to show/hide columns
  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const updated = new Set(prev);
      if (updated.has(nodeId)) {
        updated.delete(nodeId);
      } else {
        updated.add(nodeId);
      }
      return updated;
    });
  };

  // Drag handlers for nodes
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggedNodeId(nodeId);
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      nodeId,
      offsetX: (e.clientX - rect.left) / zoom - node.x + pan.x,
      offsetY: (e.clientY - rect.top) / zoom - node.y + pan.y
    };
  };

  // Drag handlers for columns
  const handleColumnMouseDown = (e: React.MouseEvent, nodeId: string, columnName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggedColumn({ nodeId, columnName });
  };

  // Handle column drop on fact table
  const handleColumnDrop = (e: React.MouseEvent, targetNodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedColumn || !onAddRelationship) return;
    
    const sourceNode = nodes.find(n => n.id === draggedColumn.nodeId);
    const targetNode = nodes.find(n => n.id === targetNodeId);
    
    if (!sourceNode || !targetNode) return;
    
    // Only allow dropping on fact tables
    if (!targetNode.isFact) {
      setDragOverNodeId(null);
      setDraggedColumn(null);
      return;
    }

    // Ensure we use the current schema type and don't mix schemas
    const currentSchemaType = schemaType !== 'none' ? schemaType : 'star';

    // Find a matching column in the target (fact) table
    // Try exact match first, then partial match, then ID/key columns
    const exactMatch = targetNode.dataset.columns.find(
      col => col.name.toLowerCase() === draggedColumn.columnName.toLowerCase()
    );
    
    const partialMatch = targetNode.dataset.columns.find(
      col => col.name.toLowerCase().includes(draggedColumn.columnName.toLowerCase()) ||
             draggedColumn.columnName.toLowerCase().includes(col.name.toLowerCase())
    );
    
    // Try to find ID or key column as fallback
    const idMatch = targetNode.dataset.columns.find(
      col => col.name.toLowerCase().endsWith('id') || 
             col.name.toLowerCase().endsWith('key') ||
             col.name.toLowerCase() === 'id'
    );
    
    const targetColumn = exactMatch || partialMatch || idMatch || targetNode.dataset.columns[0];

    if (targetColumn) {
      // Create relationship with the current schema type
      onAddRelationship({
        fromDataset: targetNodeId, // Fact table
        toDataset: draggedColumn.nodeId, // Dimension table
        fromColumn: targetColumn.name,
        toColumn: draggedColumn.columnName,
        type: 'one-to-many',
        confidence: 1.0,
        schemaType: currentSchemaType, // Use current schema type
        isFactTable: true,
        isDimensionTable: true
      });
    }

    setDragOverNodeId(null);
    setDraggedColumn(null);
  };

  const handleColumnDragOver = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn.nodeId !== nodeId) {
      const targetNode = nodes.find(n => n.id === nodeId);
      if (targetNode?.isFact) {
        setDragOverNodeId(nodeId);
      }
    }
  };

  const handleColumnDragLeave = () => {
    setDragOverNodeId(null);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggedNodeId) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const newX = (e.clientX - rect.left) / zoom - dragStartPos.current.offsetX;
      const newY = (e.clientY - rect.top) / zoom - dragStartPos.current.offsetY;

      setNodePositions(prev => {
        const updated = new Map(prev);
        updated.set(draggedNodeId, { x: newX, y: newY });
        return updated;
      });
    } else if (isPanning) {
      const deltaX = e.clientX - panStartPos.x;
      const deltaY = e.clientY - panStartPos.y;
      setPan(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      setPanStartPos({ x: e.clientX, y: e.clientY });
    }
  }, [draggedNodeId, isPanning, zoom]);

  // Handle column drag end
  const handleColumnDragEnd = () => {
    if (draggedColumn && !dragOverNodeId) {
      setDraggedColumn(null);
      setDragOverNodeId(null);
    }
  };

  const handleMouseUp = useCallback(() => {
    setDraggedNodeId(null);
    setIsPanning(false);
    if (draggedColumn) {
      handleColumnDragEnd();
    }
  }, [draggedColumn]);

  // Pan handlers - pan when clicking on empty space or with spacebar held
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handlePanStart = (e: React.MouseEvent) => {
    if (draggedNodeId) return; // Don't pan while dragging a node
    // Allow panning with spacebar or when clicking on SVG background
    const target = e.target as HTMLElement;
    if (isSpacePressed || target.tagName === 'svg' || (target.tagName === 'g' && target.getAttribute('data-pan-target'))) {
      e.preventDefault();
      setIsPanning(true);
      setPanStartPos({ x: e.clientX, y: e.clientY });
    }
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
    setZoom(prev => Math.max(minZoom, Math.min(maxZoom, prev + delta)));
  };

  useEffect(() => {
    if (draggedNodeId || isPanning || draggedColumn) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggedNodeId, isPanning, draggedColumn, handleMouseMove, handleMouseUp]);

  if (datasets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Model View
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-gray-500">
            <Database className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <p>No datasets available. Upload datasets to see the model view.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Model View
            {schemaType !== 'none' && (
              <Badge variant="outline" className="ml-2">
                {schemaType === 'star' ? (
                  <>
                    <Star className="h-3 w-3 mr-1" />
                    Star Schema
                  </>
                ) : (
                  <>
                    <Snowflake className="h-3 w-3 mr-1" />
                    Snowflake Schema
                  </>
                )}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500">
              Click table name to expand columns • Drag columns to fact tables to create relationships
            </p>
            <div className="flex items-center gap-1 border border-gray-200 rounded-md p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleZoomOut}
                disabled={zoom <= minZoom}
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-600 px-2 min-w-[3.5rem] text-center border-x border-gray-200">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleZoomIn}
                disabled={zoom >= maxZoom}
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 border-l border-gray-200 ml-0.5"
                onClick={handleFitToView}
                title="Fit to View"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 border-l border-gray-200 ml-0.5"
                onClick={handleResetZoom}
                title="Reset View"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-gray-500">
              {nodes.length} tables, {connections.length} relationships
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Click table name to show columns • Drag columns from dimension/regular tables to fact tables to create relationships • Click relationship lines to delete • Drag nodes to reposition • Hold Space and drag to pan • Scroll to zoom
        </p>
      </CardHeader>
      <CardContent>
        <div 
          ref={containerRef}
          className="relative bg-gray-50 rounded-lg border border-gray-200 overflow-hidden" 
          style={{ minHeight: '600px', maxHeight: '800px', height: '600px' }}
        >
          <svg 
            ref={svgRef}
            width="100%" 
            height="100%"
            style={{ cursor: isPanning ? 'grabbing' : draggedNodeId ? 'move' : 'default' }}
            onMouseDown={handlePanStart}
            onWheel={handleWheel}
            className="select-none"
          >
            <g 
              transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
              data-pan-target="true"
            >
              {/* Draw connections */}
              {connections.map(conn => {
                const { fromNode, toNode, relationship } = conn;
                const dx = toNode.x - fromNode.x;
                const dy = toNode.y - fromNode.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);
                
                const nodeRadius = 90;
                const startX = fromNode.x + nodeRadius * Math.cos(angle);
                const startY = fromNode.y + nodeRadius * Math.sin(angle);
                const endX = toNode.x - nodeRadius * Math.cos(angle);
                const endY = toNode.y - nodeRadius * Math.sin(angle);
                
                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;

                const isHovered = hoveredConnectionId === conn.id;

                return (
                  <g 
                    key={conn.id}
                    onMouseEnter={() => setHoveredConnectionId(conn.id)}
                    onMouseLeave={() => setHoveredConnectionId(null)}
                  >
                    {/* Clickable line area for selection */}
                    <line
                      x1={startX}
                      y1={startY}
                      x2={endX}
                      y2={endY}
                      stroke="transparent"
                      strokeWidth="20"
                      style={{ cursor: onDeleteRelationship ? 'pointer' : 'default' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onDeleteRelationship && window.confirm(`Delete relationship between ${relationship.fromColumn} and ${relationship.toColumn}?`)) {
                          onDeleteRelationship(relationship.id);
                        }
                      }}
                    />
                    {/* Visible connection line */}
                    <line
                      x1={startX}
                      y1={startY}
                      x2={endX}
                      y2={endY}
                      stroke={relationship.isFactTable ? '#3B82F6' : '#10B981'}
                      strokeWidth={isHovered ? '3' : '2'}
                      strokeDasharray={relationship.type === 'one-to-one' ? '5,5' : 'none'}
                      markerEnd="url(#arrowhead)"
                      style={{ cursor: onDeleteRelationship ? 'pointer' : 'default' }}
                    />
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-35"
                        y="-10"
                        width="70"
                        height="20"
                        fill="white"
                        stroke={isHovered ? '#EF4444' : '#666'}
                        strokeWidth={isHovered ? '2' : '1'}
                        rx="4"
                      />
                      <text
                        x="0"
                        y="5"
                        textAnchor="middle"
                        fontSize="10"
                        fill="#333"
                        fontWeight="500"
                      >
                        {relationship.type === 'one-to-one' ? '1:1' : 
                         relationship.type === 'one-to-many' ? '1:N' : 'N:N'}
                      </text>
                    </g>
                    <g transform={`translate(${midX}, ${midY + 18})`}>
                      <rect
                        x="-45"
                        y="-7"
                        width="90"
                        height="14"
                        fill="#f0f0f0"
                        stroke="#ccc"
                        strokeWidth="1"
                        rx="3"
                        opacity="0.9"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fontSize="8"
                        fill="#666"
                      >
                        {relationship.fromColumn} → {relationship.toColumn}
                      </text>
                    </g>
                    {/* Delete button on hover */}
                    {isHovered && onDeleteRelationship && (
                      <g transform={`translate(${midX + 50}, ${midY - 20})`}>
                        <circle
                          r="12"
                          fill="#EF4444"
                          stroke="white"
                          strokeWidth="2"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete relationship between ${relationship.fromColumn} and ${relationship.toColumn}?`)) {
                              onDeleteRelationship(relationship.id);
                            }
                          }}
                        />
                        <text
                          x="0"
                          y="4"
                          textAnchor="middle"
                          fontSize="14"
                          fill="white"
                          fontWeight="bold"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          ×
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Arrow marker definition */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3, 0 6" fill="#666" />
                </marker>
              </defs>

              {/* Draw nodes */}
              {nodes.map(node => {
                const isDragging = draggedNodeId === node.id;
                const isExpanded = expandedNodes.has(node.id);
                const isDragOver = dragOverNodeId === node.id;
                const nodeHeight = isExpanded ? 60 + Math.min(node.dataset.columns.length, 8) * 18 : 120;
                const showColumns = isExpanded && node.dataset.columns.length > 0;
                
                return (
                  <g 
                    key={node.id} 
                    transform={`translate(${node.x}, ${node.y})`}
                  >
                    {/* Node background - clickable area for dragging node */}
                    <rect
                      x="-90"
                      y={-nodeHeight / 2}
                      width="180"
                      height={nodeHeight}
                      rx="8"
                      fill={isDragOver ? '#E0F2FE' : node.isFact ? '#DBEAFE' : node.isDimension ? '#D1FAE5' : '#F3F4F6'}
                      stroke={isDragOver ? '#0EA5E9' : node.isFact ? '#3B82F6' : node.isDimension ? '#10B981' : '#9CA3AF'}
                      strokeWidth={isDragOver ? '4' : node.isFact || node.isDimension ? '3' : '2'}
                      strokeDasharray={isDragOver ? '5,5' : 'none'}
                      className={isDragging ? 'opacity-75' : 'hover:shadow-lg'}
                      style={{ 
                        cursor: draggedColumn && draggedColumn.nodeId !== node.id && node.isFact ? 'copy' : 'grab',
                        transition: isDragging ? 'none' : 'all 0.2s',
                        filter: isDragging ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' : 'none'
                      }}
                      onMouseDown={(e) => {
                        // Only drag node if not dragging a column
                        if (!draggedColumn) {
                          handleNodeMouseDown(e, node.id);
                        }
                      }}
                      onMouseOver={(e) => handleColumnDragOver(e, node.id)}
                      onMouseLeave={handleColumnDragLeave}
                      onMouseUp={(e) => {
                        if (draggedColumn && node.isFact) {
                          handleColumnDrop(e, node.id);
                        }
                      }}
                    />
                    
                    {/* Icon */}
                    <foreignObject x="-75" y="-50" width="30" height="30">
                      <div className="flex items-center justify-center pointer-events-none">
                        {node.isFact ? (
                          <Star className="h-6 w-6 text-blue-600" />
                        ) : node.isDimension ? (
                          <Snowflake className="h-6 w-6 text-green-600" />
                        ) : (
                          <Database className="h-6 w-6 text-gray-600" />
                        )}
                      </div>
                    </foreignObject>

                    {/* Dataset name - clickable to expand/collapse */}
                    <text
                      x="0"
                      y="-10"
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="bold"
                      fill="#111827"
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleNodeExpansion(node.id)}
                    >
                      {node.dataset.name.length > 20 
                        ? node.dataset.name.substring(0, 17) + '...' 
                        : node.dataset.name}
                    </text>

                    {/* Row count */}
                    <text
                      x="0"
                      y="8"
                      textAnchor="middle"
                      fontSize="10"
                      fill="#6B7280"
                      className="pointer-events-none"
                    >
                      {node.dataset.rowCount.toLocaleString()} rows
                    </text>

                    {/* Columns list */}
                    {showColumns ? (
                      <g>
                        {/* Column header */}
                        <line x1="-85" y1="20" x2="85" y2="20" stroke="#9CA3AF" strokeWidth="1" />
                        <text
                          x="0"
                          y="35"
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="bold"
                          fill="#6B7280"
                          className="pointer-events-none"
                        >
                          Columns ({node.dataset.columns.length})
                        </text>
                        
                        {/* Column items */}
                        {node.dataset.columns.slice(0, 8).map((col, index) => {
                          const isColumnDragging = draggedColumn?.nodeId === node.id && draggedColumn?.columnName === col.name;
                          const yPos = 50 + index * 18;
                          
                          return (
                            <g key={col.name}>
                              <rect
                                x="-85"
                                y={yPos - 12}
                                width="170"
                                height="16"
                                fill={isColumnDragging ? '#FEF3C7' : 'white'}
                                stroke={isColumnDragging ? '#F59E0B' : '#E5E7EB'}
                                strokeWidth="1"
                                rx="3"
                                style={{ 
                                  cursor: !node.isFact ? 'grab' : 'default',
                                  opacity: isColumnDragging ? 0.7 : 1
                                }}
                                onMouseDown={(e) => {
                                  // Allow dragging columns from non-fact tables (dimensions or regular tables)
                                  if (!node.isFact) {
                                    handleColumnMouseDown(e, node.id, col.name);
                                  }
                                }}
                              />
                              <text
                                x="-80"
                                y={yPos - 2}
                                fontSize="9"
                                fill="#374151"
                                className="pointer-events-none"
                              >
                                {col.name.length > 18 ? col.name.substring(0, 15) + '...' : col.name}
                              </text>
                              <text
                                x="75"
                                y={yPos - 2}
                                fontSize="8"
                                fill="#9CA3AF"
                                textAnchor="end"
                                className="pointer-events-none"
                              >
                                {col.type}
                              </text>
                            </g>
                          );
                        })}
                        {node.dataset.columns.length > 8 && (
                          <text
                            x="0"
                            y={50 + 8 * 18 + 10}
                            textAnchor="middle"
                            fontSize="8"
                            fill="#9CA3AF"
                            className="pointer-events-none"
                          >
                            +{node.dataset.columns.length - 8} more
                          </text>
                        )}
                      </g>
                    ) : (
                      <>
                        <text
                          x="0"
                          y="22"
                          textAnchor="middle"
                          fontSize="10"
                          fill="#6B7280"
                          className="pointer-events-none"
                        >
                          {node.dataset.columns.length} columns
                        </text>
                        <text
                          x="0"
                          y="35"
                          textAnchor="middle"
                          fontSize="9"
                          fill="#3B82F6"
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => toggleNodeExpansion(node.id)}
                        >
                          Click to show columns
                        </text>
                      </>
                    )}

                    {/* Schema type badge */}
                    {(node.isFact || node.isDimension) && !showColumns && (
                      <foreignObject x="-25" y="45" width="50" height="16">
                        <Badge 
                          variant={node.isFact ? 'default' : 'secondary'} 
                          className="text-xs w-full justify-center pointer-events-none"
                        >
                          {node.isFact ? 'Fact' : 'Dimension'}
                        </Badge>
                      </foreignObject>
                    )}

                    {/* Drop indicator */}
                    {isDragOver && draggedColumn && (
                      <text
                        x="0"
                        y={nodeHeight / 2 - 5}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#0EA5E9"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        Drop to create relationship
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-600 border-t pt-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-100 border-2 border-blue-500"></div>
            <span>Fact Table</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-100 border-2 border-green-500"></div>
            <span>Dimension Table</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-100 border-2 border-gray-400"></div>
            <span>Regular Table</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Hand className="h-4 w-4" />
            <span>Drag columns to fact tables • Drag nodes to move • Scroll to zoom</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RelationshipModelView;
