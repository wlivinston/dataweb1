// AI-Powered Insights Panel - One-click analysis with executive summaries
// Makes data analysis accessible to everyone regardless of technical background

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Lightbulb, BarChart3, Link2, Zap, RefreshCw, ChevronRight,
  ArrowUp, ArrowDown, Minus, Target, Eye, Sparkles, Clock,
  MoreVertical, Trash2, ArrowLeftRight, Calculator, Wrench
} from 'lucide-react';
import { Dataset } from '@/lib/types';
import { 
  runAIAnalysis,
  runAIAnalysisAsync,
  AIInsightSummary, 
  CorrelationResult, 
  TrendResult, 
  AnomalyResult, 
  PatternResult,
  getQuickInsights
} from '@/lib/aiInsightEngine';
import { 
  executeAutoCleaning,
  executeAutoCleaningAsync,
  createCleaningPlan,
  quickFixRecommendation 
} from '@/lib/autoDataCleaning';
import { updateDatasetStats } from '@/lib/dataUtils';
import {
  fixSingleAnomaly,
  fixAnomaliesInColumn,
  fixAllAnomalies,
  AnomalyFixAction,
  getFixDescription
} from '@/lib/anomalyFixUtils';
import DataProcessingOverlay from './DataProcessingOverlay';
import { toast } from 'sonner';

interface AIInsightsPanelProps {
  dataset: Dataset | null;
  onInsightsGenerated?: (insights: AIInsightSummary) => void;
  onDatasetUpdate?: (dataset: Dataset) => void;
}

