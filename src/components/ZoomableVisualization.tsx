// Zoomable Visualization Component for All Visualizations view
import React, { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface ZoomableVisualizationProps {
  visualization: Visualization;
  getVisualizationIcon?: (type: string) => React.ReactNode;
}

const VISUALIZATION_TYPE_OPTIONS: SupportedVisualizationType[] = [
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
  'table',
];

const VISUALIZATION_TYPE_LABEL: Record<SupportedVisualizationType, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  scatter: 'Scatter',
  table: 'Table',
};

const toDefaultType = (type: Visualization['type']): SupportedVisualizationType => {
  if (type === 'gauge') return 'bar';
  return type as SupportedVisualizationType;
};

const ZoomableVisualization: React.FC<ZoomableVisualizationProps> = ({
  visualization,
  getVisualizationIcon
}) => {
  const [selectedVisualizationType, setSelectedVisualizationType] = useState<SupportedVisualizationType>(
    () => toDefaultType(visualization.type)
  );
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const minZoom = 0.5;
  const maxZoom = 3;
  const zoomStep = 0.25;

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
    // Only enable dragging when zoomed in or out from default
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

  React.useEffect(() => {
    setSelectedVisualizationType(toDefaultType(visualization.type));
  }, [visualization.id, visualization.type]);

  return (
    <Card className="p-6 h-full flex flex-col">
      <CardHeader className="pb-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {getVisualizationIcon && getVisualizationIcon(visualization.type)}
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-medium truncate">{visualization.title}</CardTitle>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm text-gray-500">{VISUALIZATION_TYPE_LABEL[selectedVisualizationType]} Chart</p>
                <Select
                  value={selectedVisualizationType}
                  onValueChange={(value) => setSelectedVisualizationType(value as SupportedVisualizationType)}
                >
                  <SelectTrigger className="h-7 w-[120px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {VISUALIZATION_TYPE_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {VISUALIZATION_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {/* Zoom Controls */}
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <div className="flex items-center gap-1 border border-gray-200 rounded-md p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 hover:bg-gray-100"
                onClick={handleZoomOut}
                disabled={zoomLevel <= minZoom}
                title="Zoom Out (-)"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-600 px-2 min-w-[3rem] text-center border-x border-gray-200">
                {Math.round(zoomLevel * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 hover:bg-gray-100"
                onClick={handleZoomIn}
                disabled={zoomLevel >= maxZoom}
                title="Zoom In (+)"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              {zoomLevel !== 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 hover:bg-gray-100 border-l border-gray-200 ml-0.5"
                  onClick={handleResetZoom}
                  title="Reset Zoom & Pan"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {zoomLevel !== 1 && (
              <span className="text-xs text-gray-400 ml-1 flex items-center gap-0.5">
                <Move className="h-3 w-3" /> Drag
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-4 pt-2">
        <div
          ref={containerRef}
          id={`viz-${visualization.id}`}
          data-viz-id={visualization.id}
          className="relative bg-gray-50 rounded-lg border border-gray-200 w-full flex items-center justify-center"
          style={{
            minHeight: '350px',
            height: '350px',
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
  );
};

export default ZoomableVisualization;
