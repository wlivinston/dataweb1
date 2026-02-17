// Resizable Visualization Container Component
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Visualization } from '@/lib/types';
import { renderVisualization, type SupportedVisualizationType } from '@/lib/visualizationRenderer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Maximize2, Minimize2, X, ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface ResizableVisualizationProps {
  visualization: Visualization;
  onRemove?: () => void;
  defaultSize?: number;
  minSize?: number;
}

const ALL_VISUALIZATION_TYPES: SupportedVisualizationType[] = [
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
  'table',
];

const getSwitchableVisualizationTypes = (baseType: Visualization['type']): SupportedVisualizationType[] => {
  const preferred = baseType === 'gauge' ? 'bar' : (baseType as SupportedVisualizationType);
  return [preferred, ...ALL_VISUALIZATION_TYPES.filter(type => type !== preferred)];
};

const visualizationTypeLabel: Record<SupportedVisualizationType, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  scatter: 'Scatter',
  table: 'Table',
};

const ResizableVisualization: React.FC<ResizableVisualizationProps> = ({
  visualization,
  onRemove,
  defaultSize = 33.33,
  minSize = 20
}) => {
  const visualizationTypeOptions = useMemo(
    () => getSwitchableVisualizationTypes(visualization.type),
    [visualization.type]
  );
  const [selectedVisualizationType, setSelectedVisualizationType] = useState<SupportedVisualizationType>(
    () => getSwitchableVisualizationTypes(visualization.type)[0]
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const minZoom = 0.5;
  const maxZoom = 3;
  const zoomStep = 0.25;

  useEffect(() => {
    setSelectedVisualizationType(visualizationTypeOptions[0]);
  }, [visualization.id, visualizationTypeOptions]);

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + zoomStep, maxZoom));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - zoomStep, minZoom));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel === 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panOffset };
  }, [zoomLevel, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPanOffset({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const containerHeight = isExpanded ? 400 : 240;

  return (
    <div className="relative h-full w-full">
      <Card className="h-full flex flex-col">
        <CardHeader className="p-3 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">DATA VISUALIZATION</CardTitle>
              <Badge variant="outline" className="text-xs">RENDITION</Badge>
              <Select
                value={selectedVisualizationType}
                onValueChange={(value) => setSelectedVisualizationType(value as SupportedVisualizationType)}
              >
                <SelectTrigger className="h-7 w-[110px] text-xs">
                  <SelectValue placeholder="Chart type" />
                </SelectTrigger>
                <SelectContent>
                  {visualizationTypeOptions.map(option => (
                    <SelectItem key={option} value={option} className="text-xs">
                      {visualizationTypeLabel[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              {/* Zoom Controls */}
              <div className="flex items-center gap-0.5 border-r border-gray-200 pr-1 mr-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= minZoom}
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3 w-3" />
                </Button>
                <span className="text-xs text-gray-500 px-1 min-w-[2.5rem] text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= maxZoom}
                  title="Zoom In"
                >
                  <ZoomIn className="h-3 w-3" />
                </Button>
                {zoomLevel !== 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={handleResetZoom}
                      title="Reset Zoom & Pan"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                    <Move className="h-3 w-3 text-gray-400 ml-0.5" />
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Minimize" : "Expand"}
              >
                {isExpanded ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
              </Button>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                  onClick={onRemove}
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{visualization.title}</p>
        </CardHeader>
        <CardContent className="p-2 flex-1 overflow-hidden">
          <div
            id={`viz-${visualization.id}`}
            data-viz-id={visualization.id}
            className="bg-gray-50 rounded border border-gray-200 relative flex items-center justify-center"
            style={{
              minHeight: `${containerHeight}px`,
              height: `${containerHeight}px`,
              overflow: 'hidden',
              cursor: zoomLevel !== 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            <div
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                transformOrigin: 'center center',
                width: '100%',
                pointerEvents: isDragging ? 'none' : 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div style={{ width: '100%' }}>
                {renderVisualization(visualization, selectedVisualizationType)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResizableVisualization;
