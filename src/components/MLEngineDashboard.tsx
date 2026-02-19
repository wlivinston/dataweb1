import React, { useState, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Upload, BrainCircuit, Zap, CheckCircle2, Circle, ChevronRight,
  AlertTriangle, Download, Copy, RefreshCw, TrendingUp, Settings,
  BarChart2, Layers, Cpu, Rocket, Target, FileText
} from 'lucide-react';
import type { Dataset, ColumnInfo } from '@/lib/types';
import {
  detectMLProblem, preprocessDataset, analyzeFeatures, trainAllModels,
  makePrediction, generateDeploymentGuidance,
} from '@/lib/mlEngine';
import type {
  MLPipelineState, MLPipelineStep,
  PreprocessingReport, FeatureEngineeringResult,
  ModelComparisonResult, ModelResult, PredictionResult,
  PreprocessingStrategy, ScalingMethod,
} from '@/lib/mlEngine';
import { toast } from 'sonner';

// ============================================================
// Types & Constants
// ============================================================

const PIPELINE_STEPS: { key: MLPipelineStep; label: string; icon: React.ReactNode }[] = [
  { key: 'problem_definition', label: 'Problem Definition', icon: <Target className="h-4 w-4" /> },
  { key: 'preprocessing', label: 'Preprocessing', icon: <Settings className="h-4 w-4" /> },
  { key: 'feature_engineering', label: 'Feature Engineering', icon: <Layers className="h-4 w-4" /> },
  { key: 'model_training', label: 'Model Training', icon: <Cpu className="h-4 w-4" /> },
  { key: 'evaluation', label: 'Evaluation', icon: <BarChart2 className="h-4 w-4" /> },
  { key: 'deployment', label: 'Deployment', icon: <Rocket className="h-4 w-4" /> },
];

const COMPLETED_STEPS: Record<MLPipelineStep, MLPipelineStep[]> = {
  problem_definition: [],
  preprocessing: ['problem_definition'],
  feature_engineering: ['problem_definition', 'preprocessing'],
  model_training: ['problem_definition', 'preprocessing', 'feature_engineering'],
  evaluation: ['problem_definition', 'preprocessing', 'feature_engineering', 'model_training'],
  deployment: ['problem_definition', 'preprocessing', 'feature_engineering', 'model_training', 'evaluation'],
};

const ALGORITHM_INFO: Record<string, { label: string; desc: string; when: string }> = {
  linear_regression: { label: 'Linear Regression', desc: 'Fast, interpretable, and works well with linear relationships between features and target.', when: 'Continuous target with roughly linear patterns.' },
  logistic_regression: { label: 'Logistic Regression', desc: 'Probabilistic classifier with built-in confidence scores. Highly interpretable.', when: 'Binary or multi-class categorical target.' },
  decision_tree: { label: 'Decision Tree', desc: 'Non-linear model that captures complex feature interactions through hierarchical splits.', when: 'When interpretability and non-linear patterns matter.' },
  random_forest: { label: 'Random Forest', desc: 'Ensemble of trees that reduces variance. Often best performance for tabular data.', when: 'High-dimensional datasets where accuracy is priority.' },
  k_means: { label: 'K-Means Clustering', desc: 'Groups similar rows into clusters when no target variable exists.', when: 'Unsupervised discovery of natural groups.' },
};

const importanceColor = (v: number) => {
  if (v >= 0.7) return '#22c55e';
  if (v >= 0.4) return '#f59e0b';
  return '#ef4444';
};

const correlationColor = (r: number): string => {
  const abs = Math.abs(r);
  if (r > 0) return `rgba(34, 197, 94, ${abs})`;
  return `rgba(239, 68, 68, ${abs})`;
};

// ============================================================
// Utility: Parse uploaded file to Dataset
// ============================================================

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target?.result as string);
    r.onerror = reject;
    r.readAsText(file);
  });

const readFileAsBinary = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target?.result as string);
    r.onerror = reject;
    r.readAsBinaryString(file);
  });

