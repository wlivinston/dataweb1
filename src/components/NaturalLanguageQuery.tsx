// Natural Language Query Interface - Ask questions in plain English
// Designed for users averse to technology and statistics

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  MessageSquare, Send, Sparkles, BarChart3, PieChart, Table, 
  Hash, HelpCircle, Lightbulb, ChevronRight, X, History,
  TrendingUp, Filter, Link2, Calculator
} from 'lucide-react';
import { Dataset } from '@/lib/types';
import { executeQuery, generateSuggestions, QueryResult, QuerySuggestion } from '@/lib/naturalLanguageQuery';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';

interface NaturalLanguageQueryProps {
  dataset: Dataset | null;
  onVisualizationRequest?: (viz: any) => void;
}

interface QueryHistoryItem {
  query: string;
  result: QueryResult;
  timestamp: Date;
}

const CHART_COLORS = ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#EF4444', '#6366F1', '#14B8A6'];

const NaturalLanguageQuery: React.FC<NaturalLanguageQueryProps> = ({ 
  dataset,
  onVisualizationRequest 
}) => {
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<QueryResult | null>(null);
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate suggestions when dataset changes
  useEffect(() => {
    if (dataset) {
      const newSuggestions = generateSuggestions(dataset);
      setSuggestions(newSuggestions);
    }
  }, [dataset]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!query.trim()) {
      toast.error('Please enter a question');
      return;
    }

    if (!dataset) {
      toast.error('Please select a dataset first');
      return;
    }

    setIsProcessing(true);
    try {
      // Small delay for UX
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const result = executeQuery(query, dataset);
      setCurrentResult(result);
      
      // Add to history
      setQueryHistory(prev => [{
        query: query.trim(),
        result,
        timestamp: new Date()
      }, ...prev.slice(0, 19)]); // Keep last 20 queries
      
      if (!result.success) {
        toast.error(result.explanation);
      }
    } catch (error) {
      console.error('Query error:', error);
      toast.error('Failed to process query');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSuggestionClick = (suggestion: QuerySuggestion) => {
    setQuery(suggestion.text);
    inputRef.current?.focus();
  };

  const handleHistoryClick = (item: QueryHistoryItem) => {
    setQuery(item.query);
    setCurrentResult(item.result);
    setShowHistory(false);
  };

  const getCategoryIcon = (category: QuerySuggestion['category']) => {
    switch (category) {
      case 'aggregation': return <Calculator className="h-3 w-3" />;
      case 'comparison': return <BarChart3 className="h-3 w-3" />;
      case 'trend': return <TrendingUp className="h-3 w-3" />;
      case 'filter': return <Filter className="h-3 w-3" />;
      case 'relationship': return <Link2 className="h-3 w-3" />;
      default: return <HelpCircle className="h-3 w-3" />;
    }
  };

  const renderResultVisualization = () => {
    if (!currentResult || !currentResult.success) return null;

    const { suggestedVisualization, result, resultType } = currentResult;

    if (resultType === 'number') {
      return (
        <div className="text-center py-6">
          <p className="text-5xl font-bold text-violet-600">
            {typeof result === 'number' ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : result}
          </p>
          <p className="text-sm text-gray-500 mt-2">{currentResult.interpretation}</p>
        </div>
      );
    }

    if (resultType === 'table' && Array.isArray(result)) {
      const columns = result.length > 0 ? Object.keys(result[0]) : [];
      
      // Also render chart if suggested
      const showChart = suggestedVisualization && suggestedVisualization.data;
      
      return (
        <div className="space-y-4">
          {showChart && suggestedVisualization.type === 'bar' && (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={suggestedVisualization.data} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8B5CF6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          
          {showChart && suggestedVisualization.type === 'pie' && (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={suggestedVisualization.data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ category, percent }) => `${category}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={60}
                    dataKey="value"
                  >
                    {suggestedVisualization.data.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          )}
          
          <ScrollArea className="h-64">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-medium text-gray-700 border-b">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.slice(0, 50).map((row: any, index: number) => (
                  <tr key={index} className="hover:bg-gray-50 border-b border-gray-100">
                    {columns.map(col => (
                      <td key={col} className="px-3 py-2 text-gray-600">
                        {typeof row[col] === 'number' 
                          ? row[col].toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : String(row[col] || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.length > 50 && (
              <p className="text-center text-xs text-gray-400 py-2">
                Showing 50 of {result.length} rows
              </p>
            )}
          </ScrollArea>
        </div>
      );
    }

    return null;
  };

  if (!dataset) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <MessageSquare className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">Ask Questions in Plain English</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Upload a dataset to start asking questions like "What is the total sales?" 
            or "Show me the top 10 customers by revenue".
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-teal-500/10 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <MessageSquare className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Ask Your Data
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Natural Language
                </Badge>
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Ask questions in plain English - no coding required
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="text-gray-500"
          >
            <History className="h-4 w-4 mr-1" />
            History ({queryHistory.length})
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Query Input */}
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask a question like 'What is the total revenue?' or 'Show top 10 by sales'"
                className="pr-10 h-12 text-base"
                disabled={isProcessing}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setCurrentResult(null); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button 
              type="submit" 
              disabled={isProcessing || !query.trim()}
              className="h-12 px-6 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
            >
              {isProcessing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>

        {/* Quick Suggestions */}
        {!currentResult && !showHistory && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              <span>Try asking:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 6).map((suggestion, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="text-xs h-8 hover:bg-blue-50 hover:border-blue-300"
                >
                  <span className="mr-1">{suggestion.icon}</span>
                  {getCategoryIcon(suggestion.category)}
                  <span className="ml-1">{suggestion.text}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Query History */}
        {showHistory && queryHistory.length > 0 && (
          <div className="border rounded-lg p-3 bg-gray-50">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent Queries
            </h4>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {queryHistory.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => handleHistoryClick(item)}
                    className="w-full text-left p-2 rounded hover:bg-white transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 truncate flex-1">{item.query}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={item.result.success ? 'default' : 'secondary'} className="text-xs">
                        {item.result.resultType}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {(item.result.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Result Display */}
        {currentResult && (
          <div className="border rounded-lg overflow-hidden">
            {/* Result Header */}
            <div className={`p-3 ${currentResult.success ? 'bg-green-50' : 'bg-yellow-50'} border-b`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {currentResult.resultType === 'number' && <Hash className="h-4 w-4 text-violet-500" />}
                  {currentResult.resultType === 'table' && <Table className="h-4 w-4 text-blue-500" />}
                  {currentResult.resultType === 'chart' && <BarChart3 className="h-4 w-4 text-green-500" />}
                  <span className="text-sm font-medium text-gray-700">
                    {currentResult.interpretation}
                  </span>
                </div>
                <Badge variant={currentResult.success ? 'default' : 'secondary'}>
                  {(currentResult.confidence * 100).toFixed(0)}% confidence
                </Badge>
              </div>
            </div>
            
            {/* Result Content */}
            <div className="p-4 bg-white">
              {renderResultVisualization()}
              
              {/* Explanation */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">{currentResult.explanation}</p>
              </div>
              
              {/* Alternative Queries */}
              {currentResult.alternativeQueries && currentResult.alternativeQueries.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-gray-500 mb-2">You might also want to ask:</p>
                  <div className="flex flex-wrap gap-2">
                    {currentResult.alternativeQueries.map((altQuery, index) => (
                      <Button
                        key={index}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setQuery(altQuery);
                          inputRef.current?.focus();
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 h-7"
                      >
                        <ChevronRight className="h-3 w-3 mr-1" />
                        {altQuery}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="text-center text-xs text-gray-400 pt-2">
          <p>💡 Tip: Ask about totals, averages, counts, distributions, or comparisons</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default NaturalLanguageQuery;
