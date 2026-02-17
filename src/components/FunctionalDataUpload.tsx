import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Upload, FileText, BarChart3, TrendingUp, Users, DollarSign, 
  CheckCircle, Plus, Link, Palette, Zap, Database, 
  PieChart as PieChartIcon, LineChart as LineChartIcon, ChartScatter, AreaChart as AreaChartIcon, Table, Gauge,
  AlertCircle, Loader2, FileSpreadsheet, FileCode, Edit, Columns, Eye
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
// Import shared types and utilities
import { Dataset, ColumnInfo, DataType, Relationship } from '@/lib/types';
import { analyzeColumn, updateDatasetStats, createEmptyObservation } from '@/lib/dataUtils';
// Import new components
import DataEntryForm from './DataEntryForm';
import CustomFieldDialog from './CustomFieldDialog';
import DataExplorer from './DataExplorer';
import AnalyticsDashboard from './AnalyticsDashboard';
import RelationshipBuilder from './RelationshipBuilder';
import CustomDAXCalculator from './CustomDAXCalculator';
import AnalysisInterpretation from './AnalysisInterpretation';
import DataCleaning from './DataCleaning';
import ZoomableVisualization from './ZoomableVisualization';
import { generatePDF } from '@/lib/pdfGenerator';
import { generateEnhancedPDF } from '@/lib/pdfGeneratorEnhanced';
import { Download } from 'lucide-react';
import PDFPaywallDialog from './PDFPaywallDialog';
import RequestReportCTA from './RequestReportCTA';
import { useAuth } from '@/hooks/useAuth';
import { getApiUrl } from '@/lib/publicConfig';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
// New AI-powered components
import AIInsightsPanel from './AIInsightsPanel';
import NaturalLanguageQuery from './NaturalLanguageQuery';
import SmartDataConnector from './SmartDataConnector';
import CorrelationMatrix from './CorrelationMatrix';
import DataProcessingOverlay from './DataProcessingOverlay';
import ErrorBoundary from './ErrorBoundary';
import { runAIAnalysis, runEnhancedAIAnalysis, AIInsightSummary } from '@/lib/aiInsightEngine';
import { detectSchema, detectDateTables } from '@/lib/smartDataConnector';
import { SchemaDetectionResult, TimeSeriesResult, DateTableInfo } from '@/lib/types';
import { autoDetectTimeSeries, detectDateColumns } from '@/lib/timeSeriesEngine';
import { autoAdvancedAnalysis } from '@/lib/advancedStatistics';
import { generateEnhancedKPIs } from '@/lib/kpiFormulaEngine';
import {
  isDatasetTooLarge,
  getPerformanceWarning,
  shouldCancelOperation,
  optimizeVisualizationData,
  RENDERING_LIMITS
} from '@/lib/dataOptimization';
import { CHART_COLOR_SCHEMES, SHARED_CHART_PALETTE, POSITIVE_CHART_COLOR, NEGATIVE_CHART_COLOR } from '@/lib/chartColors';

interface DAXCalculation {
  id: string;
  name: string;
  formula: string;
  description: string;
  category: 'aggregation' | 'time' | 'statistical' | 'text' | 'logical';
  applicable: boolean;
  confidence: number;
  result?: any;
}

interface Visualization {
  id: string;
  title: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'table' | 'gauge';
  data: any;
  colors: string[];
  gradient: string;
  daxCalculations: DAXCalculation[];
  datasetId: string;
}