const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({ 
  dataset, 
  onInsightsGenerated,
  onDatasetUpdate
}) => {
  const [insights, setInsights] = useState<AIInsightSummary | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [cleaningPlan, setCleaningPlan] = useState<any>(null);
  // Loading overlay states
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStage, setOverlayStage] = useState<'uploading' | 'parsing' | 'analyzing' | 'processing' | 'complete'>('analyzing');
  const [overlayProgress, setOverlayProgress] = useState(0);
  const [overlayMessage, setOverlayMessage] = useState<string>('');
  
  // Helper to yield control to browser
  const yieldToBrowser = (): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, 0));
  };

  const runAnalysis = async () => {
    if (!dataset) {
      toast.error('Please select a dataset first');
      return;
    }

    setIsAnalyzing(true);
    setShowOverlay(true);
    setOverlayStage('analyzing');
    setOverlayProgress(0);
    setOverlayMessage('Initializing AI analysis...');

    try {
      await yieldToBrowser();
      
      // Run analysis with progress callbacks
      const result = await runAIAnalysisAsync(
        dataset,
        (progress, message) => {
          setOverlayProgress(progress);
          setOverlayMessage(message);
        }
      );
      
      setOverlayProgress(100);
      setOverlayStage('complete');
      setOverlayMessage('Analysis complete!');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setInsights(result);
      onInsightsGenerated?.(result);
      toast.success(`Analysis complete! Found ${result.totalInsights} insights.`);
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to analyze data. Please try again.');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => {
        setShowOverlay(false);
        setOverlayProgress(0);
        setOverlayStage('analyzing');
        setOverlayMessage('');
      }, 1000);
    }
  };

  // Auto-run quick insights when dataset changes
  useEffect(() => {
    if (dataset && !insights) {
      const quickInsights = getQuickInsights(dataset);
      // We could show quick insights immediately while full analysis runs
    }
    
    // Create cleaning plan when dataset or insights change
    if (dataset && insights) {
      const plan = createCleaningPlan(dataset, insights);
      setCleaningPlan(plan);
    }
  }, [dataset, insights]);
  
  const handleQuickFix = async (recommendation: string) => {
    if (!dataset) return;
    
    setIsCleaning(true);
    setShowOverlay(true);
    setOverlayStage('processing');
    setOverlayProgress(0);
    setOverlayMessage('Applying fix...');

    try {
      await yieldToBrowser();
      
      setOverlayProgress(30);
      setOverlayMessage('Processing recommendation...');
      await yieldToBrowser();
      
      const result = quickFixRecommendation(dataset, recommendation);
      if (result) {
        setOverlayProgress(60);
        setOverlayMessage('Updating dataset...');
        await yieldToBrowser();
        
        const updatedDataset = updateDatasetStats(result.dataset);
        onDatasetUpdate?.(updatedDataset);
        
        setOverlayProgress(80);
        setOverlayMessage('Re-analyzing data...');
        await yieldToBrowser();
        
        // Re-run analysis to update insights
        const newInsights = await runAIAnalysisAsync(updatedDataset, (progress, msg) => {
          setOverlayProgress(80 + (progress * 0.15)); // 80-95% range
          setOverlayMessage(msg);
        });
        setInsights(newInsights);
        
        setOverlayProgress(100);
        setOverlayStage('complete');
        setOverlayMessage('Fix applied successfully!');
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        toast.success(`Applied fix: ${result.operationsPerformed.join(', ')}`);
      } else {
        setShowOverlay(false);
        toast.info('This recommendation requires manual action');
      }
    } catch (error) {
      console.error('Quick fix error:', error);
      toast.error('Failed to apply fix');
    } finally {
      setIsCleaning(false);
      setTimeout(() => {
        setShowOverlay(false);
        setOverlayProgress(0);
        setOverlayStage('processing');
        setOverlayMessage('');
      }, 1000);
    }
  };
  
  const handleFixAll = async () => {
    if (!dataset || !insights) return;
    
    setIsCleaning(true);
    setShowOverlay(true);
    setOverlayStage('processing');
    setOverlayProgress(0);
    setOverlayMessage('Preparing automated cleaning...');

    try {
      await yieldToBrowser();
      
      if (!cleaningPlan || cleaningPlan.operations.length === 0) {
        setShowOverlay(false);
        toast.info('No cleaning operations needed');
        return;
      }
      
      const totalOperations = cleaningPlan.operations.length;
      
      // Create progress callback
      const onProgress = (progress: number) => {
        setOverlayProgress(progress);
        const currentOp = Math.floor((progress / 100) * totalOperations);
        setOverlayMessage(
          `Applying cleaning operation ${currentOp + 1}/${totalOperations}: ${cleaningPlan.operations[currentOp]?.description || 'Processing...'}`
        );
      };
      
      setOverlayProgress(10);
      setOverlayMessage(`Executing ${totalOperations} cleaning operations...`);
      await yieldToBrowser();
      
      // Execute cleaning with progress updates
      const result = await executeAutoCleaningAsync(
        dataset, 
        cleaningPlan, 
        insights,
        (progress, message) => {
          setOverlayProgress(10 + (progress * 0.8)); // 10-90% range
          setOverlayMessage(message);
        }
      );
      
      setOverlayProgress(90);
      setOverlayMessage('Finalizing cleaned dataset...');
      await yieldToBrowser();
      
      const updatedDataset = updateDatasetStats(result.cleanedDataset);
      onDatasetUpdate?.(updatedDataset);
      
      setOverlayProgress(90);
      setOverlayMessage('Re-analyzing data quality...');
      await yieldToBrowser();
      
      // Re-run analysis with progress
      const newInsights = await runAIAnalysisAsync(updatedDataset, (progress, msg) => {
        setOverlayProgress(90 + (progress * 0.08)); // 90-98% range
        setOverlayMessage(msg);
      });
      setInsights(newInsights);
      
      setOverlayProgress(100);
      setOverlayStage('complete');
      setOverlayMessage('Data cleaning complete!');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast.success(
        `Data cleaning complete! Quality improved from ${result.qualityBefore}% to ${result.qualityAfter}%. ` +
        `${result.rowsRemoved} rows removed. ${result.operationsPerformed.length} operations performed.`
      );
    } catch (error) {
      console.error('Auto cleaning error:', error);
      toast.error('Failed to apply automated cleaning');
    } finally {
      setIsCleaning(false);
      setTimeout(() => {
        setShowOverlay(false);
        setOverlayProgress(0);
        setOverlayStage('processing');
        setOverlayMessage('');
      }, 1000);
    }
  };
  

  // --- Anomaly Fix State & Handlers ---
  const [pendingFix, setPendingFix] = useState<{
    anomaly?: AnomalyResult;
    anomalies?: AnomalyResult[];
    action: AnomalyFixAction;
    scope: 'single' | 'column' | 'all';
    columnName?: string;
  } | null>(null);

  // Group anomalies by column for organized rendering
  const anomalyGroups = useMemo(() => {
    if (!insights?.anomalies?.length) return {};
    const groups: Record<string, AnomalyResult[]> = {};
    for (const a of insights.anomalies) {
      if (!groups[a.column]) groups[a.column] = [];
      groups[a.column].push(a);
    }
    return groups;
  }, [insights?.anomalies]);

  const handleAnomalyFix = async () => {
    if (!dataset || !pendingFix) return;

    const { anomaly, anomalies, action, scope, columnName } = pendingFix;
    setPendingFix(null);

    setIsCleaning(true);
    setShowOverlay(true);
    setOverlayStage('processing');
    setOverlayProgress(0);
    setOverlayMessage('Applying anomaly fix...');

    try {
      await yieldToBrowser();

      setOverlayProgress(20);
      setOverlayMessage(`Applying fix: ${action.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}...`);
      await yieldToBrowser();

      let result;
      if (scope === 'single' && anomaly) {
        result = fixSingleAnomaly(dataset, anomaly, action);
      } else if (scope === 'column' && anomalies) {
        result = fixAnomaliesInColumn(dataset, anomalies, action);
      } else if (scope === 'all' && insights?.anomalies) {
        result = fixAllAnomalies(dataset, insights.anomalies, action);
      }

      if (!result) {
        setShowOverlay(false);
        toast.info('No changes were applied');
        return;
      }

      setOverlayProgress(50);
      setOverlayMessage('Updating dataset statistics...');
      await yieldToBrowser();

      const updatedDataset = updateDatasetStats(result.dataset);
      onDatasetUpdate?.(updatedDataset);

      setOverlayProgress(70);
      setOverlayMessage('Re-analyzing data...');
      await yieldToBrowser();

      // Re-run analysis to refresh anomaly list
      const newInsights = await runAIAnalysisAsync(updatedDataset, (progress, msg) => {
        setOverlayProgress(70 + (progress * 0.25));
        setOverlayMessage(msg);
      });
      setInsights(newInsights);

      setOverlayProgress(100);
      setOverlayStage('complete');
      setOverlayMessage('Fix applied successfully!');

      await new Promise(resolve => setTimeout(resolve, 500));

      toast.success(`${result.description} (${result.fixedCount} fixed)`);
    } catch (error) {
      console.error('Anomaly fix error:', error);
      toast.error('Failed to apply anomaly fix');
    } finally {
      setIsCleaning(false);
      setTimeout(() => {
        setShowOverlay(false);
        setOverlayProgress(0);
        setOverlayStage('processing');
        setOverlayMessage('');
      }, 1000);
    }
  };

  const requestFix = (
    action: AnomalyFixAction,
    scope: 'single' | 'column' | 'all',
    anomaly?: AnomalyResult,
    anomalies?: AnomalyResult[],
    columnName?: string
  ) => {
    setPendingFix({ anomaly, anomalies, action, scope, columnName });
  };

  const FixDropdownItems: React.FC<{
    onSelect: (action: AnomalyFixAction) => void;
  }> = ({ onSelect }) => (
    <>
      <DropdownMenuItem onClick={() => onSelect('removeRow')}>
        <Trash2 className="h-4 w-4 mr-2 text-red-500" />
        Remove Row(s)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onSelect('capToBounds')}>
        <ArrowLeftRight className="h-4 w-4 mr-2 text-blue-500" />
        Cap to Bounds
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onSelect('replaceWithMean')}>
        <Calculator className="h-4 w-4 mr-2 text-green-500" />
        Replace with Mean
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onSelect('replaceWithMedian')}>
        <Calculator className="h-4 w-4 mr-2 text-purple-500" />
        Replace with Median
      </DropdownMenuItem>
    </>
  );

  const getTrendIcon = (trend: TrendResult['trend']) => {
    switch (trend) {
      case 'increasing': return <ArrowUp className="h-4 w-4 text-green-500" />;
      case 'decreasing': return <ArrowDown className="h-4 w-4 text-red-500" />;
      case 'volatile': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default: return <Minus className="h-4 w-4 text-gray-400" />;
    }
  };

  const getSeverityColor = (severity: AnomalyResult['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getCorrelationColor = (coefficient: number) => {
    const abs = Math.abs(coefficient);
    if (abs > 0.7) return coefficient > 0 ? 'text-green-600' : 'text-red-600';
    if (abs > 0.4) return coefficient > 0 ? 'text-green-500' : 'text-red-500';
    return 'text-gray-500';
  };

  if (!dataset) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Brain className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">AI-Powered Insights</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Upload a dataset to unlock powerful AI analysis that automatically discovers 
            patterns, correlations, trends, and anomalies in your data.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Data Processing Overlay for AI Analysis and Cleaning */}
      <DataProcessingOverlay
        isVisible={showOverlay}
        stage={overlayStage}
        progress={overlayProgress}
        message={overlayMessage}
        rowCount={dataset?.rowCount}
      />
      
      <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-lg">
              <Brain className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                AI-Powered Insights
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Smart Analysis
                </Badge>
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                One-click analysis that finds what the human eye might miss
              </p>
            </div>
          </div>
          <Button 
            onClick={runAnalysis} 
            disabled={isAnalyzing}
            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                {insights ? 'Re-analyze' : 'Analyze Now'}
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {!insights ? (
          <div className="py-16 text-center">
            <div className="relative inline-block">
              <Brain className="h-20 w-20 text-gray-200" />
              <div className="absolute -right-1 -bottom-1 p-1.5 bg-violet-500 rounded-full">
                <Zap className="h-4 w-4 text-white" />
              </div>
            </div>
            <h3 className="text-lg font-medium text-gray-700 mt-4">Ready to Discover Insights</h3>
            <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">
              Click "Analyze Now" to automatically detect correlations, trends, anomalies, 
              and patterns in your data using advanced statistical analysis.
            </p>
            <div className="flex justify-center gap-3 mt-6 text-sm text-gray-400">
              <span className="flex items-center gap-1"><Link2 className="h-4 w-4" /> Correlations</span>
              <span className="flex items-center gap-1"><TrendingUp className="h-4 w-4" /> Trends</span>
              <span className="flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Anomalies</span>
              <span className="flex items-center gap-1"><Eye className="h-4 w-4" /> Patterns</span>
            </div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger 
                value="summary" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent"
              >
                <Target className="h-4 w-4 mr-2" />
                Summary
              </TabsTrigger>
              <TabsTrigger 
                value="correlations"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent"
              >
                <Link2 className="h-4 w-4 mr-2" />
                Correlations ({insights.correlations.length})
              </TabsTrigger>
              <TabsTrigger 
                value="trends"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Trends ({insights.trends.length})
              </TabsTrigger>
              <TabsTrigger 
                value="anomalies"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Anomalies ({insights.anomalies.length})
              </TabsTrigger>
              <TabsTrigger 
                value="patterns"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent"
              >
                <Eye className="h-4 w-4 mr-2" />
                Patterns ({insights.patterns.length})
              </TabsTrigger>
            </TabsList>

            {/* Summary Tab */}
            <TabsContent value="summary" className="p-6 space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="p-4 bg-gradient-to-br from-violet-50 to-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Total Insights</span>
                    <Sparkles className="h-4 w-4 text-violet-500" />
                  </div>
                  <p className="text-2xl font-bold text-violet-600">{insights.totalInsights}</p>
                </Card>
                <Card className="p-4 bg-gradient-to-br from-red-50 to-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Critical Findings</span>
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  </div>
                  <p className="text-2xl font-bold text-red-600">{insights.criticalFindings}</p>
                </Card>
                <Card className="p-4 bg-gradient-to-br from-green-50 to-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Data Quality</span>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold text-green-600">{insights.dataQualityScore}%</p>
                </Card>
                <Card className="p-4 bg-gradient-to-br from-blue-50 to-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Analysis Time</span>
                    <Clock className="h-4 w-4 text-blue-500" />
                  </div>
                  <p className="text-2xl font-bold text-blue-600">
                    {new Date(insights.analysisTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </Card>
              </div>

              {/* Executive Summary */}
              <Card className="p-4 bg-gradient-to-r from-violet-50 via-purple-50 to-fuchsia-50 border-violet-200">
                <h4 className="font-semibold text-violet-800 flex items-center gap-2 mb-3">
                  <Brain className="h-5 w-5" />
                  Executive Summary
                </h4>
                <p className="text-gray-700 leading-relaxed">{insights.executiveSummary}</p>
              </Card>

              {/* Recommendations with One-Click Fixes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-500" />
                    Smart Recommendations
                  </h4>
                  {cleaningPlan && cleaningPlan.operations.length > 0 && (
                    <Button
                      onClick={handleFixAll}
                      disabled={isCleaning}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                      size="sm"
                    >
                      {isCleaning ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Cleaning...
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4 mr-2" />
                          Fix All ({cleaningPlan.estimatedQualityImprovement > 0 ? `+${cleaningPlan.estimatedQualityImprovement}%` : 'Auto'})
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {insights.recommendations.map((rec, index) => {
                    const canAutoFix = rec.includes('missing') || rec.includes('imputing') || 
                                     rec.includes('duplicate') || rec.includes('cleaning');
                    
                    return (
                      <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <ChevronRight className="h-5 w-5 text-violet-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-600">{rec}</p>
                        </div>
                        {canAutoFix && (
                          <Button
                            onClick={() => handleQuickFix(rec)}
                            disabled={isCleaning}
                            variant="outline"
                            size="sm"
                            className="flex-shrink-0"
                          >
                            {isCleaning ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Zap className="h-3 w-3 mr-1" />
                                Fix
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Data Quality Progress */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Data Quality Score</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">{insights.dataQualityScore}%</span>
                    {cleaningPlan && cleaningPlan.estimatedQualityImprovement > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        +{cleaningPlan.estimatedQualityImprovement}% possible
                      </Badge>
                    )}
                  </div>
                </div>
                <Progress value={insights.dataQualityScore} className="h-2" />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-400">
                    {insights.dataQualityScore >= 80 ? 'Excellent data quality' :
                     insights.dataQualityScore >= 60 ? 'Good data quality, minor issues' :
                     insights.dataQualityScore >= 40 ? 'Fair quality, some cleaning recommended' :
                     'Poor quality, significant cleaning needed'}
                  </p>
                  {insights.dataQualityScore < 100 && cleaningPlan && cleaningPlan.operations.length > 0 && (
                    <Button
                      onClick={handleFixAll}
                      disabled={isCleaning}
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                    >
                      {isCleaning ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Zap className="h-3 w-3 mr-1" />
                          Auto-fix to 100%
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Correlations Tab */}
            <TabsContent value="correlations" className="p-6">
              <ScrollArea className="h-[400px]">
                {insights.correlations.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Link2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No significant correlations found</p>
                    <p className="text-sm text-gray-400 mt-1">This may indicate independent variables</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.correlations.map((corr, index) => (
                      <Card key={index} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={corr.strength === 'strong' ? 'default' : 'secondary'}>
                              {corr.strength}
                            </Badge>
                            <span className="font-medium text-gray-700">
                              {corr.column1} ↔ {corr.column2}
                            </span>
                          </div>
                          <span className={`font-bold text-lg ${getCorrelationColor(corr.coefficient)}`}>
                            {corr.coefficient > 0 ? '+' : ''}{(corr.coefficient * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{corr.interpretation}</p>
                        <div className="mt-2">
                          <Progress 
                            value={Math.abs(corr.coefficient) * 100} 
                            className={`h-1 ${corr.coefficient > 0 ? '[&>div]:bg-green-500' : '[&>div]:bg-red-500'}`}
                          />
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Trends Tab */}
            <TabsContent value="trends" className="p-6">
              <ScrollArea className="h-[400px]">
                {insights.trends.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <TrendingUp className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No significant trends detected</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.trends.map((trend, index) => (
                      <Card key={index} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getTrendIcon(trend.trend)}
                            <span className="font-medium text-gray-700">{trend.column}</span>
                            <Badge variant={
                              trend.trend === 'increasing' ? 'default' :
                              trend.trend === 'decreasing' ? 'destructive' :
                              trend.trend === 'volatile' ? 'secondary' : 'outline'
                            }>
                              {trend.trend}
                            </Badge>
                          </div>
                          <span className="text-sm text-gray-500">
                            {(trend.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{trend.interpretation}</p>
                        {trend.forecast.length > 0 && (
                          <div className="text-xs text-gray-400 flex items-center gap-1">
                            <span>Forecast:</span>
                            {trend.forecast.map((val, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {val.toLocaleString()}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Anomalies Tab */}
            <TabsContent value="anomalies" className="p-6">
              <ScrollArea className="h-[500px]">
                {insights.anomalies.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-300" />
                    <p>No anomalies detected</p>
                    <p className="text-sm text-gray-400 mt-1">Your data looks clean!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Global Fix All Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        <span className="font-semibold text-gray-700">
                          {insights.anomalies.length} Anomal{insights.anomalies.length === 1 ? 'y' : 'ies'} Detected
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {Object.keys(anomalyGroups).length} column{Object.keys(anomalyGroups).length > 1 ? 's' : ''}
                        </Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                            disabled={isCleaning}
                          >
                            <Wrench className="h-4 w-4 mr-2" />
                            Fix All Anomalies
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Fix all {insights.anomalies.length} anomalies</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <FixDropdownItems
                            onSelect={(action) => requestFix(action, 'all', undefined, insights.anomalies)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Grouped by Column */}
                    {Object.entries(anomalyGroups).map(([columnName, columnAnomalies]) => (
                      <div key={columnName} className="space-y-2">
                        {/* Column Group Header */}
                        <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700">Column: &quot;{columnName}&quot;</span>
                            <Badge variant="outline" className="text-xs">
                              {columnAnomalies.length} anomal{columnAnomalies.length === 1 ? 'y' : 'ies'}
                            </Badge>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" disabled={isCleaning}>
                                <Wrench className="h-3.5 w-3.5 mr-1.5" />
                                Fix All in Column
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Fix {columnAnomalies.length} in &quot;{columnName}&quot;</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <FixDropdownItems
                                onSelect={(action) => requestFix(action, 'column', undefined, columnAnomalies, columnName)}
                              />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Individual Anomaly Cards */}
                        {columnAnomalies.slice(0, 10).map((anomaly, index) => (
                          <Card
                            key={`${columnName}-${index}`}
                            className={`p-4 border ${getSeverityColor(anomaly.severity)} ml-2`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className={`h-4 w-4 ${
                                  anomaly.severity === 'critical' ? 'text-red-600' :
                                  anomaly.severity === 'high' ? 'text-orange-600' :
                                  anomaly.severity === 'medium' ? 'text-yellow-600' : 'text-blue-600'
                                }`} />
                                <span className="font-medium">{anomaly.column}</span>
                                <Badge variant="outline" className="text-xs">
                                  Row {anomaly.rowIndex + 1}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={
                                  anomaly.severity === 'critical' ? 'bg-red-500' :
                                  anomaly.severity === 'high' ? 'bg-orange-500' :
                                  anomaly.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                                }>
                                  {anomaly.severity}
                                </Badge>
                                {/* Per-anomaly fix dropdown */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 hover:bg-white/50"
                                      disabled={isCleaning}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Fix this anomaly</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <FixDropdownItems
                                      onSelect={(action) => requestFix(action, 'single', anomaly)}
                                    />
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                            <p className="text-sm">{anomaly.description}</p>
                            <div className="mt-2 text-xs text-gray-500">
                              Value: <span className="font-mono font-bold">{anomaly.value}</span> |{' '}
                              Expected: <span className="font-mono">
                                {typeof anomaly.expectedRange.min === 'number' ? anomaly.expectedRange.min.toLocaleString() : anomaly.expectedRange.min} - {typeof anomaly.expectedRange.max === 'number' ? anomaly.expectedRange.max.toLocaleString() : anomaly.expectedRange.max}
                              </span>
                            </div>
                          </Card>
                        ))}
                        {columnAnomalies.length > 10 && (
                          <p className="text-center text-xs text-gray-400 ml-2">
                            Showing 10 of {columnAnomalies.length} anomalies in this column
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Anomaly Fix Confirmation Dialog */}
              <AlertDialog open={!!pendingFix} onOpenChange={(open) => !open && setPendingFix(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <Wrench className="h-5 w-5 text-orange-500" />
                      Confirm Anomaly Fix
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">
                          {pendingFix && getFixDescription(
                            pendingFix.action,
                            pendingFix.scope,
                            pendingFix.anomaly,
                            pendingFix.anomalies || (insights?.anomalies),
                            pendingFix.columnName,
                            dataset || undefined
                          )}
                        </p>
                        <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
                          <p className="text-xs text-orange-700">
                            <strong>Note:</strong> This action will modify your dataset. The analysis will automatically re-run after the fix is applied.
                          </p>
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleAnomalyFix}
                      className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                    >
                      <Wrench className="h-4 w-4 mr-2" />
                      Apply Fix
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>

            {/* Patterns Tab */}
            <TabsContent value="patterns" className="p-6">
              <ScrollArea className="h-[400px]">
                {insights.patterns.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Eye className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No significant patterns detected</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.patterns.map((pattern, index) => (
                      <Card key={index} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">
                            {pattern.type.replace('_', ' ')}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {(pattern.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 font-medium mb-1">{pattern.description}</p>
                        <p className="text-sm text-gray-600">{pattern.actionableInsight}</p>
                        <div className="mt-2 flex gap-1">
                          {pattern.columns.map(col => (
                            <Badge key={col} variant="secondary" className="text-xs">{col}</Badge>
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
    </>
  );
};

export default AIInsightsPanel;