const parseFileToDataset = async (file: File): Promise<Dataset> => {
  let rows: Record<string, unknown>[] = [];

  if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
    const text = await readFileAsText(file);
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have at least a header and one data row.');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
  } else {
    // Lazy-load the heavy XLSX library only when an Excel file is uploaded
    const [binaryData, XLSX] = await Promise.all([
      readFileAsBinary(file),
      import('xlsx'),
    ]);
    const wb = XLSX.read(binaryData, { type: 'binary' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
  }

  if (rows.length === 0) throw new Error('No data rows found.');
  const headers = Object.keys(rows[0]);
  const columns: ColumnInfo[] = headers.map(h => {
    const vals = rows.map(r => r[h]).filter(v => v !== null && v !== undefined && v !== '');
    const numericVals = vals.map(v => Number(v)).filter(v => !isNaN(v));
    const isNumeric = numericVals.length >= vals.length * 0.8;
    const uniqueVals = new Set(vals.map(v => String(v)));
    return {
      name: h,
      type: isNumeric ? 'number' : 'string',
      sampleValues: vals.slice(0, 5).map(String),
      nullCount: rows.length - vals.length,
      uniqueCount: uniqueVals.size,
    };
  });

  return {
    id: `upload-${Date.now()}`,
    name: file.name,
    description: `Uploaded file: ${file.name}`,
    columns,
    rowCount: rows.length,
    dataTypes: Object.fromEntries(columns.map(c => [c.name, c.type])),
    data: rows,
  };
};

// ============================================================
// Data Summary Helper
// ============================================================

function buildDataSummary(dataset: import('@/lib/types').Dataset): string {
  const cols = dataset.columns;
  const numericCols = cols.filter(c => c.type === 'number');
  const categoricalCols = cols.filter(c => c.type === 'string');
  const totalCells = dataset.rowCount * cols.length;
  const totalMissing = cols.reduce((sum, c) => sum + (c.nullCount ?? 0), 0);
  const missingPct = totalCells > 0 ? ((totalMissing / totalCells) * 100).toFixed(1) : '0';
  const highCardCols = categoricalCols.filter(c => (c.uniqueCount ?? 0) > 20);
  const lowVarCols = numericCols.filter(c => (c.uniqueCount ?? 0) <= 3);

  const parts: string[] = [];

  // Dataset shape
  parts.push(
    `Your dataset "${dataset.name}" contains ${dataset.rowCount.toLocaleString()} records across ${cols.length} column${cols.length !== 1 ? 's' : ''}.`
  );

  // Column breakdown
  if (numericCols.length > 0 && categoricalCols.length > 0) {
    parts.push(
      `It has ${numericCols.length} numeric column${numericCols.length !== 1 ? 's' : ''} (${numericCols.slice(0, 3).map(c => c.name).join(', ')}${numericCols.length > 3 ? ', …' : ''}) ` +
      `and ${categoricalCols.length} text/category column${categoricalCols.length !== 1 ? 's' : ''} (${categoricalCols.slice(0, 3).map(c => c.name).join(', ')}${categoricalCols.length > 3 ? ', …' : ''}).`
    );
  } else if (numericCols.length > 0) {
    parts.push(
      `All ${numericCols.length} columns are numeric (${numericCols.slice(0, 4).map(c => c.name).join(', ')}${numericCols.length > 4 ? ', …' : ''}), which is ideal for regression and clustering models.`
    );
  } else {
    parts.push(
      `All ${categoricalCols.length} columns contain text or categories. The engine will encode these for machine learning.`
    );
  }

  // Data quality
  if (totalMissing === 0) {
    parts.push('The data appears complete — no missing values were detected.');
  } else if (parseFloat(missingPct) < 5) {
    parts.push(`There are a small number of missing values (${missingPct}% of cells), which the engine will handle automatically during preprocessing.`);
  } else {
    parts.push(`About ${missingPct}% of values are missing. The preprocessing step will let you choose how to handle them (fill with averages, remove rows, etc.).`);
  }

  // High cardinality warning
  if (highCardCols.length > 0) {
    parts.push(
      `Note: ${highCardCols.map(c => `"${c.name}"`).join(', ')} ${highCardCols.length === 1 ? 'has' : 'have'} many unique text values — ${highCardCols.length === 1 ? 'it' : 'they'} may be identifiers (like names or IDs) rather than useful features for prediction.`
    );
  }

  // Low-variance numeric columns
  if (lowVarCols.length > 0 && dataset.rowCount > 20) {
    parts.push(
      `The column${lowVarCols.length !== 1 ? 's' : ''} ${lowVarCols.map(c => `"${c.name}"`).join(', ')} ${lowVarCols.length !== 1 ? 'have' : 'has'} very few distinct values and may represent categories rather than measurements.`
    );
  }

  // Size guidance
  if (dataset.rowCount < 50) {
    parts.push('With fewer than 50 rows, results will be indicative only — more data generally leads to more reliable predictions.');
  } else if (dataset.rowCount >= 1000) {
    parts.push(`With ${dataset.rowCount.toLocaleString()} rows, the engine has good signal to train reliable models.`);
  }

  // Closing instruction
  parts.push('Click "Run Auto-Detection" below to let the engine identify the best ML approach for this data.');

  return parts.join(' ');
}

// ============================================================
// Main Component
// ============================================================

const MLEngineDashboard: React.FC = () => {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pipelineState, setPipelineState] = useState<MLPipelineState>({
    currentStep: 'problem_definition',
    problemDetection: null,
    preprocessingReport: null,
    featureEngineering: null,
    modelComparison: null,
    selectedModel: null,
    deploymentGuidance: null,
    isRunning: false,
    progress: 0,
    progressMessage: '',
    cleanedDataset: null,
  });

  const [userConfig, setUserConfig] = useState({
    targetColumn: '',
    selectedFeatures: [] as string[],
    trainTestSplit: 0.8,
    imputeStrategy: 'mean_imputation' as PreprocessingStrategy,
    scalingMethod: 'z_score' as ScalingMethod,
  });

  const [activeTab, setActiveTab] = useState<MLPipelineStep>('problem_definition');
  const [predictionInputs, setPredictionInputs] = useState<Record<string, string>>({});
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [selectedEvalModel, setSelectedEvalModel] = useState<string>('');

  const isStepCompleted = (step: MLPipelineStep) =>
    COMPLETED_STEPS[activeTab].includes(step);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const ds = await parseFileToDataset(file);
      setDataset(ds);
      const numericCols = ds.columns.filter(c => c.type === 'number').map(c => c.name);
      setUserConfig(prev => ({ ...prev, selectedFeatures: numericCols }));
      setPipelineState(prev => ({ ...prev, problemDetection: null, preprocessingReport: null, featureEngineering: null, modelComparison: null, selectedModel: null, deploymentGuidance: null, cleanedDataset: null }));
      setPredictionResult(null);
      toast.success(`Loaded ${ds.rowCount.toLocaleString()} rows × ${ds.columns.length} columns from "${file.name}"`);
    } catch (err) {
      toast.error(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const runProblemDetection = () => {
    if (!dataset) return;
    const detection = detectMLProblem(dataset);
    setUserConfig(prev => ({
      ...prev,
      targetColumn: detection.suggestedTarget || (dataset.columns[0]?.name ?? ''),
      selectedFeatures: detection.suggestedFeatures.length > 0 ? detection.suggestedFeatures : dataset.columns.filter(c => c.name !== detection.suggestedTarget).map(c => c.name),
    }));
    setPipelineState(prev => ({ ...prev, problemDetection: detection }));
    toast.success('Problem detection complete!');
  };

  const runPreprocessing = () => {
    if (!dataset || !userConfig.targetColumn) {
      toast.error('Please run problem detection and select a target column first.');
      return;
    }
    const { processedDataset, report } = preprocessDataset(
      dataset,
      userConfig.targetColumn,
      userConfig.selectedFeatures,
      {
        imputeStrategy: userConfig.imputeStrategy,
        scalingMethod: userConfig.scalingMethod,
        trainTestSplit: userConfig.trainTestSplit,
      }
    );
    setPipelineState(prev => ({ ...prev, preprocessingReport: report, cleanedDataset: processedDataset }));
    toast.success(`Preprocessing complete. ${report.cleanedRows} clean rows ready.`);
  };

  const runFeatureEngineering = () => {
    if (!dataset || !pipelineState.cleanedDataset) {
      toast.error('Run preprocessing first.');
      return;
    }
    const result = analyzeFeatures(
      dataset,
      userConfig.targetColumn,
      userConfig.selectedFeatures,
      pipelineState.cleanedDataset
    );
    setPipelineState(prev => ({ ...prev, featureEngineering: result }));
    toast.success('Feature analysis complete!');
  };

  const runModelTraining = async () => {
    if (!pipelineState.cleanedDataset || !pipelineState.problemDetection) {
      toast.error('Run preprocessing and feature engineering first.');
      return;
    }
    setPipelineState(prev => ({ ...prev, isRunning: true, progress: 0, progressMessage: 'Starting...' }));

    try {
      const comparison = await trainAllModels(
        pipelineState.cleanedDataset,
        pipelineState.problemDetection.problemType,
        userConfig.trainTestSplit,
        (progress, message) => {
          setPipelineState(prev => ({ ...prev, progress, progressMessage: message }));
        }
      );
      setPipelineState(prev => ({
        ...prev,
        modelComparison: comparison,
        selectedModel: comparison.bestModel,
        isRunning: false,
        progress: 100,
        progressMessage: 'Done!',
      }));
      setSelectedEvalModel(comparison.bestModel.algorithm);
      toast.success(`Training complete! Best model: ${comparison.bestModel.algorithmLabel}`);
    } catch (err) {
      setPipelineState(prev => ({ ...prev, isRunning: false }));
      toast.error('Training failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const generateDeployment = () => {
    const { selectedModel, cleanedDataset } = pipelineState;
    if (!selectedModel || !cleanedDataset) {
      toast.error('Train a model first.');
      return;
    }
    const guidance = generateDeploymentGuidance(selectedModel, cleanedDataset);
    setPipelineState(prev => ({ ...prev, deploymentGuidance: guidance }));
    toast.success('Deployment plan generated!');
  };

  const handlePredict = () => {
    const { selectedModel, cleanedDataset } = pipelineState;
    if (!selectedModel || !cleanedDataset) return;
    const result = makePrediction(
      {
        featureValues: predictionInputs,
        model: selectedModel,
        featureColumns: cleanedDataset.featureColumns,
        targetColumn: cleanedDataset.targetColumn,
      },
      cleanedDataset
    );
    setPredictionResult(result);
  };

  const downloadModelConfig = () => {
    const config = pipelineState.deploymentGuidance?.exportedModelConfig;
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ml-model-${pipelineState.selectedModel?.algorithm || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Model config downloaded!');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard!'));
  };

  const goToStep = (step: MLPipelineStep) => {
    setActiveTab(step);
  };

  // ============================================================
  // Step Stepper
  // ============================================================

  const StepStepper = () => (
    <div className="flex items-center justify-between mb-6 overflow-x-auto pb-2">
      {PIPELINE_STEPS.map((step, idx) => {
        const isActive = activeTab === step.key;
        const isDone = isStepCompleted(step.key) ||
          (step.key === 'problem_definition' && !!pipelineState.problemDetection) ||
          (step.key === 'preprocessing' && !!pipelineState.preprocessingReport) ||
          (step.key === 'feature_engineering' && !!pipelineState.featureEngineering) ||
          (step.key === 'model_training' && !!pipelineState.modelComparison) ||
          (step.key === 'evaluation' && !!pipelineState.modelComparison) ||
          (step.key === 'deployment' && !!pipelineState.deploymentGuidance);

        return (
          <React.Fragment key={step.key}>
            <button
              onClick={() => goToStep(step.key)}
              className={`flex flex-col items-center min-w-[80px] transition-all ${isActive ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-1 border-2 transition-colors ${
                isActive ? 'bg-blue-600 border-blue-600 text-white' :
                isDone ? 'bg-green-500 border-green-500 text-white' :
                'bg-white border-gray-300 text-gray-400'
              }`}>
                {isDone && !isActive ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-bold">{idx + 1}</span>}
              </div>
              <span className={`text-xs text-center font-medium whitespace-nowrap ${isActive ? 'text-blue-600' : isDone ? 'text-green-600' : 'text-gray-400'}`}>
                {step.label}
              </span>
            </button>
            {idx < PIPELINE_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-18px] ${isDone ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  // ============================================================
  // Upload Zone
  // ============================================================

  const UploadZone = () => (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
        isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.txt"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
      />
      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="h-10 w-10 text-blue-500 animate-spin" />
          <p className="text-gray-600">Parsing file...</p>
        </div>
      ) : (
        <>
          <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-lg font-medium text-gray-700">Drop your dataset here</p>
          <p className="text-sm text-gray-500 mt-1">CSV, Excel (.xlsx, .xls), or TXT — up to 10,000 rows sampled for training</p>
          <Button variant="outline" size="sm" className="mt-4">Browse Files</Button>
        </>
      )}
    </div>
  );

  // ============================================================
  // Metric Card
  // ============================================================

  const MetricCard = ({ label, value, unit, color = 'blue' }: { label: string; value: string | number; unit?: string; color?: string }) => (
    <div className={`p-4 rounded-lg bg-${color}-50 border border-${color}-200`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold text-${color}-700`}>
        {typeof value === 'number' ? value.toFixed(3) : value}
        {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
      </p>
    </div>
  );

  // ============================================================
  // Problem Definition Tab
  // ============================================================

  const ProblemDefinitionTab = () => {
    const det = pipelineState.problemDetection;
    const cols = dataset?.columns ?? [];
    const numericCols = cols.filter(c => c.type === 'number');

    return (
      <div className="space-y-6">
        {!dataset && <UploadZone />}

        {dataset && (
          <>
            {/* Dataset stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Rows" value={dataset.rowCount.toLocaleString()} color="blue" />
              <MetricCard label="Columns" value={dataset.columns.length} color="purple" />
              <MetricCard label="Numeric Cols" value={numericCols.length} color="green" />
              <MetricCard label="File" value={dataset.name.length > 15 ? dataset.name.slice(0, 15) + '…' : dataset.name} color="orange" />
            </div>

            {/* Plain-language data summary */}
            <Card className="border-emerald-200 bg-emerald-50">
              <CardHeader className="pb-2 pt-4 px-5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-sm font-semibold text-emerald-800">Data Summary</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-emerald-900 leading-relaxed">{buildDataSummary(dataset)}</p>
              </CardContent>
            </Card>

            {/* Detection result */}
            {det && (
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <Badge className={det.problemType === 'regression' ? 'bg-purple-600' : det.problemType === 'classification' ? 'bg-green-600' : 'bg-orange-500'}>
                      {det.problemType.charAt(0).toUpperCase() + det.problemType.slice(1)}
                    </Badge>
                    <Badge variant="outline">Confidence: {(det.confidence * 100).toFixed(0)}%</Badge>
                  </div>
                  <p className="text-sm text-gray-700">{det.reasoning}</p>
                </CardContent>
              </Card>
            )}

            {/* Config overrides */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1 block">Target Column</Label>
                <Select value={userConfig.targetColumn} onValueChange={v => setUserConfig(prev => ({ ...prev, targetColumn: v, selectedFeatures: prev.selectedFeatures.filter(f => f !== v) }))}>
                  <SelectTrigger><SelectValue placeholder="Select target..." /></SelectTrigger>
                  <SelectContent>
                    {cols.map(c => <SelectItem key={c.name} value={c.name}>{c.name} ({c.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Feature Columns</Label>
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-1">
                  {cols.filter(c => c.name !== userConfig.targetColumn).map(c => (
                    <label key={c.name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                      <Checkbox
                        checked={userConfig.selectedFeatures.includes(c.name)}
                        onCheckedChange={checked => {
                          setUserConfig(prev => ({
                            ...prev,
                            selectedFeatures: checked
                              ? [...prev.selectedFeatures, c.name]
                              : prev.selectedFeatures.filter(f => f !== c.name)
                          }));
                        }}
                      />
                      <span className="text-sm">{c.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">({c.type})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={runProblemDetection} className="bg-blue-600 hover:bg-blue-700">
                <BrainCircuit className="mr-2 h-4 w-4" /> Run Auto-Detection
              </Button>
              {det && (
                <Button onClick={() => { setActiveTab('preprocessing'); }} variant="outline">
                  Proceed to Preprocessing <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="mt-2">
              <Button variant="ghost" size="sm" onClick={() => { fileInputRef.current?.click(); }} className="text-gray-500">
                <Upload className="h-3 w-3 mr-1" /> Upload different file
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            </div>
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // Preprocessing Tab
  // ============================================================

  const PreprocessingTab = () => {
    const report = pipelineState.preprocessingReport;
    return (
      <div className="space-y-6">
        {!dataset && <Alert><AlertDescription>Upload a dataset in the Problem Definition step first.</AlertDescription></Alert>}
        {dataset && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="mb-1 block">Imputation Strategy</Label>
                <Select value={userConfig.imputeStrategy} onValueChange={v => setUserConfig(prev => ({ ...prev, imputeStrategy: v as PreprocessingStrategy }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mean_imputation">Mean (numeric)</SelectItem>
                    <SelectItem value="median_imputation">Median (numeric)</SelectItem>
                    <SelectItem value="mode_imputation">Mode (categorical)</SelectItem>
                    <SelectItem value="drop_rows">Drop missing rows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Feature Scaling</Label>
                <Select value={userConfig.scalingMethod} onValueChange={v => setUserConfig(prev => ({ ...prev, scalingMethod: v as ScalingMethod }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="z_score">Z-Score Standardization</SelectItem>
                    <SelectItem value="min_max">Min-Max Normalization</SelectItem>
                    <SelectItem value="none">No Scaling</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Train/Test Split: {(userConfig.trainTestSplit * 100).toFixed(0)}% / {((1 - userConfig.trainTestSplit) * 100).toFixed(0)}%</Label>
                <Slider
                  min={0.5} max={0.95} step={0.05}
                  value={[userConfig.trainTestSplit]}
                  onValueChange={([v]) => setUserConfig(prev => ({ ...prev, trainTestSplit: v }))}
                  className="mt-3"
                />
              </div>
            </div>

            <Button onClick={runPreprocessing} className="bg-blue-600 hover:bg-blue-700">
              <Settings className="mr-2 h-4 w-4" /> Run Preprocessing
            </Button>

            {report && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard label="Clean Rows" value={report.cleanedRows.toLocaleString()} color="green" />
                  <MetricCard label="Dropped Rows" value={report.droppedRows.toLocaleString()} color="red" />
                  <MetricCard label="Imputed Cells" value={report.imputedCells.toLocaleString()} color="yellow" />
                  <MetricCard label="Outliers Detected" value={report.outlierCount.toLocaleString()} color="orange" />
                </div>

                {report.encodedColumns.length > 0 && (
                  <Alert>
                    <AlertDescription>
                      Label-encoded {report.encodedColumns.length} categorical column(s): <strong>{report.encodedColumns.join(', ')}</strong>
                    </AlertDescription>
                  </Alert>
                )}

                {report.sampledFrom && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Dataset sampled from {report.sampledFrom.toLocaleString()} rows to {report.cleanedRows.toLocaleString()} rows for browser performance.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left p-2 border">Column</th>
                        <th className="text-right p-2 border">Missing Before</th>
                        <th className="text-right p-2 border">Missing After</th>
                        <th className="text-left p-2 border">Strategy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.columnStats.map(stat => (
                        <tr key={stat.column} className="hover:bg-gray-50">
                          <td className="p-2 border font-mono text-xs">{stat.column}</td>
                          <td className="p-2 border text-right">{stat.missingBefore}</td>
                          <td className="p-2 border text-right">{stat.missingAfter}</td>
                          <td className="p-2 border">
                            <Badge variant="outline" className="text-xs">{stat.strategy}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button onClick={() => setActiveTab('feature_engineering')} variant="outline">
                  Proceed to Feature Engineering <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // Feature Engineering Tab
  // ============================================================

  const FeatureEngineeringTab = () => {
    const result = pipelineState.featureEngineering;
    const allFeatures = pipelineState.cleanedDataset?.featureColumns ?? userConfig.selectedFeatures;

    return (
      <div className="space-y-6">
        {!pipelineState.cleanedDataset && (
          <Alert><AlertDescription>Complete preprocessing first to analyze features.</AlertDescription></Alert>
        )}

        {pipelineState.cleanedDataset && (
          <>
            <Button onClick={runFeatureEngineering} className="bg-blue-600 hover:bg-blue-700">
              <TrendingUp className="mr-2 h-4 w-4" /> Analyze Features
            </Button>

            {result && (
              <>
                <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">{result.dimensionalityNote}</p>

                {result.highCorrelationPairs.length > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Multicollinearity detected:</strong>{' '}
                      {result.highCorrelationPairs.map(p => `${p.col1} ↔ ${p.col2} (r=${p.r.toFixed(2)})`).join(', ')}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Feature importance chart */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Feature Importance (Correlation with Target)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={Math.max(200, result.featureImportance.length * 28)}>
                      <BarChart data={result.featureImportance} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" domain={[0, 1]} tickFormatter={v => v.toFixed(2)} />
                        <YAxis type="category" dataKey="feature" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => v.toFixed(3)} />
                        <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                          {result.featureImportance.map((entry, idx) => (
                            <Cell key={idx} fill={importanceColor(entry.importance)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Correlation matrix */}
                {result.correlationMatrix.length > 0 && result.correlationMatrix.length <= 100 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Correlation Matrix</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-auto">
                      <table className="text-xs border-collapse">
                        <thead>
                          <tr>
                            <th className="p-1 border"></th>
                            {allFeatures.slice(0, 10).map(f => (
                              <th key={f} className="p-1 border text-center" style={{ minWidth: 60 }}>{f.length > 8 ? f.slice(0, 8) + '…' : f}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {allFeatures.slice(0, 10).map(row => (
                            <tr key={row}>
                              <td className="p-1 border font-medium text-right pr-2" style={{ minWidth: 80 }}>{row.length > 8 ? row.slice(0, 8) + '…' : row}</td>
                              {allFeatures.slice(0, 10).map(col => {
                                const pair = result.correlationMatrix.find(p => (p.col1 === row && p.col2 === col) || (p.col1 === col && p.col2 === row));
                                const r = row === col ? 1 : (pair?.r ?? 0);
                                return (
                                  <td key={col} className="p-1 border text-center"
                                    style={{ backgroundColor: correlationColor(r), color: Math.abs(r) > 0.5 ? 'white' : 'black' }}>
                                    {r.toFixed(2)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {allFeatures.length > 10 && <p className="text-xs text-gray-400 mt-2">Showing first 10 features of {allFeatures.length}</p>}
                    </CardContent>
                  </Card>
                )}

                {/* Feature selection */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Recommended Features</CardTitle>
                    <CardDescription>Uncheck low-importance features before training</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {result.featureImportance.map(fi => (
                        <label key={fi.feature} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={userConfig.selectedFeatures.includes(fi.feature)}
                            onCheckedChange={checked => {
                              setUserConfig(prev => ({
                                ...prev,
                                selectedFeatures: checked
                                  ? [...prev.selectedFeatures, fi.feature]
                                  : prev.selectedFeatures.filter(f => f !== fi.feature)
                              }));
                            }}
                          />
                          <span className="text-sm">{fi.feature}</span>
                          <span className="text-xs ml-auto" style={{ color: importanceColor(fi.importance) }}>
                            {(fi.importance * 100).toFixed(0)}%
                          </span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Button onClick={() => setActiveTab('model_training')} variant="outline">
                  Proceed to Model Training <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // Model Training Tab
  // ============================================================

  const ModelTrainingTab = () => {
    const det = pipelineState.problemDetection;
    const comparison = pipelineState.modelComparison;
    const algosByType: Record<string, string[]> = {
      regression: ['linear_regression', 'decision_tree', 'random_forest'],
      classification: ['logistic_regression', 'decision_tree', 'random_forest'],
      clustering: ['k_means'],
    };
    const relevant = det ? (algosByType[det.problemType] ?? []) : [];

    return (
      <div className="space-y-6">
        {!pipelineState.cleanedDataset && (
          <Alert><AlertDescription>Complete preprocessing first.</AlertDescription></Alert>
        )}

        {pipelineState.cleanedDataset && (
          <>
            {/* Algorithm cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {relevant.map(algo => {
                const info = ALGORITHM_INFO[algo];
                return (
                  <Card key={algo} className="border-blue-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{info.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs text-gray-600">{info.desc}</p>
                      <p className="text-xs text-blue-600"><strong>Best when:</strong> {info.when}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {pipelineState.isRunning && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{pipelineState.progressMessage}</span>
                  <span>{pipelineState.progress}%</span>
                </div>
                <Progress value={pipelineState.progress} />
              </div>
            )}

            <Button
              onClick={runModelTraining}
              disabled={pipelineState.isRunning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {pipelineState.isRunning ? (
                <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Training...</>
              ) : (
                <><Cpu className="mr-2 h-4 w-4" /> Train All Models</>
              )}
            </Button>

            {comparison && (
              <>
                <div className="overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left p-3 border">Algorithm</th>
                        <th className="text-right p-3 border">{comparison.rankingMetric}</th>
                        <th className="text-right p-3 border">Secondary</th>
                        <th className="text-right p-3 border">Train Time</th>
                        <th className="text-center p-3 border">Rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.results.map(m => {
                        const primary = m.regressionMetrics?.rSquared ?? m.classificationMetrics?.accuracy ?? m.clusteringMetrics?.silhouetteScore ?? 0;
                        const secondary = m.regressionMetrics?.rmse ?? m.classificationMetrics?.f1 ?? m.clusteringMetrics?.optimalK ?? 0;
                        const secondLabel = m.regressionMetrics ? 'RMSE' : m.classificationMetrics ? 'F1' : 'K';

                        return (
                          <tr key={m.algorithm} className={`hover:bg-gray-50 ${m.isTopModel ? 'bg-green-50' : ''}`}>
                            <td className="p-3 border font-medium">
                              {m.algorithmLabel}
                              {m.isTopModel && <Badge className="ml-2 bg-green-600 text-xs">Best</Badge>}
                            </td>
                            <td className="p-3 border text-right font-mono">{primary.toFixed(4)}</td>
                            <td className="p-3 border text-right font-mono">
                              <span className="text-xs text-gray-500 mr-1">{secondLabel}</span>{secondary.toFixed(4)}
                            </td>
                            <td className="p-3 border text-right">{m.trainingDurationMs}ms</td>
                            <td className="p-3 border text-center">
                              <Button
                                size="sm" variant={pipelineState.selectedModel?.algorithm === m.algorithm ? 'default' : 'outline'}
                                onClick={() => setPipelineState(prev => ({ ...prev, selectedModel: m }))}
                                className="text-xs"
                              >
                                {pipelineState.selectedModel?.algorithm === m.algorithm ? 'Selected' : 'Select'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Button onClick={() => setActiveTab('evaluation')} variant="outline">
                  Proceed to Evaluation <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // Evaluation Tab
  // ============================================================

  const EvaluationTab = () => {
    const comparison = pipelineState.modelComparison;
    if (!comparison) return <Alert><AlertDescription>Train models first.</AlertDescription></Alert>;

    const evalModel = comparison.results.find(m => m.algorithm === selectedEvalModel) || comparison.bestModel;

    const isRegression = evalModel.problemType === 'regression';
    const isClassification = evalModel.problemType === 'classification';
    const isClustering = evalModel.problemType === 'clustering';

    return (
      <div className="space-y-6">
        {/* Model selector */}
        <div className="flex items-center gap-3">
          <Label>Evaluate Model:</Label>
          <Select value={selectedEvalModel} onValueChange={setSelectedEvalModel}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {comparison.results.map(m => (
                <SelectItem key={m.algorithm} value={m.algorithm}>{m.algorithmLabel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {evalModel.isTopModel && <Badge className="bg-green-600">Best Model</Badge>}
        </div>

        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">{evalModel.interpretation}</p>

        {isRegression && evalModel.regressionMetrics && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MetricCard label="R²" value={evalModel.regressionMetrics.rSquared} color="green" />
              <MetricCard label="Adj. R²" value={evalModel.regressionMetrics.adjustedRSquared} color="blue" />
              <MetricCard label="RMSE" value={evalModel.regressionMetrics.rmse} color="red" />
              <MetricCard label="MAE" value={evalModel.regressionMetrics.mae} color="orange" />
              <MetricCard label="MAPE" value={evalModel.regressionMetrics.mape} unit="%" color="purple" />
            </div>

            {evalModel.equation && (
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500 mb-1">Model Equation</p>
                  <code className="text-sm break-all">{evalModel.equation}</code>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {isClassification && evalModel.classificationMetrics && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Accuracy" value={(evalModel.classificationMetrics.accuracy * 100).toFixed(1)} unit="%" color="green" />
              <MetricCard label="Precision" value={evalModel.classificationMetrics.precision} color="blue" />
              <MetricCard label="Recall" value={evalModel.classificationMetrics.recall} color="orange" />
              <MetricCard label="F1 Score" value={evalModel.classificationMetrics.f1} color="purple" />
            </div>

            {/* Confusion Matrix */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Confusion Matrix</CardTitle>
                <CardDescription>Rows = Actual, Columns = Predicted</CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="p-2 border bg-gray-100">Actual \ Pred</th>
                      {evalModel.classificationMetrics.classLabels.map(l => (
                        <th key={l} className="p-2 border bg-gray-100 text-center">{l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {evalModel.classificationMetrics.confusionMatrix.map((row, ri) => (
                      <tr key={ri}>
                        <td className="p-2 border font-medium bg-gray-50">{evalModel.classificationMetrics!.classLabels[ri]}</td>
                        {row.map((val, ci) => (
                          <td key={ci} className="p-2 border text-center font-mono text-sm"
                            style={{
                              backgroundColor: ri === ci ? `rgba(34, 197, 94, ${Math.min(0.8, val / Math.max(...row, 1))})` : `rgba(239, 68, 68, ${Math.min(0.6, val / Math.max(...row, 1))})`,
                              color: val > 0 ? 'white' : 'black'
                            }}>
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        {isClustering && evalModel.clusteringMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Silhouette Score" value={evalModel.clusteringMetrics.silhouetteScore} color="green" />
            <MetricCard label="Optimal K" value={evalModel.clusteringMetrics.optimalK} color="blue" />
            <MetricCard label="Inertia" value={evalModel.clusteringMetrics.inertia.toFixed(1)} color="orange" />
            <MetricCard label="Davies-Bouldin" value={evalModel.clusteringMetrics.daviesBouldinIndex} color="purple" />
          </div>
        )}

        {/* Feature importance */}
        {evalModel.featureImportance.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Feature Importance (this model)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(150, evalModel.featureImportance.length * 26)}>
                <BarChart data={evalModel.featureImportance} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 1]} tickFormatter={v => v.toFixed(2)} />
                  <YAxis type="category" dataKey="feature" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => v.toFixed(3)} />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {evalModel.featureImportance.map((entry, idx) => (
                      <Cell key={idx} fill={importanceColor(entry.importance)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Button onClick={() => setActiveTab('deployment')} variant="outline">
          Proceed to Deployment <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    );
  };

  // ============================================================
  // Deployment Tab
  // ============================================================

  const DeploymentTab = () => {
    const guidance = pipelineState.deploymentGuidance;
    const model = pipelineState.selectedModel;

    return (
      <div className="space-y-6">
        {!model && <Alert><AlertDescription>Train and select a model first.</AlertDescription></Alert>}

        {model && (
          <>
            <Button onClick={generateDeployment} className="bg-blue-600 hover:bg-blue-700">
              <Rocket className="mr-2 h-4 w-4" /> Generate Deployment Plan
            </Button>

            {guidance && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-gray-500">Recommended Platform</p>
                      <p className="font-semibold text-sm mt-1">{guidance.recommendedPlatform}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-gray-500">Export Format</p>
                      <p className="font-semibold text-sm mt-1">JSON Config</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-gray-500">Estimated Inference</p>
                      <p className="font-semibold text-sm mt-1">{guidance.estimatedInferenceMs}ms per prediction</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Model JSON export */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Exported Model Config</CardTitle>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(JSON.stringify(guidance.exportedModelConfig, null, 2))}>
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={downloadModelConfig}>
                          <Download className="h-3 w-3 mr-1" /> Download JSON
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto max-h-64 font-mono">
                      {JSON.stringify(guidance.exportedModelConfig, null, 2)}
                    </pre>
                  </CardContent>
                </Card>

                {/* API endpoint template */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">REST API Endpoint Template</CardTitle>
                      <Button size="sm" variant="outline" onClick={() => copyToClipboard(guidance.apiEndpointTemplate)}>
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-gray-900 text-blue-300 p-4 rounded-lg overflow-auto font-mono whitespace-pre-wrap">
                      {guidance.apiEndpointTemplate}
                    </pre>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500" /> Monitoring Recommendations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {guidance.monitoringRecommendations.map((rec, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <Circle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 text-blue-500" /> Retraining Triggers
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {guidance.retrainingTriggers.map((trigger, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <Circle className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                            <span>{trigger}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================================
  // Plain-language interpretation helpers
  // ============================================================

  const confidenceLabel = (c: number): { word: string; color: string; bg: string } => {
    if (c >= 0.85) return { word: 'Very High', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
    if (c >= 0.70) return { word: 'High',      color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-200'  };
    if (c >= 0.55) return { word: 'Moderate',  color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' };
    return           { word: 'Low',       color: 'text-red-700',   bg: 'bg-red-50 border-red-200'   };
  };

  const buildPlainReport = (
    result: PredictionResult,
    model: ModelResult,
    targetCol: string,
    inputs: Record<string, string>
  ): string => {
    const isNumericPred = typeof result.predictedValue === 'number';
    const predDisplay = isNumericPred
      ? Number(result.predictedValue).toFixed(2)
      : String(result.predictedValue);
    const confPct = Math.round(result.confidence * 100);

    // Sort contributions for narrative
    const sorted = [...result.featureContributions]
      .sort((a, b) => b.contribution - a.contribution);
    const topPos = sorted.filter(f => f.direction === 'positive').slice(0, 2);
    const topNeg = sorted.filter(f => f.direction === 'negative').slice(0, 2);

    // Opening sentence
    let report = `Based on the data you entered, the model predicts a ${targetCol} of ${predDisplay}. `;

    // Confidence sentence
    if (confPct >= 85) {
      report += `The model is very confident in this result (${confPct}%), meaning it has seen many similar cases in the training data and the outcome is likely to be close to this figure. `;
    } else if (confPct >= 70) {
      report += `The model has high confidence in this result (${confPct}%), so this prediction is a reliable guide for decision-making, though some variation is possible. `;
    } else if (confPct >= 55) {
      report += `The model has moderate confidence (${confPct}%). This prediction is a useful starting point but should be treated as indicative rather than definitive — consider gathering more data or validating with domain knowledge. `;
    } else {
      report += `The model's confidence is relatively low (${confPct}%). This can happen when the input values are unusual compared to the training data. Use this prediction carefully and seek additional validation. `;
    }

    // Confidence interval sentence
    if (result.confidenceInterval) {
      const lo = result.confidenceInterval.lower.toFixed(2);
      const hi = result.confidenceInterval.upper.toFixed(2);
      report += `There is a 95% chance the true value falls between ${lo} and ${hi}. `;
    }

    // Driving factors — positive
    if (topPos.length > 0) {
      const factors = topPos.map(f => `"${f.feature}" (value: ${inputs[f.feature] ?? '—'})`).join(' and ');
      report += `The factors pushing this prediction higher are ${factors}. `;
    }

    // Driving factors — negative
    if (topNeg.length > 0) {
      const factors = topNeg.map(f => `"${f.feature}" (value: ${inputs[f.feature] ?? '—'})`).join(' and ');
      report += `The factors pulling it lower are ${factors}. `;
    }

    // Algorithm note — plain English
    const algoNotes: Record<string, string> = {
      linear_regression:   'Linear Regression assumes the outcome changes at a steady rate as each factor changes — straightforward and easy to audit.',
      logistic_regression: 'Logistic Regression evaluates the probability of each category and picks the most likely one.',
      decision_tree:       'Decision Tree follows a set of if-then rules learned from your data to arrive at its answer.',
      random_forest:       'Random Forest combines many decision trees and takes a majority vote, which typically improves reliability.',
      k_means:             'K-Means Clustering groups your input into the most similar cluster found during training.',
    };
    report += `This result was produced by ${model.algorithmLabel}. ${algoNotes[model.algorithm] ?? ''} `;

    // Performance note
    if (model.regressionMetrics) {
      const r2Pct = Math.round(model.regressionMetrics.rSquared * 100);
      report += `On the test data, the model explained ${r2Pct}% of the variation in ${targetCol}, with an average error of ±${model.regressionMetrics.rmse.toFixed(2)}. `;
      if (r2Pct >= 80) report += 'That is a strong fit — predictions are generally reliable. ';
      else if (r2Pct >= 60) report += 'That is a reasonable fit for most business purposes. ';
      else report += 'The fit is moderate; consider enriching your dataset for more accuracy. ';
    } else if (model.classificationMetrics) {
      const accPct = Math.round(model.classificationMetrics.accuracy * 100);
      report += `On the test data, the model correctly classified ${accPct}% of cases. `;
      if (accPct >= 85) report += 'This is a strong accuracy level for decision support. ';
      else if (accPct >= 70) report += 'This is a reasonable accuracy level — review borderline cases carefully. ';
      else report += 'Accuracy is moderate; treat this as one input among several. ';
    }

    report += 'Use this prediction as a data-driven input to your decision — combining it with your team\'s experience and any external factors not captured in the dataset will produce the best outcome.';
    return report;
  };

  // ============================================================
  // Decision advisory builder — outcome-driven, plain language
  // ============================================================

  interface DecisionAdvice {
    verdict: string;               // one-line headline telling the decision maker what happened
    verdictColor: string;          // Tailwind text colour class
    verdictBg: string;             // Tailwind bg + border colour for the verdict chip
    immediateActions: string[];    // what to do right now, using the actual predicted value & factors
    watchPoints: string[];         // what to monitor going forward
    revisitTriggers: string[];     // when to re-run this analysis
    overallReadiness: 'proceed' | 'proceed-with-caution' | 'hold-and-investigate';
  }

  const buildDecisionAdvice = (
    result: PredictionResult,
    model: ModelResult,
    targetCol: string,
    inputs: Record<string, string>
  ): DecisionAdvice => {
    const confPct  = Math.round(result.confidence * 100);
    const isHigh   = confPct >= 70;
    const isMod    = confPct >= 55 && confPct < 70;
    const isLow    = confPct < 55;

    const predNum  = typeof result.predictedValue === 'number' ? result.predictedValue : null;
    const predStr  = typeof result.predictedValue === 'number'
      ? Number(result.predictedValue).toFixed(2)
      : String(result.predictedValue);

    // Sort factors
    const sorted  = [...result.featureContributions].sort((a, b) => b.contribution - a.contribution);
    const topPos  = sorted.filter(f => f.direction === 'positive').slice(0, 2);
    const topNeg  = sorted.filter(f => f.direction === 'negative').slice(0, 2);
    const topFactor = sorted[0];

    // ── Regression path ─────────────────────────────────────────
    if (model.regressionMetrics) {
      const rmse  = model.regressionMetrics.rmse;
      const r2Pct = Math.round(model.regressionMetrics.rSquared * 100);
      const lo    = result.confidenceInterval ? result.confidenceInterval.lower.toFixed(2) : null;
      const hi    = result.confidenceInterval ? result.confidenceInterval.upper.toFixed(2) : null;
      const rangeNote = lo && hi ? ` (likely between ${lo} and ${hi})` : '';

      // Determine verdict based on confidence + model accuracy
      let verdict: string;
      let verdictColor: string;
      let verdictBg: string;
      let readiness: DecisionAdvice['overallReadiness'];

      if (isHigh && r2Pct >= 70) {
        verdict      = `Proceed — the model reliably predicts ${targetCol} at ${predStr}${rangeNote}.`;
        verdictColor = 'text-green-800';
        verdictBg    = 'bg-green-100 border-green-300';
        readiness    = 'proceed';
      } else if (isMod || (isHigh && r2Pct < 70)) {
        verdict      = `Proceed with caution — ${targetCol} is estimated at ${predStr}${rangeNote}, but verify before committing.`;
        verdictColor = 'text-amber-800';
        verdictBg    = 'bg-amber-100 border-amber-300';
        readiness    = 'proceed-with-caution';
      } else {
        verdict      = `Hold — confidence is low (${confPct}%). Gather more data before acting on ${predStr}.`;
        verdictColor = 'text-red-800';
        verdictBg    = 'bg-red-100 border-red-300';
        readiness    = 'hold-and-investigate';
      }

      // Immediate actions
      const actions: string[] = [];
      actions.push(
        `Use ${predStr} as your planning baseline for ${targetCol}${rangeNote}. ` +
        `The model's average error is ±${rmse.toFixed(2)}, so build a buffer of at least that amount into any budget or schedule.`
      );
      if (topPos.length > 0) {
        const fList = topPos.map(f => `"${f.feature}" (currently ${inputs[f.feature] ?? 'not set'})`).join(' and ');
        actions.push(
          `Protect and reinforce the factors most responsible for this outcome: ${fList}. ` +
          `These are your strongest performance levers — any deterioration here will directly reduce ${targetCol}.`
        );
      }
      if (topNeg.length > 0) {
        const fList = topNeg.map(f => `"${f.feature}" (currently ${inputs[f.feature] ?? 'not set'})`).join(' and ');
        actions.push(
          `Address the factors currently holding the result back: ${fList}. ` +
          `Improving these values is the fastest route to a higher ${targetCol}.`
        );
      }
      if (isLow) {
        actions.push(
          `Before making significant decisions, validate this prediction against at least 2–3 real recent observations ` +
          `where you already know the actual ${targetCol} — this will tell you how reliable the model is for your specific context.`
        );
      }

      // Watch points
      const watches: string[] = [
        `Track actual ${targetCol} against the predicted ${predStr} over the next reporting period and note the gap.`,
      ];
      if (topFactor) {
        watches.push(
          `Monitor "${topFactor.feature}" closely — it carries the most weight in this prediction. ` +
          `A significant change here will move ${targetCol} more than any other factor.`
        );
      }
      if (result.confidenceInterval) {
        watches.push(
          `If the actual ${targetCol} consistently falls outside the range ${lo}–${hi}, ` +
          `it is a signal that conditions have shifted and the model needs retraining.`
        );
      }

      // Revisit triggers
      const revisits: string[] = [
        `Retrain when actual ${targetCol} differs from predictions by more than ${(rmse * 2).toFixed(2)} for three or more consecutive periods.`,
        `Re-run this prediction whenever any key input changes by more than 10% from today's values.`,
        `Review the model after adding new data sources or if business conditions change materially.`,
      ];

      return { verdict, verdictColor, verdictBg, immediateActions: actions, watchPoints: watches, revisitTriggers: revisits, overallReadiness: readiness };
    }

    // ── Classification path ─────────────────────────────────────
    if (model.classificationMetrics) {
      const accPct    = Math.round(model.classificationMetrics.accuracy * 100);
      const predClass = String(result.predictedValue);

      let verdict: string;
      let verdictColor: string;
      let verdictBg: string;
      let readiness: DecisionAdvice['overallReadiness'];

      if (isHigh && accPct >= 75) {
        verdict      = `Proceed — the model classifies this case as "${predClass}" with ${confPct}% confidence.`;
        verdictColor = 'text-green-800';
        verdictBg    = 'bg-green-100 border-green-300';
        readiness    = 'proceed';
      } else if (isMod || (isHigh && accPct < 75)) {
        verdict      = `Proceed with caution — classified as "${predClass}", but confidence (${confPct}%) warrants a manual review.`;
        verdictColor = 'text-amber-800';
        verdictBg    = 'bg-amber-100 border-amber-300';
        readiness    = 'proceed-with-caution';
      } else {
        verdict      = `Hold — low confidence (${confPct}%) in the "${predClass}" classification. Do not act without further investigation.`;
        verdictColor = 'text-red-800';
        verdictBg    = 'bg-red-100 border-red-300';
        readiness    = 'hold-and-investigate';
      }

      const actions: string[] = [];
      actions.push(
        `The model has labelled this case as "${predClass}". ` +
        `Apply the processes, policies, or responses your organisation has defined for the "${predClass}" category.`
      );
      if (topPos.length > 0) {
        const fList = topPos.map(f => `"${f.feature}" = ${inputs[f.feature] ?? '—'}`).join(' and ');
        actions.push(
          `This classification is primarily driven by ${fList}. ` +
          `If any of these values are incorrect or have changed, re-run the prediction with the updated figures before acting.`
        );
      }
      if (isLow || isMod) {
        actions.push(
          `Because confidence is below 70%, escalate this case to a human reviewer before finalising a decision. ` +
          `The model is less certain here than usual — a second opinion will reduce risk.`
        );
      }
      if (accPct < 75) {
        actions.push(
          `The model's overall accuracy on test data was ${accPct}%. Treat this prediction as a screening tool ` +
          `rather than a definitive verdict, and back it up with manual checks where stakes are high.`
        );
      }

      const watches: string[] = [
        `Record the actual outcome for this case once it is known and compare it to the "${predClass}" prediction.`,
      ];
      if (topFactor) {
        watches.push(
          `"${topFactor.feature}" is the dominant factor in this classification. ` +
          `If that value changes, re-run the prediction — the classification may change.`
        );
      }
      watches.push(
        `Watch the model's false-positive and false-negative rate over the next 30 days ` +
        `by tracking how many "${predClass}" predictions turn out to be incorrect.`
      );

      const revisits: string[] = [
        `Re-run this analysis whenever the key input values change materially.`,
        `Retrain the model if accuracy on live cases drops below ${Math.max(accPct - 10, 60)}%.`,
        `Schedule a full model review every quarter or whenever a new category is added to ${targetCol}.`,
      ];

      return { verdict, verdictColor, verdictBg, immediateActions: actions, watchPoints: watches, revisitTriggers: revisits, overallReadiness: readiness };
    }

    // ── Clustering path ─────────────────────────────────────────
    const clusterLabel = String(result.predictedValue);
    const sScore = model.clusteringMetrics?.silhouetteScore ?? 0;
    const clusterQuality = sScore >= 0.5 ? 'well-separated' : sScore >= 0.25 ? 'moderately distinct' : 'overlapping';

    const actions: string[] = [
      `This data point belongs to ${clusterLabel}. Apply the strategy, pricing tier, or service level your organisation has mapped to this cluster.`,
    ];
    if (topPos.length > 0) {
      const fList = topPos.map(f => `"${f.feature}" = ${inputs[f.feature] ?? '—'}`).join(' and ');
      actions.push(`The features that most define membership in this cluster are ${fList}. Use these as the primary filters when targeting or segmenting this group.`);
    }
    actions.push(`Run this prediction for multiple similar cases to confirm that ${clusterLabel} is consistently assigned — this validates that the segment is stable.`);

    return {
      verdict:          `This case is assigned to ${clusterLabel}. Clusters are ${clusterQuality} (silhouette score: ${sScore.toFixed(2)}).`,
      verdictColor:     sScore >= 0.4 ? 'text-green-800' : 'text-amber-800',
      verdictBg:        sScore >= 0.4 ? 'bg-green-100 border-green-300' : 'bg-amber-100 border-amber-300',
      immediateActions: actions,
      watchPoints:      [
        `Check whether cases you expect to be similar also land in ${clusterLabel}. Outliers may indicate data quality issues.`,
        `Monitor cluster membership over time — if the same entity moves between clusters, it signals a genuine behavioural shift worth investigating.`,
      ],
      revisitTriggers:  [
        `Re-cluster when the dataset grows by 20% or more, as new data can shift cluster boundaries.`,
        `Retrain if the silhouette score drops below 0.20 — clusters are no longer meaningful at that point.`,
      ],
      overallReadiness: sScore >= 0.4 ? 'proceed' : 'proceed-with-caution',
    };
  };

  // ============================================================
  // Prediction Panel
  // ============================================================

  const PredictionPanel = () => {
    const model = pipelineState.selectedModel;
    const cleanedDS = pipelineState.cleanedDataset;
    if (!model || !cleanedDS) return null;

    const features = cleanedDS.featureColumns;
    const conf = predictionResult ? confidenceLabel(predictionResult.confidence) : null;
    const plainReport = predictionResult
      ? buildPlainReport(predictionResult, model, cleanedDS.targetColumn, predictionInputs)
      : null;
    const advice = predictionResult
      ? buildDecisionAdvice(predictionResult, model, cleanedDS.targetColumn, predictionInputs)
      : null;

    const downloadPredictionResult = (format: 'txt' | 'json') => {
      if (!predictionResult || !plainReport || !advice) return;

      const timestamp = new Date().toISOString();
      const safeTarget = String(cleanedDS.targetColumn || 'result')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const filenameBase = `ml-prediction-${safeTarget || 'result'}-${Date.now()}`;

      const metrics: Record<string, number> = {};
      if (model.regressionMetrics) {
        metrics.r_squared = model.regressionMetrics.rSquared;
        metrics.adjusted_r_squared = model.regressionMetrics.adjustedRSquared;
        metrics.rmse = model.regressionMetrics.rmse;
        metrics.mae = model.regressionMetrics.mae;
        metrics.mape = model.regressionMetrics.mape;
      } else if (model.classificationMetrics) {
        metrics.accuracy = model.classificationMetrics.accuracy;
        metrics.precision = model.classificationMetrics.precision;
        metrics.recall = model.classificationMetrics.recall;
        metrics.f1 = model.classificationMetrics.f1;
      } else if (model.clusteringMetrics) {
        metrics.silhouette_score = model.clusteringMetrics.silhouetteScore;
        metrics.optimal_k = model.clusteringMetrics.optimalK;
        metrics.inertia = model.clusteringMetrics.inertia;
        metrics.davies_bouldin_index = model.clusteringMetrics.daviesBouldinIndex;
      }

      const exportPayload = {
        generated_at: timestamp,
        target_column: cleanedDS.targetColumn,
        model: {
          algorithm: model.algorithm,
          algorithm_label: model.algorithmLabel,
          problem_type: model.problemType,
          metrics,
        },
        input_values: predictionInputs,
        prediction: {
          value: predictionResult.predictedValue,
          confidence: predictionResult.confidence,
          confidence_interval: predictionResult.confidenceInterval || null,
          feature_contributions: predictionResult.featureContributions,
        },
        plain_language_report: plainReport,
        decision_advisory: advice,
      };

      const textBody = [
        `ML Prediction Result (${timestamp})`,
        `Target: ${cleanedDS.targetColumn}`,
        `Model: ${model.algorithmLabel} (${model.algorithm})`,
        `Problem Type: ${model.problemType}`,
        '',
        `Predicted Value: ${String(predictionResult.predictedValue)}`,
        `Confidence: ${(predictionResult.confidence * 100).toFixed(1)}%`,
        predictionResult.confidenceInterval
          ? `Confidence Interval: ${predictionResult.confidenceInterval.lower.toFixed(2)} - ${predictionResult.confidenceInterval.upper.toFixed(2)}`
          : 'Confidence Interval: n/a',
        '',
        'Inputs',
        ...Object.entries(predictionInputs).map(([key, value]) => `- ${key}: ${value}`),
        '',
        'Plain Language Report',
        plainReport,
        '',
        'Decision Advisory',
        `- Verdict: ${advice.verdict}`,
        `- Readiness: ${advice.overallReadiness}`,
        ...advice.immediateActions.map((item) => `- Act Now: ${item}`),
        ...advice.watchPoints.map((item) => `- Monitor: ${item}`),
        ...advice.revisitTriggers.map((item) => `- Revisit: ${item}`),
      ].join('\n');

      const blob =
        format === 'json'
          ? new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
          : new Blob([textBody], { type: 'text/plain;charset=utf-8' });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filenameBase}.${format === 'json' ? 'json' : 'txt'}`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success(`Prediction ${format.toUpperCase()} downloaded.`);
    };

    return (
      <Card className="mt-8 border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600" />
            Live Prediction Panel
            <Badge className="ml-2 bg-blue-600">{model.algorithmLabel}</Badge>
          </CardTitle>
          <CardDescription>
            Fill in the fields below and click <strong>Generate Prediction</strong>. The engine will predict the outcome and explain it in plain language.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Input fields */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            {features.map(feature => {
              const isCategoric = !!cleanedDS.labelMappings[feature];
              const labelOptions = isCategoric ? Object.keys(cleanedDS.labelMappings[feature]) : [];
              return (
                <div key={feature}>
                  <Label className="text-xs mb-1 block truncate font-medium" title={feature}>{feature}</Label>
                  {isCategoric ? (
                    <Select
                      value={predictionInputs[feature] || ''}
                      onValueChange={v => setPredictionInputs(prev => ({ ...prev, [feature]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {labelOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="number"
                      className="h-8 text-sm"
                      placeholder="0"
                      value={predictionInputs[feature] || ''}
                      onChange={e => setPredictionInputs(prev => ({ ...prev, [feature]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <Button
            onClick={handlePredict}
            className="w-full md:w-auto bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Zap className="mr-2 h-4 w-4" /> Generate Prediction
          </Button>

          {predictionResult && conf && plainReport && advice && (
            <>
              <Separator className="my-6" />

              <div className="mb-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadPredictionResult('txt')}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Summary
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadPredictionResult('json')}>
                  <Download className="mr-2 h-4 w-4" />
                  Download JSON
                </Button>
              </div>

              {/* ── Row 1: Predicted value + confidence badge ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* Big result */}
                <div className="md:col-span-2 flex flex-col items-center justify-center text-center p-6 bg-white rounded-xl border-2 border-green-200 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                    Predicted · {cleanedDS.targetColumn}
                  </p>
                  <p className="text-5xl font-extrabold text-green-700 leading-none">
                    {typeof predictionResult.predictedValue === 'number'
                      ? Number(predictionResult.predictedValue).toFixed(2)
                      : predictionResult.predictedValue}
                  </p>
                  {predictionResult.confidenceInterval && (
                    <p className="text-xs text-gray-400 mt-2">
                      Likely range: {predictionResult.confidenceInterval.lower.toFixed(2)} — {predictionResult.confidenceInterval.upper.toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Confidence */}
                <div className={`flex flex-col items-center justify-center p-5 rounded-xl border-2 ${conf.bg}`}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Confidence</p>
                  <p className={`text-4xl font-extrabold ${conf.color}`}>
                    {Math.round(predictionResult.confidence * 100)}%
                  </p>
                  <p className={`text-sm font-semibold mt-1 ${conf.color}`}>{conf.word}</p>
                  <Progress value={predictionResult.confidence * 100} className="mt-3 h-2 w-full" />
                </div>
              </div>

              {/* ── Row 2: Plain-language report ── */}
              <div className="mb-6 rounded-xl border border-blue-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600">
                  <BrainCircuit className="h-4 w-4 text-white" />
                  <p className="text-sm font-semibold text-white">What does this mean? — Plain Language Report</p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">{plainReport}</p>
                </div>
              </div>

              {/* ── Row 3: Key factors driving this prediction ── */}
              {predictionResult.featureContributions.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-semibold text-gray-700 mb-1">Key factors driving this prediction</p>
                  <p className="text-xs text-gray-500 mb-3">
                    <span className="inline-block w-3 h-3 rounded-sm bg-green-500 mr-1 align-middle" />Green = pushes prediction up &nbsp;
                    <span className="inline-block w-3 h-3 rounded-sm bg-red-400 mr-1 align-middle" />Red = pulls prediction down
                  </p>

                  {/* Visual factor bars — plain language labels */}
                  <div className="space-y-2">
                    {[...predictionResult.featureContributions]
                      .sort((a, b) => b.contribution - a.contribution)
                      .slice(0, 8)
                      .map((fc, idx) => {
                        const maxC = Math.max(...predictionResult.featureContributions.map(f => f.contribution), 0.001);
                        const pct = Math.round((fc.contribution / maxC) * 100);
                        const isPos = fc.direction === 'positive';
                        return (
                          <div key={idx} className="flex items-center gap-3">
                            <span className="text-xs text-gray-600 w-32 truncate shrink-0" title={fc.feature}>{fc.feature}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${isPos ? 'bg-green-500' : 'bg-red-400'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold w-20 text-right shrink-0 ${isPos ? 'text-green-600' : 'text-red-500'}`}>
                              {isPos ? '▲ raises' : '▼ lowers'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* ── Row 4: Decision Advisory ── */}
              <div className="rounded-xl border-2 overflow-hidden shadow-sm">
                {/* Header with overall verdict */}
                <div className="px-5 py-4 bg-gray-900 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Readiness icon */}
                    {advice.overallReadiness === 'proceed' && (
                      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-white" />
                      </div>
                    )}
                    {advice.overallReadiness === 'proceed-with-caution' && (
                      <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
                        <AlertTriangle className="h-5 w-5 text-white" />
                      </div>
                    )}
                    {advice.overallReadiness === 'hold-and-investigate' && (
                      <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                        <Circle className="h-5 w-5 text-white" />
                      </div>
                    )}
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Decision Advisory</p>
                  </div>
                  <div className={`flex-1 px-3 py-2 rounded-lg border text-sm font-semibold leading-snug ${advice.verdictColor} ${advice.verdictBg}`}>
                    {advice.verdict}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                  {/* Column 1 — Immediate actions */}
                  <div className="p-4 bg-white">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1">
                      <Zap className="h-3 w-3 text-blue-500" /> Act Now
                    </p>
                    <ul className="space-y-3">
                      {advice.immediateActions.map((action, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Column 2 — Watch points */}
                  <div className="p-4 bg-gray-50">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-purple-500" /> Monitor
                    </p>
                    <ul className="space-y-3">
                      {advice.watchPoints.map((watch, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                          <span className="text-purple-400 shrink-0 mt-0.5">◉</span>
                          <span>{watch}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Column 3 — When to revisit */}
                  <div className="p-4 bg-white">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1">
                      <RefreshCw className="h-3 w-3 text-amber-500" /> Revisit When
                    </p>
                    <ul className="space-y-3">
                      {advice.revisitTriggers.map((trigger, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                          <span className="text-amber-400 shrink-0 mt-0.5">⟳</span>
                          <span>{trigger}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Footer note */}
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    This advisory is generated from the model's prediction, confidence level, feature contributions, and performance on test data.
                    It is intended to support — not replace — human judgement. Always combine data-driven insight with operational knowledge.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
            <BrainCircuit className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">ML Engine</h1>
            <p className="text-gray-500 text-sm">Complete machine learning pipeline — runs entirely in your browser</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="outline" className="text-xs">Auto Problem Detection</Badge>
          <Badge variant="outline" className="text-xs">Data Preprocessing</Badge>
          <Badge variant="outline" className="text-xs">Feature Engineering</Badge>
          <Badge variant="outline" className="text-xs">Model Training</Badge>
          <Badge variant="outline" className="text-xs">Evaluation & Testing</Badge>
          <Badge variant="outline" className="text-xs">Deployment Guidance</Badge>
          <Badge variant="outline" className="text-xs">Live Predictions</Badge>
        </div>
      </div>

      {/* Stepper */}
      <StepStepper />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as MLPipelineStep)}>
        <TabsList className="grid grid-cols-3 md:grid-cols-6 mb-6 h-auto">
          {PIPELINE_STEPS.map(step => (
            <TabsTrigger key={step.key} value={step.key} className="flex items-center gap-1 text-xs py-2">
              {step.icon}
              <span className="hidden sm:inline">{step.label.split(' ')[0]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="problem_definition">
          <ProblemDefinitionTab />
        </TabsContent>
        <TabsContent value="preprocessing">
          <PreprocessingTab />
        </TabsContent>
        <TabsContent value="feature_engineering">
          <FeatureEngineeringTab />
        </TabsContent>
        <TabsContent value="model_training">
          <ModelTrainingTab />
        </TabsContent>
        <TabsContent value="evaluation">
          <EvaluationTab />
        </TabsContent>
        <TabsContent value="deployment">
          <DeploymentTab />
        </TabsContent>
      </Tabs>

      {/* Live Prediction Panel */}
      <PredictionPanel />
    </div>
  );
};

export default MLEngineDashboard;
