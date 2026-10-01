// Analytics Dashboard Component matching the wireframe layout
// Left Panel: Upload Dataset (top) + Describe Data (bottom)
// Right Panel: KPIs (top row) + Data Visualizations (2 rows of 3)

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, FileText, BarChart3, TrendingUp, Database, GripVertical,
  FileSpreadsheet, FileCode, X, Activity, AlertCircle, Star, Snowflake
} from 'lucide-react';
import { Dataset, Visualization, SchemaDetectionResult } from '@/lib/types';
import { renderVisualization } from '@/lib/visualizationRenderer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import ResizableVisualization from './ResizableVisualization';
import StatisticalDescription from './StatisticalDescription';
import DynamicKPIGenerator from './DynamicKPIGenerator';
import { toast } from 'sonner';


interface AnalyticsDashboardProps {
  datasets: Dataset[];
  visualizations: Visualization[];
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDatasetSelect?: (datasetId: string) => void;
  activeDatasetId?: string | null;
  onAnalyze?: () => void;
  isProcessing?: boolean;
  schemaInfo?: SchemaDetectionResult | null;
}

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  datasets,
  visualizations,
  onFileUpload,
  onDatasetSelect,
  activeDatasetId,
  onAnalyze,
  isProcessing = false,
  schemaInfo
}) => {
  const activeDataset = datasets.find(d => d.id === activeDatasetId);

  /**
   * How much of the width the left column takes.
   *
   * Remembered per browser, because someone who widens the statistics panel
   * to read it has said something about how they work, and making them say it
   * again on every visit is its own small insult. localStorage can throw in a
   * private window, so every read and write is guarded and the default stands
   * if it fails.
   */
  const LEFT_MIN = 20;
  const LEFT_MAX = 70;
  const LEFT_DEFAULT = 34;
  const STORAGE_KEY = 'dataafrik.dashboard.leftPercent';

  const [leftPercent, setLeftPercent] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= LEFT_MIN && saved <= LEFT_MAX) return saved;
    } catch {
      // Blocked or unavailable storage is not a reason to fail to render.
    }
    return LEFT_DEFAULT;
  });

  // Matches the `lg:` breakpoint the layout stacks at, so the inline width is
  // only applied when there are two columns to divide.
  const [isWide, setIsWide] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  );

  React.useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const remember = (percent: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(percent));
    } catch {
      // See above - a width that does not persist is still a width that works.
    }
  };

  const splitRef = React.useRef<HTMLDivElement>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;

    const move = (pointer: PointerEvent) => {
      const box = container.getBoundingClientRect();
      if (box.width === 0) return;
      const raw = ((pointer.clientX - box.left) / box.width) * 100;
      setLeftPercent(Math.min(LEFT_MAX, Math.max(LEFT_MIN, raw)));
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.userSelect = '';
      setLeftPercent(current => {
        remember(current);
        return current;
      });
    };

    // Without this, dragging selects the text under the pointer.
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  /** The same control from the keyboard, so the split is not mouse-only. */
  const nudgeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0;
    if (step === 0) return;
    event.preventDefault();
    setLeftPercent(current => {
      const next = Math.min(LEFT_MAX, Math.max(LEFT_MIN, current + step));
      remember(next);
      return next;
    });
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop();
    if (['xlsx', 'xls'].includes(extension || '')) {
      return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
    }
    if (extension === 'json') {
      return <FileCode className="h-5 w-5 text-purple-500" />;
    }
    return <FileText className="h-5 w-5 text-blue-500" />;
  };


  return (
    /**
     * A draggable split rather than a fixed 4/8 grid.
     *
     * The statistics table needs about 990px for a seven-column dataset -
     * 150px for the Statistic column and 120px for each one after it - and a
     * third of the screen is rarely that. It was readable only by finding a
     * thin horizontal scrollbar, which is close to not being readable at all.
     *
     * Deliberately NOT ResizablePanelGroup, which is used elsewhere in this
     * file. That primitive needs a container of definite height, and this
     * dashboard is an ordinary scrolling document - dropping it in collapsed
     * the whole layout to one pixel tall. Percentage widths with auto heights
     * keep the page scrolling the way it already does.
     *
     * Stacks below lg, where a side-by-side split leaves neither side usable.
     */
    <div ref={splitRef} className="flex flex-col lg:flex-row h-full">
      {/* Left Panel - width is draggable on large screens */}
      <div
        className="space-y-6 w-full lg:w-auto min-w-0"
        style={isWide ? { width: `${leftPercent}%` } : undefined}
      >
        {/* UPLOAD DATASET Section - Large */}
        <Card className="h-[60%]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              UPLOAD DATASET
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 h-[calc(100%-4rem)] overflow-y-auto">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.json"
                onChange={onFileUpload}
                className="hidden"
                id="file-upload-input"
              />
              <label
                htmlFor="file-upload-input"
                className="cursor-pointer flex flex-col items-center gap-4"
              >
                <div className="flex items-center gap-2">
                  <Upload className="h-12 w-12 text-gray-400" />
                  <div className="flex gap-1">
                    <FileText className="h-6 w-6 text-blue-500" />
                    <FileSpreadsheet className="h-6 w-6 text-green-500" />
                    <FileCode className="h-6 w-6 text-purple-500" />
                  </div>
                </div>
                <div>
                  <p className="text-lg font-medium text-gray-900">Upload Data Files</p>
                  <p className="text-sm text-gray-500">CSV, Excel, or JSON files</p>
                </div>
              </label>
            </div>

                {datasets.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-700">Uploaded Datasets</h3>
                    
                    {/* Tab-based selector for multiple datasets from same file */}
                    {datasets.length > 1 && (
                      <div className="border-b border-gray-200 mb-3">
                        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                          {datasets.map(dataset => {
                            // Extract sheet name from dataset name (format: "filename - SheetName")
                            const sheetName = dataset.name.includes(' - ') 
                              ? dataset.name.split(' - ')[1] 
                              : dataset.name;
                            
                            const isActive = activeDatasetId === dataset.id;
                            
                            return (
                              <button
                                key={dataset.id}
                                onClick={() => onDatasetSelect?.(dataset.id)}
                                className={`
                                  px-4 py-2 text-sm font-medium whitespace-nowrap
                                  border-b-2 transition-colors relative
                                  ${isActive 
                                    ? 'text-gray-900 border-green-500 bg-gray-50 rounded-t-lg' 
                                    : 'text-gray-600 border-transparent hover:text-gray-900 hover:border-gray-300'
                                  }
                                `}
                              >
                                {sheetName}
                                {isActive && (
                                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500"></span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {/* List view for all datasets */}
                    {datasets.map(dataset => (
                      <Card
                        key={dataset.id}
                        className={`p-3 cursor-pointer transition-all ${
                          activeDatasetId === dataset.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'hover:border-gray-400'
                        }`}
                        onClick={() => onDatasetSelect?.(dataset.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {getFileIcon(dataset.name)}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{dataset.name}</p>
                              <p className="text-xs text-gray-500">
                                {dataset.rowCount.toLocaleString()} rows × {dataset.columns.length} cols
                              </p>
                            </div>
                          </div>
                          {activeDatasetId === dataset.id && (
                            <Badge variant="default" className="ml-2">Active</Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                    {onAnalyze && (
                      <Button 
                        onClick={onAnalyze} 
                        disabled={isProcessing || datasets.length === 0}
                        className="w-full mt-4"
                        size="sm"
                      >
                        {isProcessing ? (
                          <>
                            <Activity className="h-4 w-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <BarChart3 className="h-4 w-4 mr-2" />
                            Apply & Analyze Data
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                )}
          </CardContent>
        </Card>

        {/* DESCRIBE DATA Section - Statistical Description */}
        <div className="h-[40%] min-h-[320px]">
          <StatisticalDescription dataset={activeDataset || null} />
        </div>
      </div>

      {/* Drag to widen either side. Hidden when the panels are stacked. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the panels"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={nudgeWithKeyboard}
        title="Drag to resize"
        className={
          'hidden lg:flex group relative mx-1 w-3 shrink-0 cursor-col-resize ' +
          'items-center justify-center rounded focus:outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-blue-500'
        }
      >
        <div className="h-full w-px bg-gray-200 group-hover:bg-blue-400 transition-colors" />
        <div
          className={
            'absolute flex h-8 w-3 items-center justify-center rounded border ' +
            'border-gray-300 bg-white shadow-sm group-hover:border-blue-400'
          }
        >
          <GripVertical className="h-3 w-3 text-gray-400 group-hover:text-blue-500" />
        </div>
      </div>

      {/* Right Panel - takes whatever the left one does not */}
      <div className="space-y-6 flex-1 min-w-0">
        {/* Schema Detection Badge */}
        {schemaInfo && schemaInfo.schemaType !== 'none' && schemaInfo.schemaType !== 'flat' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            {schemaInfo.schemaType === 'star' ? (
              <Star className="h-4 w-4 text-blue-600" />
            ) : (
              <Snowflake className="h-4 w-4 text-indigo-600" />
            )}
            <span className="text-sm font-medium text-blue-900">
              {schemaInfo.schemaType === 'star' ? 'Star' : 'Snowflake'} Schema
            </span>
            <Badge variant="outline" className="text-xs">
              {(schemaInfo.confidence * 100).toFixed(0)}% confidence
            </Badge>
            <span className="text-xs text-blue-700 ml-auto">
              {schemaInfo.factTables.length} fact, {schemaInfo.dimensionTables.length} dimension table(s)
            </span>
          </div>
        )}

        {/* Dynamic KPI Cards - Power BI-like (6 cards) */}
        <DynamicKPIGenerator dataset={activeDataset || null} />

        {/* Data Visualizations - Resizable Grid */}
        <div className="space-y-4">
          {/* First Row - Resizable */}
          {visualizations.length > 0 ? (
            <ResizablePanelGroup direction="horizontal" className="gap-4 min-h-[320px]">
              {visualizations.slice(0, 3).map((viz, index) => (
                <React.Fragment key={viz.id || index}>
                  <ResizablePanel 
                    id={`viz-panel-row1-${index}`}
                    order={index}
                    defaultSize={33.34}
                    minSize={20}
                  >
                    <ResizableVisualization
                      visualization={viz}
                      defaultSize={100}
                      minSize={20}
                      onRemove={index === 0 && visualizations.length === 1 ? undefined : () => {
                        // Handle removal if needed
                      }}
                    />
                  </ResizablePanel>
                  {index < 2 && <ResizableHandle withHandle />}
                </React.Fragment>
              ))}
              {/* Fill remaining slots with placeholders */}
              {visualizations.length < 3 && Array.from({ length: 3 - visualizations.length }).map((_, index) => (
                <React.Fragment key={`placeholder-${index}`}>
                  {index > 0 && <ResizableHandle withHandle />}
                  <ResizablePanel 
                    id={`placeholder-panel-row1-${index}`}
                    order={visualizations.length + index}
                    defaultSize={33.34}
                    minSize={20}
                  >
                    <Card className="h-full p-4 border-dashed">
                      <CardHeader className="p-0 pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium text-gray-400">DATA VISUALIZATION</CardTitle>
                          <Badge variant="outline" className="text-xs text-gray-400">RENDITION</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0 pt-2">
                        <div className="h-48 bg-gray-50 rounded flex items-center justify-center border-2 border-dashed border-gray-300">
                          <div className="text-center">
                            <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-xs text-gray-400">Placeholder</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </ResizablePanel>
                </React.Fragment>
              ))}
            </ResizablePanelGroup>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={`empty-${index}`} className="p-4 border-dashed">
                  <CardHeader className="p-0 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium text-gray-400">DATA VISUALIZATION</CardTitle>
                      <Badge variant="outline" className="text-xs text-gray-400">RENDITION</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pt-2">
                    <div className="h-48 bg-gray-50 rounded flex items-center justify-center border-2 border-dashed border-gray-300">
                      <div className="text-center">
                        <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-xs text-gray-400">No data</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Second Row - Resizable */}
          {visualizations.length > 3 ? (
            <ResizablePanelGroup direction="horizontal" className="gap-4 min-h-[320px]">
              {visualizations.slice(3, 6).map((viz, index) => (
                <React.Fragment key={viz.id || index + 3}>
                  <ResizablePanel 
                    id={`viz-panel-row2-${index}`}
                    order={index}
                    defaultSize={33.34}
                    minSize={20}
                  >
                    <ResizableVisualization
                      visualization={viz}
                      defaultSize={100}
                      minSize={20}
                    />
                  </ResizablePanel>
                  {index < 2 && <ResizableHandle withHandle />}
                </React.Fragment>
              ))}
              {/* Fill remaining slots */}
              {visualizations.length < 6 && Array.from({ length: 6 - visualizations.length }).map((_, index) => (
                <React.Fragment key={`placeholder-${index + 3}`}>
                  {index > 0 && <ResizableHandle withHandle />}
                  <ResizablePanel 
                    id={`placeholder-panel-row2-${index}`}
                    order={visualizations.length - 3 + index}
                    defaultSize={33.34}
                    minSize={20}
                  >
                    <Card className="h-full p-4 border-dashed">
                      <CardHeader className="p-0 pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium text-gray-400">DATA VISUALIZATION</CardTitle>
                          <Badge variant="outline" className="text-xs text-gray-400">RENDITION</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0 pt-2">
                        <div className="h-48 bg-gray-50 rounded flex items-center justify-center border-2 border-dashed border-gray-300">
                          <div className="text-center">
                            <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-xs text-gray-400">Placeholder</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </ResizablePanel>
                </React.Fragment>
              ))}
            </ResizablePanelGroup>
          ) : visualizations.length === 0 && (
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={`empty-${index + 3}`} className="p-4 border-dashed">
                  <CardHeader className="p-0 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium text-gray-400">DATA VISUALIZATION</CardTitle>
                      <Badge variant="outline" className="text-xs text-gray-400">RENDITION</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pt-2">
                    <div className="h-48 bg-gray-50 rounded flex items-center justify-center border-2 border-dashed border-gray-300">
                      <div className="text-center">
                        <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-xs text-gray-400">No data</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;