const FunctionalDataUpload: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeDataset, setActiveDataset] = useState<string | null>(null);
  const [visualizations, setVisualizations] = useState<Visualization[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [selectedColorScheme, setSelectedColorScheme] = useState('professional');
  const [isProcessing, setIsProcessing] = useState(false);
  const [daxCalculations, setDaxCalculations] = useState<DAXCalculation[]>([]);
  const [customDAXCalculations, setCustomDAXCalculations] = useState<DAXCalculation[]>([]);
  const [schemaType, setSchemaType] = useState<'star' | 'snowflake' | 'none'>('none');
  const [interpretation, setInterpretation] = useState<string>('');
  // New state for data entry and custom fields
  const [showDataEntryDialog, setShowDataEntryDialog] = useState(false);
  const [showCustomFieldDialog, setShowCustomFieldDialog] = useState(false);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  // AI Insights state
  const [aiInsights, setAiInsights] = useState<AIInsightSummary | null>(null);
  const [compositeData, setCompositeData] = useState<any[] | null>(null);
  const [compositeColumns, setCompositeColumns] = useState<any[] | null>(null);
  // Phase B: Enhanced analytics state
  const [timeSeriesResults, setTimeSeriesResults] = useState<TimeSeriesResult[]>([]);
  const [advancedStatsResults, setAdvancedStatsResults] = useState<any>(null);
  const [dateTableInfos, setDateTableInfos] = useState<DateTableInfo[]>([]);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [checkoutLoadingProvider, setCheckoutLoadingProvider] = useState<'stripe' | 'paystack' | null>(null);
  const { user, session } = useAuth();
  // Loading states for file processing
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<'uploading' | 'parsing' | 'analyzing' | 'processing' | 'complete'>('uploading');
  const [uploadMessage, setUploadMessage] = useState<string>('');
  // Auto schema detection state
  const [autoDetectedSchema, setAutoDetectedSchema] = useState<SchemaDetectionResult | null>(null);
  const prevDatasetCount = useRef(0);

  const colorSchemes = CHART_COLOR_SCHEMES;

  const getAccessToken = async (): Promise<string | null> => {
    if (session?.access_token) return session.access_token;
    if (!supabase) return null;

    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  const hasPaidPDFAccess = async (): Promise<boolean> => {
    if (!user?.email) return false;
    if (!isSupabaseConfigured || !supabase) return false;

    try {
      const { data, error } = await supabase
        .from('customers')
        .select('subscription_status')
        .eq('email', user.email)
        .single();

      if (error || !data?.subscription_status) return false;

      const paidStatuses = new Set([
        'professional',
        'enterprise',
        'admin',
        'paid',
        'premium',
        'pro',
        'monthly',
        'annual',
      ]);

      const status = String(data.subscription_status).toLowerCase().trim();
      return paidStatuses.has(status);
    } catch (error) {
      console.error('Subscription status lookup failed:', error);
      return false;
    }
  };

  const startProviderCheckout = async (
    provider: 'stripe' | 'paystack',
    plan: 'single' | 'monthly'
  ) => {
    if (!user) {
      toast.error('Please sign in first to complete payment.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      toast.error('Authentication session expired. Please sign in again.');
      return;
    }

    setCheckoutLoadingProvider(provider);
    try {
      const response = await fetch(getApiUrl('/api/subscriptions/pdf-checkout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          plan,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.checkout_url) {
        throw new Error(payload?.error || 'Failed to initialize checkout.');
      }

      setShowPaywall(false);
      window.location.href = payload.checkout_url;
    } catch (error: any) {
      console.error('Checkout initialization error:', error);
      toast.error(error?.message || 'Could not start payment checkout.');
      setCheckoutLoadingProvider(null);
    }
  };

  // File Format Detection
  const getFileFormat = (fileName: string): 'csv' | 'excel' | 'json' => {
    const extension = fileName.toLowerCase().split('.').pop();
    if (['xlsx', 'xls'].includes(extension || '')) return 'excel';
    if (extension === 'json') return 'json';
    return 'csv';
  };

  // CSV Parser Function
  const parseCSV = (csvText: string): any[] => {
    if (!csvText || csvText.trim().length === 0) {
      throw new Error('CSV file is empty');
    }

    // Remove UTF-8 BOM if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }

    const records: any[] = [];
    let inQuote = false;
    let currentField = '';
    let currentRow: string[] = [];

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (inQuote && nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          inQuote = !inQuote;
        }
      } else if (char === ',' && !inQuote) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if ((char === '\n' || (char === '\r' && nextChar !== '\n')) && !inQuote) {
        currentRow.push(currentField.trim());
        if (currentRow.length > 0 && currentRow.some(field => field.length > 0)) {
          records.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip LF after CR
        }
      } else if (char !== '\r') {
        currentField += char;
      }
    }

    // Add the last field and row if any
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.length > 0 && currentRow.some(field => field.length > 0)) {
        records.push(currentRow);
      }
    }

    if (records.length === 0) {
      throw new Error('CSV file contains no data rows');
    }

    // Extract headers from first row
    const headers = records[0].map((h: string) => h.replace(/^"|"$/g, '').trim());
    
    if (headers.length === 0) {
      throw new Error('CSV file has no column headers');
    }

    // Check for duplicate headers
    const uniqueHeaders = new Set(headers);
    if (uniqueHeaders.size !== headers.length) {
      console.warn('CSV has duplicate column headers. Some columns may be overwritten.');
    }

    // Process data rows
    const data: any[] = [];
    for (let i = 1; i < records.length; i++) {
      const values = records[i].map((v: string) => v.replace(/^"|"$/g, '').trim());
      
      // Only add rows that have at least one non-empty value
      if (values.some(v => v.length > 0)) {
        const row: any = {};
        headers.forEach((header: string, index: number) => {
          // Handle rows with fewer columns than headers
          row[header] = values[index] !== undefined ? values[index] : '';
        });
        data.push(row);
      }
    }

    if (data.length === 0) {
      throw new Error('CSV file has headers but no data rows');
    }

    return data;
  };

  // Excel Parser Function - Returns data from first sheet (for backward compatibility)
  const parseExcel = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get the first worksheet
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (jsonData.length === 0) {
            resolve([]);
            return;
          }
          
          // Convert to object format
          const headers = jsonData[0] as string[];
          const rows = jsonData.slice(1) as any[][];
          
          const result = rows.map(row => {
            const obj: any = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });
          
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  };

  // Excel Parser Function - Returns all sheets as separate datasets
  const parseExcelAllSheets = (file: File): Promise<Array<{ sheetName: string; data: any[] }>> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const allSheets: Array<{ sheetName: string; data: any[] }> = [];
          
          // Process each sheet
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            
            // Convert to JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (jsonData.length === 0) {
              // Empty sheet - skip it
              return;
            }
            
            // Convert to object format
            const headers = jsonData[0] as string[];
            const rows = jsonData.slice(1) as any[][];
            
            const result = rows.map(row => {
              const obj: any = {};
              headers.forEach((header, index) => {
                obj[header] = row[index] || '';
              });
              return obj;
            });
            
            if (result.length > 0) {
              allSheets.push({
                sheetName: sheetName,
                data: result
              });
            }
          });
          
          if (allSheets.length === 0) {
            reject(new Error('Excel file contains no data in any sheet'));
            return;
          }
          
          resolve(allSheets);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  };

  // JSON Parser Function
  const parseJSON = (jsonText: string): any[] => {
    if (!jsonText || jsonText.trim().length === 0) {
      throw new Error('JSON file is empty');
    }

    try {
      const parsed = JSON.parse(jsonText);
      
      // Handle different JSON structures
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          throw new Error('JSON array is empty');
        }
        // Validate that array contains objects
        if (parsed.length > 0 && typeof parsed[0] !== 'object') {
          throw new Error('JSON array must contain objects, not primitive values');
        }
        return parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        // If it's an object, try to find an array property
        const arrayKeys = Object.keys(parsed).filter(key => Array.isArray(parsed[key]));
        if (arrayKeys.length > 0) {
          const firstArray = parsed[arrayKeys[0]];
          if (firstArray.length === 0) {
            throw new Error(`JSON array property "${arrayKeys[0]}" is empty`);
          }
          return firstArray;
        }
        // If no array found, wrap the object in an array
        return [parsed];
      }
      
      throw new Error('JSON must be an object or array');
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON syntax: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error('Invalid JSON format');
    }
  };

  // Detect Data Type
  const detectDataType = (values: any[]): 'string' | 'number' | 'date' | 'boolean' => {
    const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
    if (nonNullValues.length === 0) return 'string';
    
    // Check for numbers
    const numericValues = nonNullValues.filter(v => !isNaN(Number(v)) && v !== '');
    if (numericValues.length / nonNullValues.length > 0.8) return 'number';
    
    // Check for dates
    const dateValues = nonNullValues.filter(v => !isNaN(Date.parse(v)));
    if (dateValues.length / nonNullValues.length > 0.8) return 'date';
    
    // Check for booleans
    const booleanValues = nonNullValues.filter(v => 
      ['true', 'false', 'yes', 'no', '1', '0'].includes(String(v).toLowerCase())
    );
    if (booleanValues.length / nonNullValues.length > 0.8) return 'boolean';
    
    return 'string';
  };

  // analyzeColumn is imported from '@/lib/dataUtils' to avoid duplication

  // Helper function to yield control to browser to prevent freezing
  const yieldToBrowser = (): Promise<void> => {
    return new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  };

  // Process data in chunks to keep UI responsive
  const processDataInChunks = async <T,>(
    items: T[],
    chunkSize: number,
    processor: (chunk: T[]) => void,
    onProgress?: (progress: number) => void
  ): Promise<void> => {
    const totalChunks = Math.ceil(items.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, items.length);
      const chunk = items.slice(start, end);
      
      processor(chunk);
      
      if (onProgress) {
        onProgress(((i + 1) / totalChunks) * 100);
      }
      
      // Yield control to browser every chunk
      await yieldToBrowser();
    }
  };

  // File Upload Handler with proper loading states
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileFormat = getFileFormat(file.name);
    const supportedFormats = ['csv', 'xlsx', 'xls', 'json'];
    
    if (!supportedFormats.includes(file.name.toLowerCase().split('.').pop() || '')) {
      toast.error('Please upload a CSV, Excel (.xlsx, .xls), or JSON file');
      return;
    }

    // File size validation and warning
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 100) {
      const proceed = window.confirm(
        `Warning: This file is ${fileSizeMB.toFixed(2)} MB. Large files may take several minutes to process. ` +
        `The page will remain responsive during processing. Do you want to continue?`
      );
      if (!proceed) {
        event.target.value = ''; // Reset file input
        return;
      }
    } else if (fileSizeMB > 20) {
      toast.info(`Processing ${fileSizeMB.toFixed(2)} MB file. This may take 30-60 seconds. Please wait...`);
    }

    // Show loading overlay immediately
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage('uploading');
    setUploadMessage(`Uploading ${file.name}...`);

    try {
      let data: any[] = [];

      // Stage 1: Reading file
      setUploadStage('uploading');
      setUploadProgress(10);
      setUploadMessage(`Reading file: ${file.name}...`);
      await yieldToBrowser();

      if (fileFormat === 'csv') {
        setUploadStage('parsing');
        setUploadProgress(20);
        setUploadMessage('Parsing CSV data...');
        
        const text = await file.text();
        if (!text || text.trim().length === 0) {
          setIsUploading(false);
          toast.error('CSV file is empty. Please upload a file with data.');
          return;
        }
        
        await yieldToBrowser();
        
        try {
          setUploadProgress(40);
          data = parseCSV(text);
        } catch (parseError) {
          setIsUploading(false);
          const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
          toast.error(`CSV parsing error: ${errorMessage}`);
          console.error('CSV parsing details:', parseError);
          return;
        }
      } else if (fileFormat === 'excel') {
        setUploadStage('parsing');
        setUploadProgress(20);
        setUploadMessage('Parsing Excel file...');
        
        await yieldToBrowser();
        
        try {
          setUploadProgress(30);
          // Parse all sheets from Excel file
          const allSheets = await parseExcelAllSheets(file);
          
          if (allSheets.length === 0) {
            setIsUploading(false);
            toast.error('Excel file contains no data in any sheet');
            return;
          }
          
          // Process each sheet as a separate dataset
          const newDatasets: Dataset[] = [];
          
          for (let sheetIndex = 0; sheetIndex < allSheets.length; sheetIndex++) {
            const sheet = allSheets[sheetIndex];
            setUploadProgress(30 + (sheetIndex / allSheets.length) * 50);
            setUploadMessage(`Processing sheet "${sheet.sheetName}" (${sheetIndex + 1}/${allSheets.length})...`);
            
            await yieldToBrowser();
            
            const sheetData = sheet.data;
            
            if (!sheetData || sheetData.length === 0) {
              continue; // Skip empty sheets
            }
            
            if (!sheetData[0] || Object.keys(sheetData[0]).length === 0) {
              continue; // Skip sheets with no headers
            }
            
            // Analyze columns for this sheet
            const headers = Object.keys(sheetData[0]);
            const columns: ColumnInfo[] = [];
            
            // Process columns in chunks
            const chunkSize = Math.max(1, Math.floor(headers.length / 4));
            for (let i = 0; i < headers.length; i += chunkSize) {
              const headerChunk = headers.slice(i, Math.min(i + chunkSize, headers.length));
              headerChunk.forEach(header => {
                const values = sheetData.map(row => row[header]);
                columns.push(analyzeColumn(header, values));
              });
              await yieldToBrowser();
            }
            
            // Create dataset for this sheet
            const sheetDataset: Dataset = {
              id: `dataset-${Date.now()}-${sheetIndex}`,
              name: `${file.name} - ${sheet.sheetName}`,
              file: file,
              description: `Sheet: ${sheet.sheetName}`,
              columns: columns,
              rowCount: sheetData.length,
              dataTypes: Object.fromEntries(columns.map(col => [col.name, col.type])),
              data: sheetData,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            
            newDatasets.push(sheetDataset);
          }
          
          if (newDatasets.length === 0) {
            setIsUploading(false);
            toast.error('Excel file contains no valid data sheets');
            return;
          }
          
          // Add all datasets
          setUploadProgress(85);
          setUploadMessage(`Adding ${newDatasets.length} dataset(s)...`);
          await yieldToBrowser();
          
          setDatasets(prev => [...prev, ...newDatasets]);
          setActiveDataset(newDatasets[0].id);
          
          // Stage 4: Complete
          setUploadStage('complete');
          setUploadProgress(100);
          setUploadMessage('Upload complete!');
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          setIsUploading(false);
          toast.success(
            `Successfully uploaded ${file.name} with ${newDatasets.length} sheet(s): ` +
            `${newDatasets.map(d => d.name).join(', ')}. ` +
            `Total rows: ${newDatasets.reduce((sum, d) => sum + d.rowCount, 0).toLocaleString()}`
          );
          
          // Return early since we've already processed everything
          return;
          
        } catch (parseError) {
          setIsUploading(false);
          toast.error(`Excel parsing error: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          console.error('Excel parsing details:', parseError);
          return;
        }
      } else if (fileFormat === 'json') {
        setUploadStage('parsing');
        setUploadProgress(20);
        setUploadMessage('Parsing JSON data...');
        
        const text = await file.text();
        if (!text || text.trim().length === 0) {
          setIsUploading(false);
          toast.error('JSON file is empty. Please upload a file with data.');
          return;
        }
        
        await yieldToBrowser();
        
        try {
          setUploadProgress(40);
          data = parseJSON(text);
        } catch (parseError) {
          setIsUploading(false);
          toast.error(`JSON parsing error: ${parseError instanceof Error ? parseError.message : 'Invalid JSON format'}`);
          console.error('JSON parsing details:', parseError);
          return;
        }
      }
      
      if (!data || data.length === 0) {
        setIsUploading(false);
        toast.error(`${fileFormat.toUpperCase()} file is empty or contains no valid data rows`);
        return;
      }

      if (!data[0] || Object.keys(data[0]).length === 0) {
        setIsUploading(false);
        toast.error(`${fileFormat.toUpperCase()} file has no valid column headers`);
        return;
      }

      // Stage 2: Analyzing columns (chunked for large datasets)
      setUploadStage('analyzing');
      setUploadProgress(50);
      setUploadMessage(`Analyzing ${data.length.toLocaleString()} rows...`);
      await yieldToBrowser();

      const headers = Object.keys(data[0]);
      const columns: ColumnInfo[] = [];
      
      // Process columns in chunks to keep UI responsive
      const chunkSize = Math.max(1, Math.floor(headers.length / 4));
      let processedColumns = 0;
      
      for (let i = 0; i < headers.length; i += chunkSize) {
        const headerChunk = headers.slice(i, Math.min(i + chunkSize, headers.length));
        
        headerChunk.forEach(header => {
          const values = data.map(row => row[header]);
          columns.push(analyzeColumn(header, values));
        });
        
        processedColumns += headerChunk.length;
        setUploadProgress(50 + (processedColumns / headers.length) * 30);
        setUploadMessage(`Analyzing columns: ${processedColumns}/${headers.length}...`);
        
        await yieldToBrowser();
      }

      // Stage 3: Creating dataset
      setUploadStage('processing');
      setUploadProgress(85);
      setUploadMessage('Finalizing dataset...');
      await yieldToBrowser();

      const newDataset: Dataset = {
        id: `dataset-${Date.now()}`,
        name: file.name,
        file: file,
        description: '',
        columns: columns,
        rowCount: data.length,
        dataTypes: Object.fromEntries(columns.map(col => [col.name, col.type])),
        data: data,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      setUploadProgress(95);
      await yieldToBrowser();
      
      setDatasets(prev => [...prev, newDataset]);
      setActiveDataset(newDataset.id);
      
      // Stage 4: Complete
      setUploadStage('complete');
      setUploadProgress(100);
      setUploadMessage('Upload complete!');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setIsUploading(false);
      toast.success(`Successfully uploaded ${file.name} (${fileFormat.toUpperCase()}) with ${data.length.toLocaleString()} rows`);
    } catch (error) {
      setIsUploading(false);
      console.error(`Error parsing ${fileFormat}:`, error);
      toast.error(`Error parsing ${fileFormat.toUpperCase()} file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Reset after a delay to show completion
      setTimeout(() => {
        setUploadProgress(0);
        setUploadStage('uploading');
        setUploadMessage('');
      }, 1000);
    }
  };

  // Generate DAX Calculations
  const generateDAXCalculations = (dataset: Dataset): DAXCalculation[] => {
    const calculations: DAXCalculation[] = [];
    const numericColumns = dataset.columns.filter(col => col.type === 'number');
    const dateColumns = dataset.columns.filter(col => col.type === 'date');
    const textColumns = dataset.columns.filter(col => col.type === 'string');

    // Aggregation calculations
    if (numericColumns.length > 0) {
      numericColumns.forEach(col => {
        calculations.push({
          id: `sum-${col.name}`,
          name: `Sum of ${col.name}`,
          formula: `SUM(${col.name})`,
          description: `Total sum of ${col.name}`,
          category: 'aggregation',
          applicable: true,
          confidence: 0.9
        });

        calculations.push({
          id: `avg-${col.name}`,
          name: `Average of ${col.name}`,
          formula: `AVERAGE(${col.name})`,
          description: `Average value of ${col.name}`,
          category: 'aggregation',
          applicable: true,
          confidence: 0.9
        });

        calculations.push({
          id: `max-${col.name}`,
          name: `Maximum ${col.name}`,
          formula: `MAX(${col.name})`,
          description: `Maximum value of ${col.name}`,
          category: 'aggregation',
          applicable: true,
          confidence: 0.9
        });
      });
    }

    // Count calculations
    calculations.push({
      id: 'total-rows',
      name: 'Total Rows',
      formula: 'COUNTROWS(Table)',
      description: 'Total number of rows in the dataset',
      category: 'aggregation',
      applicable: true,
      confidence: 1.0
    });

    // Time-based calculations
    if (dateColumns.length > 0) {
      dateColumns.forEach(col => {
        calculations.push({
          id: `year-${col.name}`,
          name: `Year from ${col.name}`,
          formula: `YEAR(${col.name})`,
          description: `Extract year from ${col.name}`,
          category: 'time',
          applicable: true,
          confidence: 0.8
        });
      });
    }

    return calculations;
  };

  // Execute DAX Calculation
  const executeDAXCalculation = (calculation: DAXCalculation, dataset: Dataset): any => {
    const { formula, name } = calculation;
    
    try {
      if (formula.includes('SUM(')) {
        const columnName = formula.match(/SUM\(([^)]+)\)/)?.[1];
        if (columnName && dataset.dataTypes[columnName] === 'number') {
          const values = dataset.data.map(row => Number(row[columnName])).filter(v => !isNaN(v));
          return values.reduce((a, b) => a + b, 0);
        }
      }
      
      if (formula.includes('AVERAGE(')) {
        const columnName = formula.match(/AVERAGE\(([^)]+)\)/)?.[1];
        if (columnName && dataset.dataTypes[columnName] === 'number') {
          const values = dataset.data.map(row => Number(row[columnName])).filter(v => !isNaN(v));
          return values.reduce((a, b) => a + b, 0) / values.length;
        }
      }
      
      if (formula.includes('MAX(')) {
        const columnName = formula.match(/MAX\(([^)]+)\)/)?.[1];
        if (columnName && dataset.dataTypes[columnName] === 'number') {
          const values = dataset.data.map(row => Number(row[columnName])).filter(v => !isNaN(v));
          if (values.length === 0) return null;
          return values.reduce((max, val) => val > max ? val : max, values[0]);
        }
      }
      
      if (formula.includes('MIN(')) {
        const columnName = formula.match(/MIN\(([^)]+)\)/)?.[1];
        if (columnName && dataset.dataTypes[columnName] === 'number') {
          const values = dataset.data.map(row => Number(row[columnName])).filter(v => !isNaN(v));
          if (values.length === 0) return null;
          return values.reduce((min, val) => val < min ? val : min, values[0]);
        }
      }
      
      if (formula.includes('COUNTROWS')) {
        return dataset.rowCount;
      }
      
      if (formula.includes('YEAR(')) {
        const columnName = formula.match(/YEAR\(([^)]+)\)/)?.[1];
        if (columnName && dataset.dataTypes[columnName] === 'date') {
          const years = dataset.data.map(row => new Date(row[columnName]).getFullYear()).filter(y => !isNaN(y));
          return [...new Set(years)].sort();
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error executing DAX calculation:', error);
      return null;
    }
  };

  // Generate Visualizations with optimization for large datasets
  const generateVisualizations = (dataset: Dataset): Visualization[] => {
    const visualizations: Visualization[] = [];
    const currentScheme = colorSchemes.find(s => s.name === selectedColorScheme) || colorSchemes[0];
    const numericColumns = dataset.columns.filter(col => col.type === 'number');
    const categoricalColumns = dataset.columns.filter(col => col.type === 'string');
    const dateColumns = dataset.columns.filter(col => col.type === 'date');

    // Check if dataset is too large
    const isLarge = isDatasetTooLarge(dataset);
    const sampleSize = isLarge ? Math.min(10000, dataset.rowCount) : dataset.rowCount;
    const step = isLarge && dataset.rowCount > 0 ? Math.ceil(dataset.rowCount / sampleSize) : 1;
    const dataToUse = isLarge
      ? dataset.data.filter((_, i) => i % step === 0)
      : dataset.data;

    // --- SMART COLUMN SELECTION ---
    // Helper: count unique values for a column
    const getUniqueCount = (colName: string): number => {
      const uniqueVals = new Set(dataToUse.slice(0, 2000).map(row => row[colName]));
      return uniqueVals.size;
    };

    // Helper: detect if a column name looks like an ID/key column
    const isLikelyIdColumn = (colName: string): boolean => {
      const lower = colName.toLowerCase();
      return (
        lower.endsWith('id') || lower.endsWith('_id') || lower === 'id' ||
        lower.includes('order id') || lower.includes('customer id') ||
        lower.includes('product id') || lower.includes('row id') ||
        lower.includes('postal') || lower.includes('zip') ||
        lower.includes('phone') || lower.includes('code') ||
        lower === 'index'
      );
    };

    // Helper: detect if a numeric column is likely an ID/row-number
    const isLikelyNumericId = (colName: string, data: any[]): boolean => {
      const lower = colName.toLowerCase();
      if (isLikelyIdColumn(colName)) return true;
      // Check if values are sequential integers (like Row ID)
      const sample = data.slice(0, 50).map(r => Number(r[colName]));
      const allIntegers = sample.every(v => Number.isInteger(v));
      if (allIntegers && sample.length > 10) {
        const sorted = [...sample].sort((a, b) => a - b);
        const diffs = sorted.slice(1).map((v, i) => v - sorted[i]);
        const allSameDiff = diffs.every(d => d === diffs[0]);
        if (allSameDiff && diffs[0] === 1) return true; // Sequential: 1,2,3,4...
      }
      return false;
    };

    // Score categorical columns: prefer low cardinality, non-ID columns
    const scoreCategoricalColumn = (col: { name: string; type: string }) => {
      const uniqueCount = getUniqueCount(col.name);
      const isId = isLikelyIdColumn(col.name);
      const ratio = dataToUse.length > 0 ? uniqueCount / Math.min(dataToUse.length, 2000) : 1;

      // Penalize: high cardinality, ID columns
      let score = 100;
      if (isId) score -= 80;
      if (uniqueCount > 50) score -= 40;
      else if (uniqueCount > 20) score -= 20;
      else if (uniqueCount <= 10) score += 20; // Sweet spot for pie/bar
      if (ratio > 0.5) score -= 30; // Too many unique values
      if (ratio > 0.8) score -= 30; // Almost all unique = likely ID
      // Bonus for common meaningful names
      const lower = col.name.toLowerCase();
      if (['category', 'region', 'segment', 'type', 'status', 'department', 'country', 'state', 'city', 'gender', 'class', 'group', 'tier', 'level', 'priority', 'ship mode', 'sub-category', 'sub_category'].some(n => lower.includes(n))) {
        score += 30;
      }
      return score;
    };

    // Score numeric columns: prefer meaningful measures over IDs
    const scoreNumericColumn = (col: { name: string; type: string }) => {
      let score = 100;
      if (isLikelyNumericId(col.name, dataToUse)) score -= 80;
      const lower = col.name.toLowerCase();
      // Bonus for common measure names
      if (['sales', 'revenue', 'profit', 'amount', 'price', 'cost', 'total', 'quantity', 'count', 'score', 'rating', 'discount', 'tax', 'weight', 'volume'].some(n => lower.includes(n))) {
        score += 30;
      }
      return score;
    };

    // Sort columns by relevance score
    const rankedCatColumns = [...categoricalColumns].sort((a, b) => scoreCategoricalColumn(b) - scoreCategoricalColumn(a));
    const rankedNumColumns = [...numericColumns].sort((a, b) => scoreNumericColumn(b) - scoreNumericColumn(a));

    // Pick best columns
    const bestCatCol = rankedCatColumns.length > 0 ? rankedCatColumns[0] : null;
    const secondCatCol = rankedCatColumns.length > 1 ? rankedCatColumns[1] : null;
    const bestNumCol = rankedNumColumns.length > 0 ? rankedNumColumns[0] : null;
    const secondNumCol = rankedNumColumns.length > 1 ? rankedNumColumns[1] : null;

    // Determine ideal max categories for pie chart (based on cardinality)
    const bestCatUniques = bestCatCol ? getUniqueCount(bestCatCol.name) : 0;
    const pieCatCol = bestCatUniques <= 12 ? bestCatCol : (secondCatCol && getUniqueCount(secondCatCol.name) <= 12 ? secondCatCol : bestCatCol);
    const pieMaxSlices = 10; // Max slices for readable pie chart

    // --- GENERATE VISUALIZATIONS ---

    // Bar Chart - requires both numeric and categorical columns
    if (bestNumCol && bestCatCol) {
      const categoryCol = bestCatCol;
      const valueCol = bestNumCol;

      const groupedData = dataToUse.reduce((acc, row) => {
        const category = String(row[categoryCol.name] || 'Other');
        const numValue = Number(row[valueCol.name]) || 0;
        acc[category] = (acc[category] || 0) + numValue;
        return acc;
      }, {} as Record<string, number>);

      const barData = Object.entries(groupedData)
        .map(([category, value]) => ({ category, value: Number(value) || 0 }))
        .sort((a, b) => (b.value as number) - (a.value as number))
        .slice(0, 25); // Top 25 for bar chart

      if (barData.length > 0) {
        visualizations.push({
          id: `bar-${dataset.id}`,
          title: `${valueCol.name} by ${categoryCol.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'bar',
          data: optimizeVisualizationData(barData, 'bar'),
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Pie Chart - use low-cardinality category column for meaningful slices
    if (pieCatCol) {
      const categoryCol = pieCatCol;
      let groupedData: Record<string, number>;

      if (bestNumCol) {
        const valueCol = bestNumCol;
        groupedData = dataToUse.reduce((acc, row) => {
          const category = String(row[categoryCol.name] || '');
          const numValue = Number(row[valueCol.name]) || 0;
          acc[category] = (acc[category] || 0) + numValue;
          return acc;
        }, {} as Record<string, number>);
      } else {
        groupedData = dataToUse.reduce((acc, row) => {
          const category = String(row[categoryCol.name] || '');
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }

      let pieEntries = Object.entries(groupedData)
        .filter(([category]) => category && category !== 'null' && category !== 'undefined' && category !== '')
        .sort((a, b) => b[1] - a[1]);

      // If too many slices, group small ones into "Other"
      if (pieEntries.length > pieMaxSlices) {
        const topSlices = pieEntries.slice(0, pieMaxSlices - 1);
        const otherValue = pieEntries.slice(pieMaxSlices - 1).reduce((sum, [, v]) => sum + v, 0);
        topSlices.push(['Other', otherValue]);
        pieEntries = topSlices;
      }

      const pieData = pieEntries.map(([category, value]) => ({ category, value }));

      if (pieData.length > 0) {
        visualizations.push({
          id: `pie-${dataset.id}`,
          title: bestNumCol
            ? `${bestNumCol.name} by ${categoryCol.name}${isLarge ? ' (Sampled)' : ''}`
            : `Distribution of ${categoryCol.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'pie',
          data: optimizeVisualizationData(pieData, 'pie'),
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Line Chart - Time series or sequential data (date + numeric columns)
    if (dateColumns.length > 0 && bestNumCol) {
      const dateCol = dateColumns[0];
      const valueCol = bestNumCol;

      // Aggregate by date for time series
      const dateAgg = dataToUse.reduce((acc, row) => {
        const dateVal = String(row[dateCol.name] || '');
        if (!dateVal || dateVal === 'null' || dateVal === 'undefined') return acc;
        const numValue = Number(row[valueCol.name]) || 0;
        acc[dateVal] = (acc[dateVal] || 0) + numValue;
        return acc;
      }, {} as Record<string, number>);

      const lineData = Object.entries(dateAgg)
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => new Date(a.category).getTime() - new Date(b.category).getTime())
        .slice(0, RENDERING_LIMITS.MAX_CHART_POINTS);

      if (lineData.length > 1) {
        visualizations.push({
          id: `line-${dataset.id}`,
          title: `${valueCol.name} over ${dateCol.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'line',
          data: optimizeVisualizationData(lineData, 'line'),
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Scatter Plot - Two meaningful numeric columns to show correlation
    if (bestNumCol && secondNumCol) {
      const col1 = bestNumCol;
      const col2 = secondNumCol;

      const scatterData = dataToUse
        .map(row => ({
          x: Number(row[col1.name]) || 0,
          y: Number(row[col2.name]) || 0,
          category: bestCatCol ? String(row[bestCatCol.name] || '') : ''
        }))
        .filter(d => !isNaN(d.x) && !isNaN(d.y))
        .slice(0, RENDERING_LIMITS.MAX_CHART_POINTS);

      if (scatterData.length > 1) {
        visualizations.push({
          id: `scatter-${dataset.id}`,
          title: `${col1.name} vs ${col2.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'scatter',
          data: scatterData,
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Area Chart - Multiple numeric series over time or categories
    if (bestNumCol && secondNumCol && (dateColumns.length > 0 || bestCatCol)) {
      const axisCol = dateColumns.length > 0 ? dateColumns[0] : bestCatCol!;
      const valueCol1 = bestNumCol;
      const valueCol2 = secondNumCol;

      // Aggregate by axis for cleaner area chart
      const areaAgg: Record<string, { v1: number; v2: number }> = {};
      dataToUse.forEach(row => {
        const key = String(row[axisCol.name] || '');
        if (!key || key === 'null' || key === 'undefined') return;
        if (!areaAgg[key]) areaAgg[key] = { v1: 0, v2: 0 };
        areaAgg[key].v1 += Number(row[valueCol1.name]) || 0;
        areaAgg[key].v2 += Number(row[valueCol2.name]) || 0;
      });

      let areaData = Object.entries(areaAgg)
        .map(([category, vals]) => ({
          category,
          value: vals.v1,
          value2: vals.v2
        }));

      // Sort by date if axis is date column
      if (dateColumns.length > 0) {
        areaData.sort((a, b) => new Date(a.category).getTime() - new Date(b.category).getTime());
      } else {
        areaData.sort((a, b) => (b.value + b.value2) - (a.value + a.value2));
      }
      areaData = areaData.slice(0, RENDERING_LIMITS.MAX_CHART_POINTS);

      if (areaData.length > 1) {
        visualizations.push({
          id: `area-${dataset.id}`,
          title: `${valueCol1.name} & ${valueCol2.name} by ${axisCol.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'area',
          data: optimizeVisualizationData(areaData, 'area'),
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Count Chart - For categorical-only datasets, show count by category
    if (categoricalColumns.length > 0 && numericColumns.length === 0 && bestCatCol) {
      const categoryCol = bestCatCol;

      const countData = dataToUse.reduce((acc, row) => {
        const category = String(row[categoryCol.name] || 'Unknown');
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const countChartData = Object.entries(countData)
        .filter(([category]) => category && category !== 'null' && category !== 'undefined' && category !== '')
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => (b.value as number) - (a.value as number))
        .slice(0, 25);

      if (countChartData.length > 0) {
        visualizations.push({
          id: `count-bar-${dataset.id}`,
          title: `Count by ${categoryCol.name}${isLarge ? ' (Sampled)' : ''}`,
          type: 'bar',
          data: optimizeVisualizationData(countChartData, 'bar'),
          colors: currentScheme.colors,
          gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
          daxCalculations: [],
          datasetId: dataset.id
        });
      }
    }

    // Table View - Always generate regardless of data types
    visualizations.push({
      id: `table-${dataset.id}`,
      title: `Data Table - ${dataset.name}`,
      type: 'table',
      data: dataset.data,
      colors: currentScheme.colors,
      gradient: `linear-gradient(135deg, ${currentScheme.colors[0]}, ${currentScheme.colors[1]})`,
      daxCalculations: [],
      datasetId: dataset.id
    });

    return visualizations;
  };

  // Join datasets using relationships
  const joinDatasets = (baseDataset: Dataset, relationships: Relationship[]): any[] => {
    let joinedData = [...baseDataset.data];
    
    // Filter relationships by schema type to prevent mixing star and snowflake
    const filteredRelationships = relationships.filter(rel => {
      if (schemaType === 'none') return true; // Allow all if no schema selected
      return rel.schemaType === schemaType;
    });
    
    filteredRelationships.forEach(rel => {
      if (rel.fromDataset === baseDataset.id) {
        const relatedDataset = datasets.find(d => d.id === rel.toDataset);
        if (relatedDataset) {
          const lookup = new Map();
          relatedDataset.data.forEach(row => {
            const key = String(row[rel.toColumn]).toLowerCase();
            if (!lookup.has(key)) {
              lookup.set(key, []);
            }
            lookup.get(key).push(row);
          });

          joinedData = joinedData.map(baseRow => {
            const key = String(baseRow[rel.fromColumn]).toLowerCase();
            const relatedRows = lookup.get(key) || [];
            
            if (relatedRows.length === 1) {
              return { ...baseRow, ...relatedRows[0] };
            } else if (relatedRows.length > 1) {
              // For one-to-many, create multiple rows
              return relatedRows.map(relatedRow => ({ ...baseRow, ...relatedRow }));
            }
            return baseRow;
          }).flat();
        }
      }
    });

    return joinedData;
  };

  // Auto-analysis pipeline: runs automatically when new datasets are added
  const runAutoAnalysisPipeline = useCallback(async (allDatasets: Dataset[]) => {
    if (allDatasets.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setIsUploading(true);
    setUploadStage('processing');
    setUploadProgress(0);
    setUploadMessage('Starting auto-analysis...');

    try {
      await yieldToBrowser();

      // Step 1: Schema Detection (only if 2+ datasets)
      setUploadProgress(5);
      setUploadMessage('Detecting data schema...');
      await yieldToBrowser();

      let detectedSchema: SchemaDetectionResult | null = null;

      if (allDatasets.length >= 2) {
        detectedSchema = detectSchema(allDatasets);
        setAutoDetectedSchema(detectedSchema);

        // Auto-set schema type
        const newSchemaType = detectedSchema.schemaType === 'flat' || detectedSchema.schemaType === 'none'
          ? 'none'
          : detectedSchema.schemaType;
        setSchemaType(newSchemaType);

        // Auto-create relationships from high-confidence detections
        if (detectedSchema.relationships.length > 0) {
          const autoRelationships: Relationship[] = detectedSchema.relationships
            .filter((r: any) => r.autoJoinRecommended || r.matchScore > 0.5)
            .map((r: any, i: number) => ({
              id: `auto-rel-${Date.now()}-${i}`,
              fromDataset: r.fromDataset,
              toDataset: r.toDataset,
              fromColumn: r.fromColumn,
              toColumn: r.toColumn,
              type: r.type,
              confidence: r.confidence,
              schemaType: newSchemaType === 'none' ? undefined : newSchemaType as 'star' | 'snowflake',
              isFactTable: detectedSchema!.factTables.some(f => f.datasetId === r.fromDataset),
              isDimensionTable: detectedSchema!.dimensionTables.some(d => d.datasetId === r.toDataset)
            }));

          if (autoRelationships.length > 0) {
            setRelationships(prev => {
              const manualRels = prev.filter(r => !r.id.startsWith('auto-rel-'));
              return [...manualRels, ...autoRelationships];
            });
          }
        }

        if (detectedSchema.schemaType !== 'none' && detectedSchema.schemaType !== 'flat') {
          toast.success(
            `Detected ${detectedSchema.schemaType} schema: ` +
            `${detectedSchema.factTables.length} fact table(s), ` +
            `${detectedSchema.dimensionTables.length} dimension table(s)`
          );
        }
      }

      // Step 2: Generate DAX calculations
      setUploadProgress(20);
      setUploadMessage('Generating DAX calculations...');
      await yieldToBrowser();

      const allCalculations: DAXCalculation[] = [];
      for (const dataset of allDatasets) {
        const calculations = generateDAXCalculations(dataset);
        const executedCalculations = calculations.map(calc => ({
          ...calc,
          result: executeDAXCalculation(calc, dataset)
        }));
        allCalculations.push(...executedCalculations);
      }
      setDaxCalculations(allCalculations);
      await yieldToBrowser();

      // Step 3: Generate smart visualizations
      setUploadProgress(45);
      setUploadMessage('Creating visualizations...');
      await yieldToBrowser();

      const allVisualizations: Visualization[] = [];
      for (const dataset of allDatasets) {
        const datasetVisualizations = generateVisualizations(dataset);
        allVisualizations.push(...datasetVisualizations);
      }
      setVisualizations(allVisualizations);
      await yieldToBrowser();

      // Step 4: Detect date tables and run time series analysis
      setUploadProgress(55);
      setUploadMessage('Detecting date tables & time series...');
      await yieldToBrowser();

      try {
        const detectedDateTables = detectDateTables(allDatasets);
        setDateTableInfos(detectedDateTables);

        const primaryDataset = allDatasets.find(d => d.id === activeDataset) || allDatasets[0];
        if (primaryDataset) {
          const tsResults = autoDetectTimeSeries(primaryDataset);
          setTimeSeriesResults(tsResults);
        }
      } catch (err) {
        console.warn('Time series analysis failed:', err);
      }
      await yieldToBrowser();

      // Step 5: Run advanced statistics
      setUploadProgress(68);
      setUploadMessage('Running advanced statistics...');
      await yieldToBrowser();

      try {
        const primaryDataset = allDatasets.find(d => d.id === activeDataset) || allDatasets[0];
        if (primaryDataset) {
          const advStats = autoAdvancedAnalysis(primaryDataset);
          setAdvancedStatsResults(advStats);
        }
      } catch (err) {
        console.warn('Advanced statistics failed:', err);
      }
      await yieldToBrowser();

      // Step 6: Run enhanced AI analysis on primary dataset
      setUploadProgress(80);
      setUploadMessage('Running enhanced AI analysis...');
      await yieldToBrowser();

      const primaryDataset = allDatasets.find(d => d.id === activeDataset) || allDatasets[0];
      if (primaryDataset) {
        try {
          const insights = await runEnhancedAIAnalysis(
            primaryDataset,
            allDatasets,
            relationships,
            (progress, message) => {
              setUploadProgress(80 + Math.round(progress * 0.15));
              setUploadMessage(message);
            }
          );
          setAiInsights(insights);
          if (insights.executiveSummary) {
            setInterpretation(insights.executiveSummary);
          }
        } catch (err) {
          console.warn('Enhanced AI analysis failed, falling back to basic:', err);
          try {
            const basicInsights = runAIAnalysis(primaryDataset);
            setAiInsights(basicInsights);
            if (basicInsights.executiveSummary) {
              setInterpretation(basicInsights.executiveSummary);
            }
          } catch (err2) {
            console.warn('Basic AI analysis also failed:', err2);
          }
        }
      }

      // Step 7: Complete
      setUploadProgress(100);
      setUploadStage('complete');
      setUploadMessage('Auto-analysis complete!');

      await new Promise(resolve => setTimeout(resolve, 500));

      setIsUploading(false);
      toast.success('Auto-analysis completed: visualizations, insights, and schema ready!');
    } catch (error) {
      console.error('Auto-analysis pipeline error:', error);
      setIsUploading(false);
      // Non-fatal: user can still interact manually
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        setUploadProgress(0);
        setUploadStage('uploading');
        setUploadMessage('');
      }, 1000);
    }
  }, [isProcessing, activeDataset, selectedColorScheme]);

  // Use a ref to always have the latest datasets available for the pipeline
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  // Auto-trigger pipeline when new datasets are added
  useEffect(() => {
    if (datasets.length > prevDatasetCount.current && datasets.length > 0) {
      prevDatasetCount.current = datasets.length;
      // Delay to let React state settle (activeDataset, isUploading, etc.)
      const timer = setTimeout(() => {
        // Use ref to get the latest datasets at execution time
        runAutoAnalysisPipeline(datasetsRef.current);
      }, 600);
      return () => clearTimeout(timer);
    }
    prevDatasetCount.current = datasets.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets.length]);

  // Process Data with proper loading states
  const processData = async () => {
    if (datasets.length === 0) {
      toast.error('Please upload at least one dataset');
      return;
    }
    
    setIsProcessing(true);
    setIsUploading(true);
    setUploadStage('processing');
    setUploadProgress(0);
    setUploadMessage('Preparing data analysis...');
    
    try {
      await yieldToBrowser();
      
      // Stage 1: Generate DAX calculations
      setUploadProgress(10);
      setUploadMessage('Generating DAX calculations...');
      
      const allCalculations: DAXCalculation[] = [];
      const totalDatasets = datasets.length;
      
      for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        setUploadProgress(10 + (i / totalDatasets) * 30);
        setUploadMessage(`Processing dataset ${i + 1}/${totalDatasets}: ${dataset.name}...`);
        await yieldToBrowser();
        
        // If relationships exist, join data
        const datasetRelationships = relationships.filter(r => 
          r.fromDataset === dataset.id || r.toDataset === dataset.id
        );
        
        let workingData = dataset.data;
        if (datasetRelationships.length > 0 && schemaType !== 'none') {
          workingData = joinDatasets(dataset, datasetRelationships.filter(r => r.fromDataset === dataset.id));
        }
        
        const workingDataset = { ...dataset, data: workingData };
        const calculations = generateDAXCalculations(workingDataset);
        const executedCalculations = calculations.map(calc => ({
          ...calc,
          result: executeDAXCalculation(calc, workingDataset)
        }));
        allCalculations.push(...executedCalculations);
      }
      
      setDaxCalculations(allCalculations);
      await yieldToBrowser();

      // Stage 2: Execute custom DAX calculations
      setUploadProgress(45);
      setUploadMessage('Executing custom calculations...');
      
      const executedCustomCalculations = customDAXCalculations.map(calc => {
        const dataset = datasets.find(d => d.id === activeDataset) || datasets[0];
        if (dataset) {
          const datasetRelationships = relationships.filter(r => {
            const matchesDataset = r.fromDataset === dataset.id || r.toDataset === dataset.id;
            const matchesSchema = schemaType === 'none' || r.schemaType === schemaType;
            return matchesDataset && matchesSchema;
          });
          
          let workingData = dataset.data;
          if (datasetRelationships.length > 0 && schemaType !== 'none') {
            workingData = joinDatasets(dataset, datasetRelationships.filter(r => r.fromDataset === dataset.id));
          }
          
          const workingDataset = { ...dataset, data: workingData };
          return {
            ...calc,
            result: executeDAXCalculation(calc, workingDataset)
          };
        }
        return calc;
      });
      setCustomDAXCalculations(executedCustomCalculations);
      await yieldToBrowser();
      
      // Stage 3: Generate visualizations
      setUploadProgress(60);
      setUploadMessage('Generating visualizations...');
      
      const allVisualizations: Visualization[] = [];
      
      for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        setUploadProgress(60 + (i / totalDatasets) * 30);
        setUploadMessage(`Creating visualizations for ${dataset.name}...`);
        await yieldToBrowser();
        
        const datasetRelationships = relationships.filter(r => {
          const matchesDataset = r.fromDataset === dataset.id || r.toDataset === dataset.id;
          const matchesSchema = schemaType === 'none' || r.schemaType === schemaType;
          return matchesDataset && matchesSchema;
        });
        
        let workingData = dataset.data;
        if (datasetRelationships.length > 0 && schemaType !== 'none') {
          workingData = joinDatasets(dataset, datasetRelationships.filter(r => r.fromDataset === dataset.id));
        }
        
        const workingDataset = { ...dataset, data: workingData };
        const datasetVisualizations = generateVisualizations(workingDataset);
        allVisualizations.push(...datasetVisualizations);
      }
      
      setVisualizations(allVisualizations);
      
      // Stage 4: Complete
      setUploadProgress(100);
      setUploadStage('complete');
      setUploadMessage('Analysis complete!');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setIsUploading(false);
      toast.success('Data analysis completed successfully!');
    } catch (error) {
      setIsUploading(false);
      console.error('Error processing data:', error);
      toast.error('Error processing data');
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        setUploadProgress(0);
        setUploadStage('uploading');
        setUploadMessage('');
      }, 1000);
    }
  };

  const getVisualizationIcon = (type: string) => {
    switch (type) {
      case 'bar': return <BarChart3 className="h-6 w-6" />;
      case 'line': return <LineChartIcon className="h-6 w-6" />;
      case 'pie': return <PieChartIcon className="h-6 w-6" />;
      case 'scatter': return <ChartScatter className="h-6 w-6" />;
      case 'area': return <AreaChartIcon className="h-6 w-6" />;
      case 'table': return <Table className="h-6 w-6" />;
      case 'gauge': return <Gauge className="h-6 w-6" />;
      default: return <BarChart3 className="h-6 w-6" />;
    }
  };

  // Note: Visualization rendering is handled by the shared renderVisualization()
  // from @/lib/visualizationRenderer.tsx, used by ResizableVisualization and ZoomableVisualization

  const activeDs = datasets.find(d => d.id === activeDataset) || datasets[0];
  const performanceWarning = activeDs ? getPerformanceWarning(activeDs) : null;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 pt-24 pb-8" style={{ position: 'relative', zIndex: 1 }}>
        {/* Data Processing Overlay */}
        <DataProcessingOverlay
          isVisible={isUploading}
          stage={uploadStage}
          progress={uploadProgress}
          message={uploadMessage}
          fileSize={activeDs?.file?.size}
          rowCount={activeDs?.rowCount}
        />
        
        {/* Performance Warning */}
        {performanceWarning && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800">Performance Notice</p>
                <p className="text-sm text-orange-700 mt-1">{performanceWarning}</p>
                <p className="text-xs text-orange-600 mt-2">
                  Large datasets are automatically optimized: tables are paginated, charts show sampled data, and some features may be limited.
                </p>
              </div>
            </div>
          </div>
        )}
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent mb-4">
            AI-Powered Data Intelligence Platform
          </h1>
          <p className="text-xl text-gray-600 max-w-4xl mx-auto mb-6">
            Transform your data into actionable insights instantly. Ask questions in plain English, 
            auto-discover patterns and correlations, connect multiple data streams, and visualize trends 
            that the human eye might miss.
          </p>
          <div className="flex justify-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1 px-3 py-1 bg-violet-50 rounded-full">
              <Zap className="h-4 w-4 text-violet-500" /> AI-Powered Analysis
            </span>
            <span className="flex items-center gap-1 px-3 py-1 bg-blue-50 rounded-full">
              <FileText className="h-4 w-4 text-blue-500" /> Natural Language Queries
            </span>
            <span className="flex items-center gap-1 px-3 py-1 bg-emerald-50 rounded-full">
              <Link className="h-4 w-4 text-emerald-500" /> Auto-Connect Data
            </span>
            <span className="flex items-center gap-1 px-3 py-1 bg-pink-50 rounded-full">
              <TrendingUp className="h-4 w-4 text-pink-500" /> Pattern Detection
            </span>
          </div>
        </div>

        {/* Analytics Dashboard Layout - Matching Wireframe */}
        <AnalyticsDashboard
          datasets={datasets}
          visualizations={visualizations}
          onFileUpload={handleFileUpload}
          onDatasetSelect={setActiveDataset}
          activeDatasetId={activeDataset}
          onAnalyze={processData}
          isProcessing={isProcessing}
          schemaInfo={autoDetectedSchema}
        />

        {/* Keep tabs for advanced features */}
        <Tabs defaultValue="ai-insights" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <TabsList className="flex flex-wrap gap-1 w-full h-auto p-1">
              <TabsTrigger value="ai-insights" className="flex items-center gap-1 text-xs">
                <Zap className="h-3 w-3" />
                AI Insights
              </TabsTrigger>
              <TabsTrigger value="time-series" className="flex items-center gap-1 text-xs">
                <LineChartIcon className="h-3 w-3" />
                Time Series
              </TabsTrigger>
              <TabsTrigger value="advanced-stats" className="flex items-center gap-1 text-xs">
                <BarChart3 className="h-3 w-3" />
                Advanced Stats
              </TabsTrigger>
              <TabsTrigger value="ask-data" className="flex items-center gap-1 text-xs">
                <FileText className="h-3 w-3" />
                Ask Data
              </TabsTrigger>
              <TabsTrigger value="connections" className="flex items-center gap-1 text-xs">
                <Link className="h-3 w-3" />
                Connections
              </TabsTrigger>
              <TabsTrigger value="clean" className="text-xs">Data Cleaning</TabsTrigger>
              <TabsTrigger value="explore" className="text-xs">Explore Data</TabsTrigger>
              <TabsTrigger value="analysis" className="text-xs">DAX Analysis</TabsTrigger>
              <TabsTrigger value="visualizations" className="text-xs">Visualizations</TabsTrigger>
              <TabsTrigger value="relationships" className="text-xs">Relationships</TabsTrigger>
            </TabsList>
            {datasets.length > 0 && (
              <Button
                onClick={async () => {
                  if (isGeneratingPDF) return;

                  // Require authentication for paid PDF checkout.
                  if (!user) {
                    setShowPaywall(true);
                    return;
                  }

                  const hasAccess = await hasPaidPDFAccess();
                  if (!hasAccess) {
                    setShowPaywall(true);
                    return;
                  }

                  const activeDs = datasets.find(d => d.id === activeDataset) || datasets[0];
                  
                  // Check if dataset is too large for PDF
                  if (activeDs && shouldCancelOperation(activeDs, 'pdf')) {
                    toast.error(
                      `Dataset too large (${activeDs.rowCount.toLocaleString()} rows). ` +
                      `PDF generation is limited to datasets under 100MB for performance. ` +
                      `Please use data export or filter the dataset first.`
                    );
                    return;
                  }
                  
                  setIsGeneratingPDF(true);
                  try {
                    const kpis = activeDs ? [
                      { title: 'Total Records', value: activeDs.rowCount.toLocaleString() },
                      { title: 'Total Columns', value: activeDs.columns.length.toString() },
                      { title: 'Data Quality', value: aiInsights ? `${aiInsights.dataQualityScore}%` : 'N/A' },
                      { title: 'AI Insights', value: aiInsights ? aiInsights.totalInsights.toString() : '0' }
                    ] : [];
                    
                    // Collect visualization elements for image capture (limit to first 6 for speed/reliability)
                    const chartElements = new Map<string, HTMLElement>();
                    visualizations.slice(0, 6).forEach((viz, index) => {
                      const possibleIds = [
                        `viz-${viz.id}`,
                        `chart-${viz.id}`,
                        `visualization-${index}`,
                        `viz-panel-row1-${index}`,
                        `viz-panel-row2-${index}`
                      ];
                      
                      for (const id of possibleIds) {
                        const element = document.getElementById(id) || 
                                      document.querySelector(`[data-viz-id="${viz.id}"]`) as HTMLElement;
                        if (element) {
                          chartElements.set(id, element);
                          break;
                        }
                      }
                    });
                    
                    toast.info('Generating PDF with visualizations and AI insights...');
                    
                    // Limit data and visualization count for faster, more reliable PDF generation.
                    await generateEnhancedPDF({
                      datasets: datasets.map(ds => ({
                        name: ds.name,
                        rowCount: ds.rowCount,
                        columns: ds.columns.map(c => c.name),
                        sampleData: ds.data.slice(0, Math.min(50, ds.rowCount)).map(row => 
                          ds.columns.map(col => String(row[col.name] || ''))
                        )
                      })),
                      kpis,
                      visualizations: visualizations.slice(0, 6),
                      daxCalculations: [...daxCalculations, ...customDAXCalculations].slice(0, 20).map(c => ({
                        name: c.name,
                        formula: c.formula,
                        result: c.result
                      })),
                      relationships: relationships.map(r => {
                        const fromDs = datasets.find(d => d.id === r.fromDataset);
                        const toDs = datasets.find(d => d.id === r.toDataset);
                        return {
                          from: `${fromDs?.name || r.fromDataset}.${r.fromColumn}`,
                          to: `${toDs?.name || r.toDataset}.${r.toColumn}`,
                          type: r.type,
                          role: r.isFactTable ? 'Fact → Dimension' : '',
                          confidence: r.confidence
                        };
                      }),
                      interpretation: interpretation || aiInsights?.executiveSummary || '',
                      aiInsights: aiInsights,
                      datasetsFull: datasets.map(ds => ({
                        ...ds,
                        data: ds.data.slice(0, RENDERING_LIMITS.MAX_PDF_ROWS)
                      })),
                      schemaInfo: autoDetectedSchema && autoDetectedSchema.schemaType !== 'none' && autoDetectedSchema.schemaType !== 'flat' ? {
                        schemaType: autoDetectedSchema.schemaType,
                        confidence: autoDetectedSchema.confidence,
                        factTables: autoDetectedSchema.factTables.map(f => ({ name: f.datasetName, rowCount: f.metrics.rowCount })),
                        dimensionTables: autoDetectedSchema.dimensionTables.map(d => ({ name: d.datasetName, rowCount: d.metrics.rowCount })),
                        explanation: autoDetectedSchema.explanation
                      } : undefined
                    }, `Data_Analysis_Report_${activeDs?.name || 'All_Datasets'}`, chartElements);
                    
                    toast.success('PDF report generated successfully with visualizations and insights!');
                  } catch (error) {
                    console.error('PDF generation error:', error);
                    toast.error('Failed to generate PDF. The dataset may be too large. Try filtering or sampling the data first.');
                  } finally {
                    setIsGeneratingPDF(false);
                  }
                }}
                variant="outline"
                className="ml-4"
                disabled={isGeneratingPDF}
              >
                {isGeneratingPDF ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download Enhanced PDF Report
                  </>
                )}
              </Button>
            )}
          </div>

          {/* AI Insights Tab - NEW */}
          <TabsContent value="ai-insights" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AIInsightsPanel
                dataset={datasets.find(d => d.id === activeDataset) || datasets[0] || null}
                onInsightsGenerated={(insights) => {
                  setAiInsights(insights);
                  if (insights.executiveSummary) {
                    setInterpretation(insights.executiveSummary);
                  }
                }}
                onDatasetUpdate={(cleanedDataset) => {
                  const activeDs = datasets.find(d => d.id === activeDataset) || datasets[0];
                  if (activeDs) {
                    setDatasets(prev => prev.map(d => 
                      d.id === activeDs.id ? cleanedDataset : d
                    ));
                    toast.success('Dataset cleaned successfully! Data quality improved.');
                  }
                }}
              />
              <CorrelationMatrix
                dataset={datasets.find(d => d.id === activeDataset) || datasets[0] || null}
              />
            </div>
            
            {/* Quick Stats from AI Analysis */}
            {aiInsights && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    AI-Generated Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {aiInsights.recommendations.map((rec, index) => (
                      <Card key={index} className="p-4 bg-gradient-to-br from-violet-50 to-white border-violet-100">
                        <p className="text-sm text-gray-700">{rec}</p>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Time Series Tab - Phase B */}
          <TabsContent value="time-series" className="space-y-6">
            {timeSeriesResults.length > 0 ? (
              <div className="space-y-6">
                {/* Date Tables Detection */}
                {dateTableInfos.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-blue-500" />
                        Date Tables Detected
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {dateTableInfos.map((dt, i) => (
                          <Card key={i} className="p-4 bg-gradient-to-br from-blue-50 to-white border-blue-100">
                            <p className="font-semibold text-sm">{dt.datasetName} / {dt.columnName}</p>
                            <p className="text-xs text-gray-500 mt-1">Frequency: {dt.frequency} | Coverage: {(dt.coverage * 100).toFixed(0)}%</p>
                            <p className="text-xs text-gray-500">Range: {dt.dateRange[0]} to {dt.dateRange[1]}</p>
                            <Badge variant={dt.isDateTable ? "default" : "secondary"} className="mt-2 text-xs">
                              {dt.isDateTable ? 'Date Dimension' : 'Date Column'}
                            </Badge>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Time Series Results */}
                {timeSeriesResults.map((ts, idx) => (
                  <Card key={idx}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" />
                        {ts.column} — Time Series Analysis
                        <Badge variant="outline" className="ml-2">{ts.frequency}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Trend Chart */}
                        <div>
                          <h4 className="text-sm font-medium mb-3">Trend & Moving Average</h4>
                          <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={ts.trend.slice(0, 100).map((val, i) => ({
                              idx: i,
                              trend: Math.round(val * 100) / 100,
                              movingAvg: ts.movingAverage[i] ? Math.round(ts.movingAverage[i] * 100) / 100 : null
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip />
                              <Legend />
                              <Line type="monotone" dataKey="trend" stroke={SHARED_CHART_PALETTE[0]} dot={false} name="Trend" />
                              <Line type="monotone" dataKey="movingAvg" stroke={SHARED_CHART_PALETTE[1]} dot={false} name="Moving Avg" strokeDasharray="5 5" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Forecast Chart */}
                        {ts.forecast.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium mb-3">Forecast ({ts.forecast.length} periods)</h4>
                            <ResponsiveContainer width="100%" height={250}>
                              <AreaChart data={ts.forecast.map((fp, i) => ({
                                period: `+${i + 1}`,
                                forecast: Math.round(fp.value * 100) / 100,
                                lower: Math.round((fp.lower || fp.value * 0.9) * 100) / 100,
                                upper: Math.round((fp.upper || fp.value * 1.1) * 100) / 100
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Legend />
                                <Area type="monotone" dataKey="upper" stroke="transparent" fill={SHARED_CHART_PALETTE[0]} fillOpacity={0.1} name="Upper Bound" />
                                <Area type="monotone" dataKey="lower" stroke="transparent" fill={SHARED_CHART_PALETTE[0]} fillOpacity={0.1} name="Lower Bound" />
                                <Line type="monotone" dataKey="forecast" stroke={SHARED_CHART_PALETTE[3]} strokeWidth={2} name="Forecast" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Growth Rates */}
                        {ts.growthRates.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium mb-3">Growth Rates</h4>
                            <ResponsiveContainer width="100%" height={250}>
                              <BarChart data={ts.growthRates.slice(0, 20).map((gr) => ({
                                period: gr.period,
                                change: Math.round(gr.percentageChange * 100) / 100
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={60} />
                                <YAxis tick={{ fontSize: 10 }} />
                                <Tooltip formatter={(value: any) => `${value}%`} />
                                <Bar dataKey="change" name="Growth %" fill={SHARED_CHART_PALETTE[4]}>
                                  {ts.growthRates.slice(0, 20).map((gr, i) => (
                                    <Cell key={i} fill={gr.percentageChange >= 0 ? POSITIVE_CHART_COLOR : NEGATIVE_CHART_COLOR} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Seasonality Info */}
                        <div className="p-4 bg-gradient-to-br from-indigo-50 to-white rounded-lg border">
                          <h4 className="text-sm font-medium mb-2">Analysis Summary</h4>
                          <div className="space-y-2 text-sm text-gray-600">
                            <p><span className="font-medium">Seasonality:</span> {ts.seasonalityStrength > 0.3 ? `Detected (strength: ${(ts.seasonalityStrength * 100).toFixed(0)}%)` : 'Not significant'}</p>
                            <p><span className="font-medium">Data Points:</span> {ts.trend.length}</p>
                            <p><span className="font-medium">Date Column:</span> {ts.dateColumn}</p>
                            {ts.forecast.length > 0 && (
                              <p><span className="font-medium">Next Period Forecast:</span> {Math.round(ts.forecast[0].value).toLocaleString()}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <LineChartIcon className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-semibold text-gray-500">No Time Series Data Detected</h3>
                <p className="text-sm text-gray-400 mt-2">Upload data with date columns and numeric values to see time series analysis, trend decomposition, and forecasts.</p>
              </Card>
            )}
          </TabsContent>

          {/* Advanced Statistics Tab - Phase B */}
          <TabsContent value="advanced-stats" className="space-y-6">
            {advancedStatsResults ? (
              <div className="space-y-6">
                {/* Clustering Results */}
                {advancedStatsResults.clustering && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-purple-500" />
                        Data Segmentation (K-Means Clustering)
                        <Badge variant="outline" className="ml-2">
                          {advancedStatsResults.clustering.optimalK} Segments
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-gray-600 mb-4">{advancedStatsResults.clustering.interpretation}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {advancedStatsResults.clustering.clusters.map((cluster: any) => (
                          <Card key={cluster.clusterId} className="p-4 bg-gradient-to-br from-purple-50 to-white border-purple-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-semibold text-sm">Segment {cluster.clusterId + 1}</span>
                              <Badge>{cluster.size} records</Badge>
                            </div>
                            <p className="text-xs text-gray-500">{cluster.characteristics}</p>
                          </Card>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-3">Silhouette Score: {advancedStatsResults.clustering.silhouetteScore.toFixed(3)} (higher = better separation)</p>
                    </CardContent>
                  </Card>
                )}

                {/* Pareto Analysis */}
                {advancedStatsResults.pareto && advancedStatsResults.pareto.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <PieChartIcon className="h-5 w-5 text-orange-500" />
                        Pareto Analysis (80/20 Rule)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {advancedStatsResults.pareto.slice(0, 3).map((p: any, idx: number) => (
                          <div key={idx}>
                            <p className="text-sm font-medium mb-2">{p.column} by {p.valueColumn}</p>
                            <p className="text-sm text-gray-600 mb-3">{p.interpretation}</p>
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={p.items.slice(0, 15).map((item: any) => ({
                                name: String(item.category).substring(0, 15),
                                value: Math.round(item.value),
                                cumPercent: Math.round(item.cumulativePercent * 100)
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={60} />
                                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} />
                                <Tooltip />
                                <Legend />
                                <Bar yAxisId="left" dataKey="value" fill={SHARED_CHART_PALETTE[2]} name="Value">
                                  {p.items.slice(0, 15).map((item: any, i: number) => (
                                    <Cell key={i} fill={item.isVital ? SHARED_CHART_PALETTE[2] : '#D1D5DB'} />
                                  ))}
                                </Bar>
                                <Line yAxisId="right" type="monotone" dataKey="cumPercent" stroke={SHARED_CHART_PALETTE[3]} strokeWidth={2} name="Cumulative %" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Regression Results */}
                {advancedStatsResults.regression && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ChartScatter className="h-5 w-5 text-blue-500" />
                        Multiple Regression Analysis
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">{advancedStatsResults.regression.interpretation}</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <Card className="p-3 text-center bg-blue-50 border-blue-100">
                            <p className="text-xs text-gray-500">R-Squared</p>
                            <p className="text-lg font-bold text-blue-600">{(advancedStatsResults.regression.rSquared * 100).toFixed(1)}%</p>
                          </Card>
                          <Card className="p-3 text-center bg-green-50 border-green-100">
                            <p className="text-xs text-gray-500">Adj. R-Squared</p>
                            <p className="text-lg font-bold text-green-600">{(advancedStatsResults.regression.adjustedRSquared * 100).toFixed(1)}%</p>
                          </Card>
                          <Card className="p-3 text-center bg-purple-50 border-purple-100">
                            <p className="text-xs text-gray-500">Predictors</p>
                            <p className="text-lg font-bold text-purple-600">{advancedStatsResults.regression.predictorColumns.length}</p>
                          </Card>
                          <Card className="p-3 text-center bg-orange-50 border-orange-100">
                            <p className="text-xs text-gray-500">Significant</p>
                            <p className="text-lg font-bold text-orange-600">{advancedStatsResults.regression.significantPredictors.length}</p>
                          </Card>
                        </div>
                        <p className="text-xs text-gray-500 font-mono mt-2">{advancedStatsResults.regression.equation}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Non-linear Correlations */}
                {advancedStatsResults.nonLinearCorrelations && advancedStatsResults.nonLinearCorrelations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-yellow-500" />
                        Non-Linear Correlations Detected
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {advancedStatsResults.nonLinearCorrelations.slice(0, 6).map((nlc: any, idx: number) => (
                          <Card key={idx} className={`p-3 ${nlc.isNonLinear ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{nlc.column1} vs {nlc.column2}</span>
                              {nlc.isNonLinear && <Badge variant="secondary" className="text-xs bg-yellow-100">Non-Linear</Badge>}
                            </div>
                            <p className="text-xs text-gray-500">Pearson: {nlc.pearsonCoefficient.toFixed(3)} | Spearman: {nlc.spearmanCoefficient.toFixed(3)}</p>
                            <p className="text-xs text-gray-600 mt-1">{nlc.interpretation}</p>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Confidence Intervals & Percentiles */}
                {advancedStatsResults.confidenceIntervals && advancedStatsResults.confidenceIntervals.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Gauge className="h-5 w-5 text-teal-500" />
                        Confidence Intervals & Percentiles
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2">Column</th>
                              <th className="text-right p-2">Mean</th>
                              <th className="text-right p-2">95% CI Lower</th>
                              <th className="text-right p-2">95% CI Upper</th>
                              <th className="text-right p-2">Margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {advancedStatsResults.confidenceIntervals.slice(0, 10).map((ci: any, idx: number) => (
                              <tr key={idx} className="border-b hover:bg-gray-50">
                                <td className="p-2 font-medium">{ci.column || `Column ${idx + 1}`}</td>
                                <td className="text-right p-2">{ci.mean.toFixed(2)}</td>
                                <td className="text-right p-2 text-blue-600">{ci.lower.toFixed(2)}</td>
                                <td className="text-right p-2 text-blue-600">{ci.upper.toFixed(2)}</td>
                                <td className="text-right p-2 text-gray-500">{'\u00B1'}{ci.margin.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <BarChart3 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-semibold text-gray-500">No Advanced Statistics Yet</h3>
                <p className="text-sm text-gray-400 mt-2">Upload data with numeric columns to see clustering, regression, Pareto analysis, hypothesis tests, and more.</p>
              </Card>
            )}
          </TabsContent>

          {/* Ask Your Data Tab - Natural Language Query - NEW */}
          <TabsContent value="ask-data" className="space-y-6">
            <NaturalLanguageQuery
              dataset={datasets.find(d => d.id === activeDataset) || datasets[0] || null}
              onVisualizationRequest={(viz) => {
                // Could add the visualization to the dashboard
                console.log('Visualization requested:', viz);
              }}
            />
          </TabsContent>

          {/* Smart Connections Tab - NEW */}
          <TabsContent value="connections" className="space-y-6">
            <SmartDataConnector
              datasets={datasets}
              onRelationshipCreated={(rel) => {
                setRelationships(prev => [...prev, rel]);
                toast.success('Relationship created!');
              }}
              onCompositeViewCreated={(data, columns) => {
                setCompositeData(data);
                setCompositeColumns(columns);
                toast.success(`Composite view created with ${data.length} rows!`);
              }}
            />
            
            {/* Composite View Preview */}
            {compositeData && compositeColumns && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Composite Data View
                    <Badge variant="outline">{compositeData.length} rows</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead className="bg-gray-50">
                        <tr>
                          {compositeColumns.slice(0, 8).map((col, i) => (
                            <th key={i} className="border px-3 py-2 text-left font-medium">
                              {col.name}
                            </th>
                          ))}
                          {compositeColumns.length > 8 && (
                            <th className="border px-3 py-2 text-left font-medium text-gray-400">
                              +{compositeColumns.length - 8} more
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {compositeData.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            {compositeColumns.slice(0, 8).map((col, j) => (
                              <td key={j} className="border px-3 py-2">
                                {String(row[col.name] || '')}
                              </td>
                            ))}
                            {compositeColumns.length > 8 && <td className="border px-3 py-2">...</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {compositeData.length > 10 && (
                      <p className="text-sm text-gray-500 mt-2">
                        Showing 10 of {compositeData.length} rows
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Upload Datasets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
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
                      <p className="text-sm text-gray-500">CSV, Excel (.xlsx, .xls), or JSON files</p>
                      <p className="text-xs text-gray-400 mt-1">Click to browse or drag and drop</p>
                    </div>
                  </label>
                </div>

                {datasets.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Uploaded Datasets</h3>
                    {datasets.map(dataset => {
                      const fileFormat = getFileFormat(dataset.name);
                      const getFileIcon = () => {
                        switch (fileFormat) {
                          case 'excel': return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
                          case 'json': return <FileCode className="h-4 w-4 text-purple-500" />;
                          default: return <FileText className="h-4 w-4 text-blue-500" />;
                        }
                      };
                      
                      return (
                        <Card key={dataset.id} className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {getFileIcon()}
                              <div>
                                <h4 className="font-medium">{dataset.name}</h4>
                                <p className="text-sm text-gray-500">
                                  {dataset.rowCount} rows • {dataset.columns.length} columns • {fileFormat.toUpperCase()}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline">
                              {dataset.columns.filter(col => col.type === 'number').length} numeric
                            </Badge>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {datasets.length > 0 && (
                  <Button 
                    onClick={processData} 
                    disabled={isProcessing}
                    className="w-full"
                    size="lg"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing Data...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        Apply & Analyze Data
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clean" className="space-y-6">
            {activeDataset ? (
              (() => {
                const dataset = datasets.find(d => d.id === activeDataset);
                if (!dataset) return null;
                
                return (
                  <DataCleaning
                    dataset={dataset}
                    onDatasetUpdate={(cleanedDataset) => {
                      setDatasets(prev => prev.map(d => 
                        d.id === activeDataset ? cleanedDataset : d
                      ));
                      toast.success('Dataset cleaned successfully');
                    }}
                  />
                );
              })()
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Please select a dataset to start cleaning</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="explore" className="space-y-6">
            {activeDataset ? (
              (() => {
                const dataset = datasets.find(d => d.id === activeDataset);
                if (!dataset) return null;
                
                return (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="flex items-center gap-2">
                            <Eye className="h-5 w-5" />
                            Data Explorer - {dataset.name}
                          </CardTitle>
                          <div className="flex gap-2">
                            <Dialog open={showCustomFieldDialog} onOpenChange={setShowCustomFieldDialog}>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Columns className="h-4 w-4 mr-2" />
                                  Add Custom Field
                                </Button>
                              </DialogTrigger>
                              <CustomFieldDialog
                                open={showCustomFieldDialog}
                                onOpenChange={setShowCustomFieldDialog}
                                onSave={(column) => {
                                  const updatedDataset = {
                                    ...dataset,
                                    columns: [...dataset.columns, column],
                                    data: dataset.data.map(row => ({
                                      ...row,
                                      [column.name]: column.defaultValue ?? (column.type === 'number' ? 0 : column.type === 'boolean' ? false : '')
                                    }))
                                  };
                                  const finalDataset = updateDatasetStats(updatedDataset);
                                  setDatasets(prev => prev.map(d => d.id === dataset.id ? finalDataset : d));
                                  toast.success(`Custom field "${column.name}" added`);
                                }}
                                existingColumns={dataset.columns.map(col => col.name)}
                              />
                            </Dialog>
                            <Dialog open={showDataEntryDialog} onOpenChange={setShowDataEntryDialog}>
                              <DialogTrigger asChild>
                                <Button size="sm">
                                  <Plus className="h-4 w-4 mr-2" />
                                  Add Observation
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Add New Observation</DialogTitle>
                                </DialogHeader>
                                <DataEntryForm
                                  dataset={dataset}
                                  onSave={(observation) => {
                                    const updatedDataset = {
                                      ...dataset,
                                      data: [...dataset.data, observation]
                                    };
                                    const finalDataset = updateDatasetStats(updatedDataset);
                                    setDatasets(prev => prev.map(d => d.id === dataset.id ? finalDataset : d));
                                    setShowDataEntryDialog(false);
                                    toast.success('Observation added successfully');
                                  }}
                                  onCancel={() => setShowDataEntryDialog(false)}
                                />
                              </DialogContent>
                            </Dialog>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                    
                    <DataExplorer
                      dataset={dataset}
                      onUpdate={(updatedDataset) => {
                        setDatasets(prev => prev.map(d => d.id === dataset.id ? updatedDataset : d));
                      }}
                      onDeleteRow={(rowIndex) => {
                        const updatedData = dataset.data.filter((_, index) => index !== rowIndex);
                        const updatedDataset = updateDatasetStats({
                          ...dataset,
                          data: updatedData
                        });
                        setDatasets(prev => prev.map(d => d.id === dataset.id ? updatedDataset : d));
                      }}
                    />
                  </div>
                );
              })()
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 mb-2">No dataset selected</p>
                  <p className="text-sm text-gray-400">Upload a dataset or select one from the Upload Data tab to explore</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            {/* Analysis Interpretation */}
            <AnalysisInterpretation
              interpretation={interpretation}
              onSave={setInterpretation}
            />

            {/* Custom DAX Calculator */}
            <CustomDAXCalculator
              datasets={datasets}
              customCalculations={customDAXCalculations}
              onAddCalculation={(calc) => {
                const newCalc: DAXCalculation = {
                  ...calc,
                  id: `custom-${Date.now()}`
                };
                setCustomDAXCalculations(prev => [...prev, newCalc]);
                
                // Auto-execute if dataset is available
                const dataset = datasets.find(d => d.id === activeDataset) || datasets[0];
                if (dataset) {
                  try {
                    const result = executeDAXCalculation(newCalc, dataset);
                    setCustomDAXCalculations(prev => prev.map(c => 
                      c.id === newCalc.id ? { ...c, result } : c
                    ));
                  } catch (error) {
                    console.error('Error executing custom calculation:', error);
                  }
                }
              }}
              onDeleteCalculation={(id) => {
                setCustomDAXCalculations(prev => prev.filter(c => c.id !== id));
              }}
              onExecuteCalculation={executeDAXCalculation}
            />

            {/* Automatic DAX Calculations */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Automatic DAX Calculations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {daxCalculations.length === 0 ? (
                  <div className="text-center py-8">
                    <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No calculations available. Please upload data and click "Apply & Analyze Data"</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {daxCalculations.map(calc => (
                      <Card key={calc.id} className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{calc.name}</h4>
                            <Badge variant="secondary">{calc.category}</Badge>
                          </div>
                          <p className="text-sm text-gray-600">{calc.description}</p>
                          <code className="text-xs bg-gray-100 p-2 rounded block">{calc.formula}</code>
                          {calc.result !== null && calc.result !== undefined && (
                            <div className="text-lg font-bold text-blue-600">
                              Result: {typeof calc.result === 'object' ? JSON.stringify(calc.result) : calc.result}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-green-500 h-2 rounded-full" 
                                style={{ width: `${calc.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{Math.round(calc.confidence * 100)}%</span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visualizations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  All Visualizations
                </CardTitle>
                <p className="text-sm text-gray-500 mt-2">
                  Use the + and - buttons on each visualization to zoom in and out
                </p>
                {activeDs && isDatasetTooLarge(activeDs) && (
                  <p className="text-xs text-orange-600 mt-2">
                    ⚠️ Large dataset detected. Visualizations show optimized/sampled data for performance.
                  </p>
                )}
              </CardHeader>
              <CardContent>
                {visualizations.length === 0 ? (
                  <div className="text-center py-8">
                    <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No visualizations available. Please upload data and click "Apply & Analyze Data"</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {visualizations.slice(0, 20).map(viz => (
                      <ErrorBoundary
                        key={viz.id}
                        fallback={
                          <Card className="p-4 border-red-200 bg-red-50">
                            <p className="text-sm text-red-600">
                              Failed to render visualization: {viz.title}
                            </p>
                          </Card>
                        }
                      >
                        <ZoomableVisualization
                          visualization={viz}
                          getVisualizationIcon={getVisualizationIcon}
                        />
                      </ErrorBoundary>
                    ))}
                    {visualizations.length > 20 && (
                      <div className="col-span-2 text-center py-4 text-gray-500 text-sm">
                        Showing first 20 of {visualizations.length} visualizations for performance
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="relationships" className="space-y-6">
            <RelationshipBuilder
              datasets={datasets}
              relationships={relationships}
              onAddRelationship={(rel) => {
                const newRel: Relationship = {
                  ...rel,
                  id: `rel-${Date.now()}`
                };
                
                // Ensure relationship matches current schema type to prevent mixing
                const updatedRel: Relationship = {
                  ...newRel,
                  schemaType: schemaType !== 'none' ? schemaType : 'star'
                };
                
                setRelationships(prev => {
                  // Remove any existing relationships that would conflict (same datasets, different schema)
                  const filtered = prev.filter(r => {
                    // Keep relationships that don't match these datasets, or match same schema
                    const matchesDatasets = (r.fromDataset === updatedRel.fromDataset && r.toDataset === updatedRel.toDataset) ||
                                          (r.fromDataset === updatedRel.toDataset && r.toDataset === updatedRel.fromDataset);
                    if (!matchesDatasets) return true;
                    // If matches datasets, only keep if same schema type
                    return r.schemaType === updatedRel.schemaType;
                  });
                  
                  return [...filtered, updatedRel];
                });
                
                // Don't auto-apply - let user click "Apply Relationships" button
                // This gives Power BI-style control where users can create multiple relationships
                // and then apply them all at once
              }}
              onDeleteRelationship={(id) => {
                setRelationships(prev => prev.filter(r => r.id !== id));
              }}
              onApplyRelationships={() => {
                if (schemaType !== 'none' && relationships.length > 0) {
                  processData();
                  toast.success(`Applied ${relationships.length} relationship${relationships.length === 1 ? '' : 's'} to data model`);
                } else {
                  toast.error('Please create relationships and select a schema type first');
                }
              }}
              schemaType={schemaType}
              onSchemaTypeChange={(type) => {
                const previousType = schemaType;
                setSchemaType(type);
                
                if (type === 'none') {
                  // Remove all relationships when schema is set to none
                  setRelationships([]);
                } else {
                  // When switching schema types, update relationships to match new type
                  // Remove relationships from the old schema type
                  setRelationships(prev => {
                    const updated = prev
                      .filter(rel => {
                        // If switching from one schema to another, remove old schema relationships
                        if (previousType !== 'none' && rel.schemaType === previousType) {
                          return false; // Remove old schema relationships
                        }
                        // Keep relationships matching new schema type or no schema
                        return rel.schemaType === type || rel.schemaType === undefined;
                      })
                      .map(rel => ({
                        ...rel,
                        schemaType: type // Update to match new schema type
                      }));
                    
                    // Remove duplicates (same datasets)
                    const unique = new Map<string, Relationship>();
                    updated.forEach(rel => {
                      const key = `${rel.fromDataset}-${rel.toDataset}-${rel.fromColumn}-${rel.toColumn}`;
                      if (!unique.has(key)) {
                        unique.set(key, rel);
                      }
                    });
                    
                    return Array.from(unique.values());
                  });
                }
              }}
            />
          </TabsContent>
        </Tabs>

        {/* Report CTA */}
        {datasets.length > 0 && (
          <div className="mt-8">
            <RequestReportCTA />
          </div>
        )}
      </div>
      </div>

      {/* PDF Paywall Dialog */}
      <PDFPaywallDialog
        open={showPaywall}
        onOpenChange={(open) => {
          setShowPaywall(open);
          if (!open) setCheckoutLoadingProvider(null);
        }}
        onStripeCheckout={async (plan) => startProviderCheckout('stripe', plan)}
        onPaystackCheckout={async (plan) => startProviderCheckout('paystack', plan)}
        checkoutLoadingProvider={checkoutLoadingProvider}
      />
    </ErrorBoundary>
  );
};

export default FunctionalDataUpload;
