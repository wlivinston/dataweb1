// Finance Dashboard â€” Upload financial data, generate P&L, Balance Sheet, Cash Flow
// Beautiful UI for business users to see their financial position at a glance

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipTrigger as UiTooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DollarSign, TrendingUp, TrendingDown, Upload, FileSpreadsheet,
  Download, ChevronRight, Building2, BarChart3, PieChart as PieIcon,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw, CheckCircle,
  AlertTriangle, FileText, Plus, Trash2, Activity, Shield,
  Wallet, Landmark, Scale, Heart, Eye, Loader2, ClipboardCopy, Sparkles
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, ScatterChart, Scatter,
} from 'recharts';
import * as XLSX from 'xlsx';
import DataProcessingOverlay from './DataProcessingOverlay';
import PDFPaywallDialog from './PDFPaywallDialog';
import { toast } from 'sonner';

import {
  FinanceColumnMapping,
  FinancialReport,
  FinanceChartData,
  LineItem,
  AccountCategory,
  ManualEntryRow,
  NetIncomeAutoMediumSignalDefault,
  NetIncomeToEquityMode,
  ReportPeriod,
} from '@/lib/financeTypes';
import { ColumnInfo } from '@/lib/types';
import {
  detectFinanceColumns,
  generateFinancialReport,
  generateTemplateCSV,
  generateFinanceChartData,
} from '@/lib/financeEngine';
import { generateOnePageFinancialNarrative } from '@/lib/financeNarrative';
import { generateFinanceOnePagePDF, generateOffsetEntriesAppendixPDF } from '@/lib/financePdfReport';
import {
  CanonicalTransaction,
  FinancialDatasetFormatDetection,
  WideConversionConfig,
  canonicalToReportInput,
  createDefaultWideConversionConfig,
  transformLongDatasetToCanonical,
  transformWideDatasetToCanonical,
} from '@/lib/financeImportPipeline';
import {
  AssetHandlingMode,
  AssetRegisterRow,
  AssetJournalGenerationOptions,
  DepreciationGenerationOptions,
  LiabilityDetectionResult,
  LiabilityJournalGenerationOptions,
  UploadedFinanceSheet,
  detect_assets_register,
  detect_financial_sheets,
  detect_format,
  detect_liability_indicators,
  generate_asset_acquisition_journal,
  generate_depreciation_schedule,
  generate_liability_journal,
  merge_with_existing_journal,
  resolve_asset_handling_mode,
  validate_journal,
  validate_liability_journal,
  compute_asset_reconciliation,
} from '@/lib/financeAssetIngestion';
import {
  FinanceImportProfile,
  getFinanceImportProfiles,
  saveFinanceImportProfile,
} from '@/lib/financeImportProfiles';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/publicConfig';
import { SHARED_CHART_PALETTE, POSITIVE_CHART_COLOR, NEGATIVE_CHART_COLOR } from '@/lib/chartColors';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Types
// ============================================================

type FinanceView = 'upload' | 'mapping' | 'wideWizard' | 'assetWizard' | 'processing' | 'dashboard';

const CHART_COLORS = SHARED_CHART_PALETTE;

const CATEGORY_OPTIONS: { value: AccountCategory | ''; label: string }[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'cost_of_goods_sold', label: 'Cost of Goods Sold' },
  { value: 'operating_expense', label: 'Operating Expense' },
  { value: 'other_income', label: 'Other Income' },
  { value: 'other_expense', label: 'Other Expense' },
  { value: 'tax', label: 'Tax' },
  { value: 'current_asset', label: 'Current Asset' },
  { value: 'non_current_asset', label: 'Non-Current Asset' },
  { value: 'current_liability', label: 'Current Liability' },
  { value: 'non_current_liability', label: 'Non-Current Liability' },
  { value: 'equity', label: 'Equity' },
];

const JOURNAL_LINE_TOLERANCE = 0.01;
const BALANCE_SHEET_TOLERANCE = 0.05;
const OPENING_INITIALIZATION_SOURCE_COLUMN = 'Single_Entry_Offset';
const OPENING_INITIALIZATION_CLEARING_ACCOUNT = 'System Clearing Account';
type OpeningInitializationStrategy = 'per_row' | 'per_day';
const OPENING_INITIALIZATION_STRATEGY: OpeningInitializationStrategy = 'per_day';
const formatOpeningInitializationStrategy = (strategy: OpeningInitializationStrategy): string =>
  strategy === 'per_day' ? 'Per-day' : 'Per-row';
const RADIAN = Math.PI / 180;
type FinanceChartVisualType = 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'table';
const FINANCE_CHART_OPTIONS: FinanceChartVisualType[] = ['bar', 'line', 'area', 'pie', 'scatter', 'table'];
const FINANCE_CHART_TYPE_LABEL: Record<FinanceChartVisualType, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  scatter: 'Scatter',
  table: 'Table',
};
const PDF_ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const PAID_SUBSCRIPTION_STATUSES = new Set([
  'professional',
  'enterprise',
  'admin',
  'paid',
  'premium',
  'pro',
  'monthly',
  'annual',
]);

const parseBooleanEnv = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase().trim());
};

const parseBooleanEnvWithDefault = (value: unknown, defaultValue: boolean): boolean => {
  if (typeof value !== 'string') return defaultValue;
  return parseBooleanEnv(value);
};

// ============================================================
// Component
// ============================================================

const FinanceDashboard: React.FC = () => {
  const { user, session } = useAuth();

  const assetModuleEnabled = parseBooleanEnv(import.meta.env.VITE_FINANCE_ASSET_MODULE_ENABLED);
  const assetModuleFlowsToBalanceSheet = parseBooleanEnv(import.meta.env.VITE_FINANCE_ASSET_MODULE_FLOWS_TO_BALANCE_SHEET);
  const assetModuleSupportsIngestion = parseBooleanEnvWithDefault(
    import.meta.env.VITE_FINANCE_ASSET_MODULE_SUPPORTS_INGESTION,
    true
  );
  const assetModuleReady = assetModuleEnabled && assetModuleFlowsToBalanceSheet && assetModuleSupportsIngestion;

  // View state
  const [view, setView] = useState<FinanceView>('upload');
  const [activeTab, setActiveTab] = useState('pnl');

  // Upload/data state
  const [rawData, setRawData] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [uploadedSheets, setUploadedSheets] = useState<UploadedFinanceSheet[]>([]);
  const [mapping, setMapping] = useState<FinanceColumnMapping>({});
  const [formatDetection, setFormatDetection] = useState<FinancialDatasetFormatDetection | null>(null);
  const [wideConfig, setWideConfig] = useState<WideConversionConfig | null>(null);
  const [assetsRegisterRows, setAssetsRegisterRows] = useState<AssetRegisterRow[]>([]);
  const [assetsRegisterSheetName, setAssetsRegisterSheetName] = useState<string>('');
  const [sheetDetectionSummary, setSheetDetectionSummary] = useState<string[]>([]);
  const [previewTransactions, setPreviewTransactions] = useState<CanonicalTransaction[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewAuditLog, setPreviewAuditLog] = useState<string[]>([]);
  const [assetPreviewTransactions, setAssetPreviewTransactions] = useState<CanonicalTransaction[]>([]);
  const [pendingBaseJournal, setPendingBaseJournal] = useState<CanonicalTransaction[]>([]);
  const [pendingAssetJournal, setPendingAssetJournal] = useState<CanonicalTransaction[]>([]);
  const [pendingImportWarnings, setPendingImportWarnings] = useState<string[]>([]);
  const [pendingAuditLog, setPendingAuditLog] = useState<string[]>([]);
  const [pendingFallbackView, setPendingFallbackView] = useState<FinanceView>('upload');
  const [assetWizardMessage, setAssetWizardMessage] = useState<string>('');
  const [assetHandlingMode, setAssetHandlingMode] = useState<AssetHandlingMode>('auto');
  const [resolvedAssetHandlingSummary, setResolvedAssetHandlingSummary] = useState<string>('');
  const [assetAcquisitionOptions, setAssetAcquisitionOptions] = useState<AssetJournalGenerationOptions>({
    creditAccount: 'Cash',
    respectFinancingType: true,
  });
  const [assetDepreciationOptions, setAssetDepreciationOptions] = useState<DepreciationGenerationOptions>({
    startFrom: 'next_month',
  });
  const [includeDepreciation, setIncludeDepreciation] = useState<boolean>(true);
  const [liabilityOptions, setLiabilityOptions] = useState<LiabilityJournalGenerationOptions>({
    includeDetectedSheetLiabilities: true,
    includeAssetFinancingLiabilities: false,
    defaultAssetFinancingLiabilityAccount: 'Accounts Payable',
  });
  const [liabilityDetection, setLiabilityDetection] = useState<LiabilityDetectionResult | null>(null);
  const [liabilityAssumptions, setLiabilityAssumptions] = useState<string[]>([]);
  const [importSummaryLines, setImportSummaryLines] = useState<string[]>([]);
  const [canonicalTransactions, setCanonicalTransactions] = useState<CanonicalTransaction[]>([]);
  const [importAuditLog, setImportAuditLog] = useState<string[]>([]);
  const [longProfiles, setLongProfiles] = useState<FinanceImportProfile[]>([]);
  const [wideProfiles, setWideProfiles] = useState<FinanceImportProfile[]>([]);
  const [selectedLongProfileId, setSelectedLongProfileId] = useState<string>('none');
  const [selectedWideProfileId, setSelectedWideProfileId] = useState<string>('none');
  const [profileName, setProfileName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('annual');
  const [netIncomeToEquityMode, setNetIncomeToEquityMode] = useState<NetIncomeToEquityMode>('auto');
  const [autoNetIncomeDefaultOnMediumSignal, setAutoNetIncomeDefaultOnMediumSignal] =
    useState<NetIncomeAutoMediumSignalDefault>('auto');
  const [reconciliationBlockDetails, setReconciliationBlockDetails] = useState<string[]>([]);
  const [blockedJournalSnapshot, setBlockedJournalSnapshot] = useState<CanonicalTransaction[]>([]);
  const [blockedFallbackView, setBlockedFallbackView] = useState<FinanceView>('upload');
  const [openingFixSuggestion, setOpeningFixSuggestion] = useState<{
    amount: number;
    date: string;
    debitAccount: string;
    creditAccount: string;
  } | null>(null);
  const [singleEntryFixSuggestion, setSingleEntryFixSuggestion] = useState<{
    offsetRows: number;
    sourceRows: number;
    journalImbalance: number;
    strategy: OpeningInitializationStrategy;
  } | null>(null);

  // Manual entry
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualRows, setManualRows] = useState<ManualEntryRow[]>([
    { id: uuidv4(), date: '', account: '', category: '', amount: '', description: '' },
  ]);

  // Report state
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [chartData, setChartData] = useState<FinanceChartData | null>(null);
  const [financeChartModes, setFinanceChartModes] = useState({
    revenueVsExpenses: 'bar' as FinanceChartVisualType,
    expenseBreakdown: 'pie' as FinanceChartVisualType,
    cashFlowComponents: 'bar' as FinanceChartVisualType,
    assetAllocation: 'pie' as FinanceChartVisualType,
    profitabilityMargins: 'bar' as FinanceChartVisualType,
  });
  const [writtenReport, setWrittenReport] = useState('');
  const [isGeneratingFinancePDF, setIsGeneratingFinancePDF] = useState(false);
  const [isGeneratingOffsetPDF, setIsGeneratingOffsetPDF] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [checkoutLoadingProvider, setCheckoutLoadingProvider] = useState<'stripe' | 'paystack' | null>(null);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [paidPdfAccessCache, setPaidPdfAccessCache] = useState<{
    hasAccess: boolean;
    checkedAt: number;
  } | null>(null);

  // Overlay
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStage, setOverlayStage] = useState<'uploading' | 'parsing' | 'analyzing' | 'processing' | 'complete'>('processing');
  const [overlayProgress, setOverlayProgress] = useState(0);
  const [overlayMessage, setOverlayMessage] = useState('');

  const refreshProfiles = useCallback(() => {
    setLongProfiles(getFinanceImportProfiles('long'));
    setWideProfiles(getFinanceImportProfiles('wide'));
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    if (view !== 'wideWizard' || !wideConfig || rawData.length === 0) {
      setPreviewTransactions([]);
      setPreviewWarnings([]);
      setPreviewAuditLog([]);
      return;
    }

    const previewResult = transformWideDatasetToCanonical(rawData, wideConfig);
    setPreviewTransactions(previewResult.transactions.slice(0, 12));
    setPreviewWarnings(previewResult.warnings);
    setPreviewAuditLog(previewResult.auditLog);
  }, [view, rawData, wideConfig]);

  useEffect(() => {
    if (!report) {
      setWrittenReport('');
      return;
    }

    setWrittenReport(generateOnePageFinancialNarrative(report));
  }, [report]);

  useEffect(() => {
    setPaidPdfAccessCache(null);
  }, [user?.email]);

  useEffect(() => {
    const hasSupplementalSignals =
      assetsRegisterRows.length > 0 || Boolean(liabilityDetection?.detected);

    if (view !== 'assetWizard' || !hasSupplementalSignals) {
      setAssetPreviewTransactions([]);
      setResolvedAssetHandlingSummary('');
      setImportSummaryLines([]);
      setLiabilityAssumptions([]);
      return;
    }

    try {
      const generated = buildGeneratedAssetJournal();
      const mergedPreview = merge_with_existing_journal(pendingBaseJournal, generated.transactions);

      setResolvedAssetHandlingSummary(generated.fallbackNotice || '');
      setImportSummaryLines(generated.summaryLines);
      setLiabilityAssumptions(generated.assumptions);
      setLiabilityDetection(generated.liabilityDetection);
      setPendingAssetJournal(generated.transactions);
      setAssetPreviewTransactions(mergedPreview.slice(0, 30));
    } catch (error: any) {
      setAssetPreviewTransactions([]);
      setImportSummaryLines(['Unable to resolve asset handling mode.']);
      setResolvedAssetHandlingSummary('');
      setLiabilityAssumptions([]);
    }
  }, [
    view,
    assetsRegisterRows,
    netIncomeToEquityMode,
    autoNetIncomeDefaultOnMediumSignal,
    assetHandlingMode,
    assetModuleEnabled,
    assetModuleFlowsToBalanceSheet,
    assetModuleSupportsIngestion,
    assetAcquisitionOptions,
    assetDepreciationOptions,
    includeDepreciation,
    liabilityOptions,
    uploadedSheets,
    pendingBaseJournal,
  ]);

  const applyLongProfile = (profileId: string) => {
    setSelectedLongProfileId(profileId);
    if (profileId === 'none') return;

    const profile = longProfiles.find(candidate => candidate.id === profileId);
    if (!profile?.longMapping) return;

    setMapping(profile.longMapping);
    if (profile.netIncomeToEquityMode) {
      setNetIncomeToEquityMode(profile.netIncomeToEquityMode);
    }
    if (profile.netIncomeAutoMediumSignalDefault) {
      setAutoNetIncomeDefaultOnMediumSignal(profile.netIncomeAutoMediumSignalDefault);
    }
    if (profile.assetRules) {
      if (profile.assetRules.handlingMode) {
        setAssetHandlingMode(profile.assetRules.handlingMode);
      }
      setAssetAcquisitionOptions(profile.assetRules.acquisition);
      setAssetDepreciationOptions(profile.assetRules.depreciation);
      setIncludeDepreciation(profile.assetRules.includeDepreciation);
      if (profile.assetRules.liability) {
        setLiabilityOptions(profile.assetRules.liability);
      }
    }
    toast.success(`Loaded mapping profile: ${profile.name}`);
  };

  const applyWideProfile = (profileId: string) => {
    setSelectedWideProfileId(profileId);
    if (profileId === 'none') return;

    const profile = wideProfiles.find(candidate => candidate.id === profileId);
    if (!profile?.wideConfig) return;

    setWideConfig(profile.wideConfig);
    if (profile.netIncomeToEquityMode) {
      setNetIncomeToEquityMode(profile.netIncomeToEquityMode);
    }
    if (profile.netIncomeAutoMediumSignalDefault) {
      setAutoNetIncomeDefaultOnMediumSignal(profile.netIncomeAutoMediumSignalDefault);
    }
    if (profile.assetRules) {
      if (profile.assetRules.handlingMode) {
        setAssetHandlingMode(profile.assetRules.handlingMode);
      }
      setAssetAcquisitionOptions(profile.assetRules.acquisition);
      setAssetDepreciationOptions(profile.assetRules.depreciation);
      setIncludeDepreciation(profile.assetRules.includeDepreciation);
      if (profile.assetRules.liability) {
        setLiabilityOptions(profile.assetRules.liability);
      }
    }
    toast.success(`Loaded conversion profile: ${profile.name}`);
  };

  const saveCurrentLongProfile = () => {
    const name = profileName.trim();
    if (!name) {
      toast.error('Enter a profile name before saving.');
      return;
    }

    saveFinanceImportProfile({
      name,
      format: 'long',
      longMapping: mapping,
      netIncomeToEquityMode,
      netIncomeAutoMediumSignalDefault: autoNetIncomeDefaultOnMediumSignal,
      assetRules: {
        handlingMode: assetHandlingMode,
        acquisition: assetAcquisitionOptions,
        depreciation: assetDepreciationOptions,
        includeDepreciation,
        liability: liabilityOptions,
      },
    });

    refreshProfiles();
    toast.success(`Saved long-format profile: ${name}`);
  };

  const saveCurrentWideProfile = () => {
    const name = profileName.trim();
    if (!name) {
      toast.error('Enter a profile name before saving.');
      return;
    }

    if (!wideConfig) {
      toast.error('No wide conversion configuration to save.');
      return;
    }

    saveFinanceImportProfile({
      name,
      format: 'wide',
      wideConfig,
      netIncomeToEquityMode,
      netIncomeAutoMediumSignalDefault: autoNetIncomeDefaultOnMediumSignal,
      assetRules: {
        handlingMode: assetHandlingMode,
        acquisition: assetAcquisitionOptions,
        depreciation: assetDepreciationOptions,
        includeDepreciation,
        liability: liabilityOptions,
      },
    });

    refreshProfiles();
    toast.success(`Saved wide-format profile: ${name}`);
  };

  const toggleWideColumnSelection = (column: string, bucket: 'income' | 'expense') => {
    setWideConfig(previous => {
      if (!previous) return previous;

      const incomeColumns = previous.incomeColumns.filter(name => name !== column);
      const expenseColumns = previous.expenseColumns.filter(name => name !== column);

      if (bucket === 'income') {
        incomeColumns.push(column);
      } else {
        expenseColumns.push(column);
      }

      return {
        ...previous,
        incomeColumns: [...new Set(incomeColumns)],
        expenseColumns: [...new Set(expenseColumns)],
      };
    });
  };

  const clearWideColumnSelection = (column: string) => {
    setWideConfig(previous => {
      if (!previous) return previous;

      return {
        ...previous,
        incomeColumns: previous.incomeColumns.filter(name => name !== column),
        expenseColumns: previous.expenseColumns.filter(name => name !== column),
      };
    });
  };

  const updateWideColumnMapping = (column: string, field: 'account' | 'category', value: string) => {
    setWideConfig(previous => {
      if (!previous) return previous;

      if (field === 'account') {
        return {
          ...previous,
          accountMappings: {
            ...previous.accountMappings,
            [column]: value,
          },
        };
      }

      return {
        ...previous,
        categoryMappings: {
          ...previous.categoryMappings,
          [column]: value,
        },
      };
    });
  };

  const resetImportSession = () => {
    setRawData([]);
    setColumns([]);
    setUploadedSheets([]);
    setMapping({});
    setFormatDetection(null);
    setWideConfig(null);
    setAssetsRegisterRows([]);
    setAssetsRegisterSheetName('');
    setSheetDetectionSummary([]);
    setCanonicalTransactions([]);
    setImportAuditLog([]);
    setPreviewTransactions([]);
    setPreviewWarnings([]);
    setPreviewAuditLog([]);
    setAssetPreviewTransactions([]);
    setPendingBaseJournal([]);
    setPendingAssetJournal([]);
    setPendingImportWarnings([]);
    setPendingAuditLog([]);
    setPendingFallbackView('upload');
    setAssetWizardMessage('');
    setNetIncomeToEquityMode('auto');
    setAutoNetIncomeDefaultOnMediumSignal('auto');
    setAssetHandlingMode('auto');
    setResolvedAssetHandlingSummary('');
    setLiabilityOptions({
      includeDetectedSheetLiabilities: true,
      includeAssetFinancingLiabilities: false,
      defaultAssetFinancingLiabilityAccount: 'Accounts Payable',
    });
    setLiabilityDetection(null);
    setLiabilityAssumptions([]);
    setImportSummaryLines([]);
    setReconciliationBlockDetails([]);
    setBlockedJournalSnapshot([]);
    setBlockedFallbackView('upload');
    setOpeningFixSuggestion(null);
    setSingleEntryFixSuggestion(null);
    setIsGeneratingOffsetPDF(false);
    setSelectedLongProfileId('none');
    setSelectedWideProfileId('none');
  };

  const buildColumnsFromData = (dataset: Record<string, any>[]): ColumnInfo[] => {
    if (dataset.length === 0) return [];

    // Build columns from a union of keys because finance statements often contain
    // sparse rows (e.g., section headers) where the first data row does not include all headers.
    const columnNames: string[] = [];
    const seen = new Set<string>();
    for (const row of dataset.slice(0, 500)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columnNames.push(key);
        }
      }
    }

    return columnNames.map(name => ({
      name,
      type: detectColumnType(dataset, name),
      sampleValues: dataset.map(row => row[name]).filter(value => value != null && value !== '').slice(0, 5),
      nullCount: dataset.filter(row => row[name] == null || row[name] === '').length,
      uniqueCount: new Set(dataset.map(row => row[name])).size,
    }));
  };

  // ============================================================
  // FILE UPLOAD HANDLING
  // ============================================================

  const handleFileUpload = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();

    try {
      let parsedSheets: UploadedFinanceSheet[] = [];

      if (ext === 'csv') {
        const text = await file.text();
        const parsed = parseCSV(text);
        parsedSheets = [{
          sheetName: 'Uploaded_CSV',
          data: parsed.data,
          columns: parsed.columns,
        }];
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        parsedSheets = workbook.SheetNames.map(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          // Detect real header row — skip preamble/title rows (e.g. merged title cells)
          // by finding the first row that has ≥2 non-empty cells.
          const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
          let headerRow = 0;
          for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
            const nonEmpty = (rawRows[i] ?? []).filter((c: any) => c !== null && c !== undefined && c !== '');
            if (nonEmpty.length >= 2) { headerRow = i; break; }
          }
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { range: headerRow });
          return {
            sheetName,
            data: json,
            columns: buildColumnsFromData(json),
          };
        });
      } else {
        toast.error('Unsupported file format. Please upload CSV or Excel files.');
        return;
      }

      const nonEmptySheets = parsedSheets.filter(sheet => sheet.data.length > 0);
      if (nonEmptySheets.length === 0) {
        toast.error('No data found in file.');
        return;
      }

      resetImportSession();
      setUploadedSheets(nonEmptySheets);

      const sheetsSummary = detect_financial_sheets(nonEmptySheets);
      const summaryLines = sheetsSummary.sheetDetections.map(sheet => {
        if (sheet.role === 'assets_register') return `${sheet.sheetName}: Assets Register detected`;
        if (sheet.role === 'transaction_journal') return `${sheet.sheetName}: Transaction Journal detected`;
        if (sheet.role === 'pnl_dataset') return `${sheet.sheetName}: P&L dataset detected (${sheet.formatDetection.format})`;
        return `${sheet.sheetName}: Unclassified`;
      });

      const detectedAssets = sheetsSummary.assetsRegisterSheet
        ? detect_assets_register(
            sheetsSummary.assetsRegisterSheet.sheetName,
            sheetsSummary.assetsRegisterSheet.data,
            sheetsSummary.assetsRegisterSheet.columns
          )
        : null;

      if (detectedAssets?.detected) {
        setAssetsRegisterRows(detectedAssets.rows);
        setAssetsRegisterSheetName(detectedAssets.sheetName);
      }

      const liabilityDetectionResult = detect_liability_indicators(nonEmptySheets, detectedAssets?.rows || []);
      setLiabilityDetection(liabilityDetectionResult);
      const liabilitySummaryLines = liabilityDetectionResult.detected
        ? [
            `Liability indicators detected: ${liabilityDetectionResult.signals.length} signals`,
            ...(liabilityDetectionResult.columns.length > 0
              ? [`Liability columns: ${liabilityDetectionResult.columns.join(', ')}`]
              : []),
          ]
        : ['No explicit liability indicators detected.'];
      setSheetDetectionSummary([...summaryLines, ...liabilitySummaryLines]);

      const primarySheet =
        sheetsSummary.transactionJournalSheet ||
        sheetsSummary.pnlSheet ||
        nonEmptySheets.find(sheet => sheet.sheetName !== detectedAssets?.sheetName) ||
        nonEmptySheets[0];

      const hasOnlyAssetsRegister =
        !!detectedAssets?.detected &&
        (!primarySheet || primarySheet.sheetName === detectedAssets.sheetName);

      if (hasOnlyAssetsRegister) {
        setRawData([]);
        setColumns([]);
        setFormatDetection({
          format: 'long',
          confidence: 1,
          reasons: ['Assets register detected without transaction journal.'],
          suggestedIncomeColumns: [],
          suggestedExpenseColumns: [],
          metrics: {
            rowCount: 0,
            columnCount: 0,
            numericColumnRatio: 0,
            dateColumnCount: 0,
            repeatedDateRows: 0,
            hasAmountDebitCreditColumns: false,
            hasTypeIncomeExpenseSignal: false,
            categoryLikeNumericColumns: 0,
            oneRowPerPeriodSignal: false,
          },
        });
        setPendingBaseJournal([]);
        setPendingAssetJournal([]);
        setPendingImportWarnings([]);
        setPendingAuditLog(['Asset-only upload detected; no existing transaction journal to merge.']);
        setPendingFallbackView('upload');
        setAssetPreviewTransactions([]);
        setImportSummaryLines([]);
        setAssetWizardMessage(
          'Assets Register detected, but Balance Sheet requires asset purchase transactions. We will generate the required journal entries for you.'
        );
        setView('assetWizard');
        toast.info('Import summary will show selected Asset Handling Mode before confirmation.');
        toast.success(`Loaded ${detectedAssets.rows.length} asset records from ${file.name}`);
        return;
      }

      const data = primarySheet.data;
      const detectedColumns = primarySheet.columns;
      setRawData(data);
      setColumns(detectedColumns);

      const detection = detect_format(detectedColumns, data);
      setFormatDetection(detection);

      if (detection.format === 'wide') {
        const defaultWideConfig = createDefaultWideConversionConfig(detection, detectedColumns);
        setWideConfig(defaultWideConfig);
        setView('wideWizard');
        toast.success(`Loaded ${data.length} rows from ${file.name}`);
        toast.info('We detected a WIDE financial dataset. This will be converted into transactions.');
        return;
      }

      // Default to long mapping flow when format is long or unknown.
      const autoMapping = detectFinanceColumns(detectedColumns, data.slice(0, 10));
      setMapping(autoMapping);
      setWideConfig(null);
      setView('mapping');

      toast.success(`Loaded ${data.length} rows from ${file.name}`);
      if (detection.format === 'unknown') {
        toast.warning('Dataset format was ambiguous. Using long-format mapping for manual confirmation.');
      }
    } catch (error) {
      console.error('File parse error:', error);
      toast.error('Failed to parse file. Please check the format.');
    }
  }, []);

  const parseCSV = (text: string): { data: Record<string, any>[]; columns: ColumnInfo[] } => {
    // Remove BOM
    const clean = text.replace(/^\uFEFF/, '');
    const lines = clean.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return { data: [], columns: [] };

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, any> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] ?? '';
      });
      data.push(row);
    }

    const columns: ColumnInfo[] = headers.map(name => ({
      name,
      type: detectColumnType(data, name),
      sampleValues: data.slice(0, 5).map(r => r[name]),
      nullCount: data.filter(r => r[name] == null || r[name] === '').length,
      uniqueCount: new Set(data.map(r => r[name])).size,
    }));

    return { data, columns };
  };

  const detectColumnType = (data: Record<string, any>[], name: string): 'string' | 'number' | 'date' | 'boolean' => {
    const sample = data.slice(0, 20).map(r => r[name]).filter(v => v != null && v !== '');
    if (sample.length === 0) return 'string';

    const numCount = sample.filter(v => {
      if (typeof v === 'number') return Number.isFinite(v);
      const raw = String(v).trim();
      if (!raw) return false;
      const normalized = raw
        .replace(/[,$€£\s]/g, '')
        .replace(/[()]/g, '')
        .replace(/[^0-9.-]/g, '');
      if (!normalized || normalized === '-' || normalized === '.') return false;
      return !isNaN(Number(normalized));
    }).length;
    if (numCount / sample.length > 0.7) return 'number';

    const dateCount = sample.filter(v => !isNaN(Date.parse(String(v)))).length;
    if (dateCount / sample.length > 0.7) return 'date';

    return 'string';
  };

  // Drag & drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ============================================================
  // TEMPLATE DOWNLOAD
  // ============================================================

  const downloadTemplate = () => {
    const csv = generateTemplateCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'finance_template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded!');
  };

  // ============================================================
  // MANUAL ENTRY
  // ============================================================

  const addManualRow = () => {
    setManualRows(prev => [...prev, {
      id: uuidv4(), date: '', account: '', category: '', amount: '', description: '',
    }]);
  };

  const removeManualRow = (id: string) => {
    setManualRows(prev => prev.filter(r => r.id !== id));
  };

  const updateManualRow = (id: string, field: keyof ManualEntryRow, value: any) => {
    setManualRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const processManualEntry = () => {
    const validRows = manualRows.filter(r => r.account && r.amount !== '');
    if (validRows.length === 0) {
      toast.error('Please enter at least one row with account name and amount.');
      return;
    }

    const data = validRows.map(r => ({
      Date: r.date || new Date().toISOString().split('T')[0],
      Account: r.account,
      Category: r.category,
      Amount: Number(r.amount),
      Description: r.description,
    }));

    const cols: ColumnInfo[] = [
      { name: 'Date', type: 'date', sampleValues: [], nullCount: 0, uniqueCount: 0 },
      { name: 'Account', type: 'string', sampleValues: [], nullCount: 0, uniqueCount: 0 },
      { name: 'Category', type: 'string', sampleValues: [], nullCount: 0, uniqueCount: 0 },
      { name: 'Amount', type: 'number', sampleValues: [], nullCount: 0, uniqueCount: 0 },
      { name: 'Description', type: 'string', sampleValues: [], nullCount: 0, uniqueCount: 0 },
    ];

    setRawData(data);
    setColumns(cols);
    setUploadedSheets([{ sheetName: 'Manual_Entry', data, columns: cols }]);
    setMapping({ date: 'Date', account: 'Account', category: 'Category', amount: 'Amount', description: 'Description' });
    setFormatDetection({
      format: 'long',
      confidence: 1,
      reasons: ['Manual entry is treated as long-format transaction data.'],
      suggestedIncomeColumns: [],
      suggestedExpenseColumns: [],
      metrics: {
        rowCount: data.length,
        columnCount: cols.length,
        numericColumnRatio: 1 / cols.length,
        dateColumnCount: 1,
        repeatedDateRows: 0,
        hasAmountDebitCreditColumns: true,
        hasTypeIncomeExpenseSignal: false,
        categoryLikeNumericColumns: 0,
        oneRowPerPeriodSignal: false,
      },
    });
    setWideConfig(null);
    setAssetsRegisterRows([]);
    setAssetsRegisterSheetName('');
    setSheetDetectionSummary(['Manual_Entry: Transaction Journal detected']);
    setLiabilityDetection({
      detected: false,
      reasons: ['No explicit liability indicators detected.'],
      columns: [],
      sheets: [],
      signals: [],
    });
    setPreviewTransactions([]);
    setPreviewWarnings([]);
    setPreviewAuditLog([]);
    setSelectedLongProfileId('none');
    setSelectedWideProfileId('none');
    setView('mapping');
    toast.success(`${validRows.length} entries ready for processing`);
  };

  // ============================================================
  // REPORT GENERATION
  // ============================================================

  const buildBaseCanonicalJournal = (): {
    transactions: CanonicalTransaction[];
    warnings: string[];
    auditLog: string[];
  } => {
    if (rawData.length === 0) {
      return {
        transactions: [],
        warnings: [],
        auditLog: ['Transformation layer: no direct transaction dataset selected; relying on asset register generation.'],
      };
    }

    if (formatDetection?.format === 'wide') {
      if (!wideConfig?.dateColumn) {
        throw new Error('Select a date column in the conversion wizard.');
      }

      if (wideConfig.incomeColumns.length === 0 && wideConfig.expenseColumns.length === 0) {
        throw new Error('Select at least one income or expense column before conversion.');
      }

      return transformWideDatasetToCanonical(rawData, wideConfig);
    }

    if (!mapping.amount && !mapping.debit && !mapping.credit) {
      throw new Error('Map Amount or Debit/Credit before generating statements.');
    }

    return transformLongDatasetToCanonical(rawData, mapping);
  };

  const buildGeneratedAssetJournal = (): {
    transactions: CanonicalTransaction[];
    warnings: string[];
    auditLog: string[];
    assumptions: string[];
    summaryLines: string[];
    modeUsed: 'asset_module' | 'journal_generation';
    liabilityDetection: LiabilityDetectionResult;
    fallbackNotice: string;
  } => {
    const emptyLiabilityDetection: LiabilityDetectionResult = {
      detected: false,
      reasons: ['No explicit liability indicators detected.'],
      columns: [],
      sheets: [],
      signals: [],
    };

    if (assetsRegisterRows.length === 0) {
      const liabilityResult = generate_liability_journal(uploadedSheets, [], {
        ...liabilityOptions,
        includeAssetFinancingLiabilities: false,
      });

      return {
        transactions: liabilityResult.transactions,
        warnings: [...new Set(liabilityResult.warnings)],
        auditLog: ['No asset register rows provided; generated liability-only supplemental journal.', ...liabilityResult.auditLog],
        assumptions: [...new Set(liabilityResult.assumptions)],
        summaryLines: [
          'Requested mode: journal_generation',
          'Mode used: journal_generation',
          `Net income mode: ${netIncomeToEquityMode}`,
          `net_income_equity_default (medium signal): ${autoNetIncomeDefaultOnMediumSignal}`,
          'Asset rows detected: 0',
          `Generated liability journal rows: ${liabilityResult.transactions.length}`,
        ],
        modeUsed: 'journal_generation',
        liabilityDetection: liabilityResult.detection || emptyLiabilityDetection,
        fallbackNotice: '',
      };
    }

    const resolution = resolve_asset_handling_mode(assetHandlingMode, {
      enabled: assetModuleEnabled,
      flowsToBalanceSheet: assetModuleFlowsToBalanceSheet,
      supportsIngestionFeature: assetModuleSupportsIngestion,
    });

    if (resolution.modeUsed === 'asset_module') {
      return {
        transactions: [],
        warnings: [],
        auditLog: [resolution.message, 'Asset mode asset_module selected; local journal generation skipped.'],
        assumptions: [],
        summaryLines: [
          `Requested mode: ${assetHandlingMode}`,
          `Mode used: ${resolution.modeUsed}`,
          `Net income mode: ${netIncomeToEquityMode}`,
          `net_income_equity_default (medium signal): ${autoNetIncomeDefaultOnMediumSignal}`,
          resolution.userNotice || 'Native asset-module ingestion selected.',
          'Generated journal rows: 0',
        ],
        modeUsed: 'asset_module',
        liabilityDetection: detect_liability_indicators(uploadedSheets, assetsRegisterRows),
        fallbackNotice: '',
      };
    }

    const acquisitionResult = generate_asset_acquisition_journal(assetsRegisterRows, assetAcquisitionOptions);
    let generated = acquisitionResult.transactions;
    const warnings = [...acquisitionResult.warnings];
    const auditLog = [resolution.message, ...acquisitionResult.auditLog];
    const assumptions: string[] = [];

    if (includeDepreciation) {
      const depreciationResult = generate_depreciation_schedule(assetsRegisterRows, {
        ...assetDepreciationOptions,
        reportEndDate: assetDepreciationOptions.reportEndDate || new Date().toISOString().slice(0, 10),
      });

      generated = merge_with_existing_journal(generated, depreciationResult.transactions);
      warnings.push(...depreciationResult.warnings);
      auditLog.push(...depreciationResult.auditLog);
    }

    const liabilityResult = generate_liability_journal(uploadedSheets, assetsRegisterRows, {
      ...liabilityOptions,
      includeAssetFinancingLiabilities: false,
    });
    generated = merge_with_existing_journal(generated, liabilityResult.transactions);
    warnings.push(...liabilityResult.warnings);
    auditLog.push(...liabilityResult.auditLog);
    assumptions.push(...liabilityResult.assumptions);

    return {
      transactions: generated,
      warnings: [...new Set(warnings)],
      auditLog,
      assumptions: [...new Set(assumptions)],
      summaryLines: [
        `Requested mode: ${assetHandlingMode}`,
        `Mode used: ${resolution.modeUsed}`,
        `Net income mode: ${netIncomeToEquityMode}`,
        `net_income_equity_default (medium signal): ${autoNetIncomeDefaultOnMediumSignal}`,
        resolution.userNotice || 'Journal generation mode selected.',
        `Generated journal rows: ${generated.length}`,
        `Liability signals: ${liabilityResult.detection.signals.length}`,
      ],
      modeUsed: 'journal_generation',
      liabilityDetection: liabilityResult.detection,
      fallbackNotice:
        assetHandlingMode === 'auto' && resolution.usedFallback
          ? (resolution.userNotice || '')
          : '',
    };
  };

  const buildOpeningInitializationOffsets = (
    journal: CanonicalTransaction[],
    strategy: OpeningInitializationStrategy = OPENING_INITIALIZATION_STRATEGY
  ): {
    offsets: CanonicalTransaction[];
    eligibleRows: number;
    strategy: OpeningInitializationStrategy;
    totalOffsetDebit: number;
    totalOffsetCredit: number;
  } => {
    const sourceRows = journal.filter(row => {
      if (row.SourceColumn === OPENING_INITIALIZATION_SOURCE_COLUMN || row.SourceColumn === 'Opening_Balance_Fix') {
        return false;
      }
      const hasDebit = (row.Debit || 0) > 0;
      const hasCredit = (row.Credit || 0) > 0;
      return hasDebit !== hasCredit;
    });

    if (sourceRows.length === 0) {
      return {
        offsets: [],
        eligibleRows: 0,
        strategy,
        totalOffsetDebit: 0,
        totalOffsetCredit: 0,
      };
    }

    const offsets: CanonicalTransaction[] = [];
    let nextRowId = -100000;
    const fallbackDate = new Date().toISOString().slice(0, 10);

    if (strategy === 'per_row') {
      for (const row of sourceRows) {
        const hasDebit = (row.Debit || 0) > 0;
        const amount = hasDebit ? row.Debit : row.Credit;
        const date = row.Date && row.Date.trim() ? row.Date : fallbackDate;

        offsets.push({
          Date: date,
          Account: OPENING_INITIALIZATION_CLEARING_ACCOUNT,
          Category: 'current_asset',
          Type: hasDebit ? 'Income' : 'Expense',
          Debit: hasDebit ? 0 : amount,
          Credit: hasDebit ? amount : 0,
          Description: `Auto-generated opening initialization offset for ${row.Account}`,
          SourceColumn: OPENING_INITIALIZATION_SOURCE_COLUMN,
          SourceRow: nextRowId--,
        });
      }
    } else {
      const dailyTotals = new Map<string, { debit: number; credit: number; sourceCount: number }>();

      for (const row of sourceRows) {
        const date = row.Date && row.Date.trim() ? row.Date : fallbackDate;
        const entry = dailyTotals.get(date) || { debit: 0, credit: 0, sourceCount: 0 };
        if ((row.Debit || 0) > 0) {
          entry.credit += row.Debit;
        } else if ((row.Credit || 0) > 0) {
          entry.debit += row.Credit;
        }
        entry.sourceCount += 1;
        dailyTotals.set(date, entry);
      }

      const sortedDates = [...dailyTotals.keys()].sort((a, b) => a.localeCompare(b));
      for (const date of sortedDates) {
        const totals = dailyTotals.get(date)!;
        const net = Math.round((totals.debit - totals.credit) * 100) / 100;
        if (Math.abs(net) <= JOURNAL_LINE_TOLERANCE) continue;

        const isDebit = net > 0;
        const amount = Math.abs(net);
        offsets.push({
          Date: date,
          Account: OPENING_INITIALIZATION_CLEARING_ACCOUNT,
          Category: 'current_asset',
          Type: isDebit ? 'Expense' : 'Income',
          Debit: isDebit ? amount : 0,
          Credit: isDebit ? 0 : amount,
          Description: `Auto-generated opening initialization offset (daily net, ${totals.sourceCount} source rows)`,
          SourceColumn: OPENING_INITIALIZATION_SOURCE_COLUMN,
          SourceRow: nextRowId--,
        });
      }
    }

    const totalOffsetDebit = Math.round(offsets.reduce((sum, row) => sum + (row.Debit || 0), 0) * 100) / 100;
    const totalOffsetCredit = Math.round(offsets.reduce((sum, row) => sum + (row.Credit || 0), 0) * 100) / 100;

    return {
      offsets,
      eligibleRows: sourceRows.length,
      strategy,
      totalOffsetDebit,
      totalOffsetCredit,
    };
  };

  const runReportWithCanonicalJournal = async (
    journal: CanonicalTransaction[],
    warningsFromImport: string[],
    auditLogFromImport: string[],
    fallbackView: FinanceView,
    importSummaryFromWizard: string[] = []
  ) => {
    const validation = validate_journal(journal);
    const liabilityValidation = validate_liability_journal(journal);
    const validationAuditLine = validation.isValid
      ? `Validation layer: passed with ${validation.warnings.length} warnings.`
      : `Validation layer: failed with ${validation.errors.length} errors.`;
    const liabilityAuditLine = liabilityValidation.isValid
      ? `Liability validation: passed with ${liabilityValidation.warnings.length} warnings.`
      : `Liability validation: failed with ${liabilityValidation.errors.length} errors.`;

    const mergedAuditLog = [...auditLogFromImport, ...importSummaryFromWizard, validationAuditLine, liabilityAuditLine];
    setImportAuditLog(mergedAuditLog);
    setCanonicalTransactions(journal);

    if (!validation.isValid) {
      toast.error('Import validation failed. Fix mapping/conversion and try again.');
      validation.errors.slice(0, 8).forEach(error => toast.error(error));
      setView(fallbackView);
      return;
    }

    if (!liabilityValidation.isValid) {
      toast.error('Liability validation failed. Liabilities must remain on Balance Sheet categories.');
      liabilityValidation.errors.slice(0, 8).forEach(error => toast.error(error));
      setView(fallbackView);
      return;
    }

    const canonicalInput = canonicalToReportInput(journal);
    const importWarnings = [...warningsFromImport, ...validation.warnings, ...liabilityValidation.warnings];
    importWarnings.forEach(warning => toast.warning(warning));

    setView('processing');
    setShowOverlay(true);
    setOverlayStage('processing');
    setOverlayProgress(0);
    setOverlayMessage('Starting financial analysis...');

    try {
      const result = await generateFinancialReport(
        canonicalInput.data,
        canonicalInput.mapping,
        {
          period: reportPeriod,
          companyName: companyName || 'My Company',
          netIncomeToEquityMode,
          netIncomeEquityDefault: autoNetIncomeDefaultOnMediumSignal,
        },
        (progress, message) => {
          setOverlayProgress(progress);
          setOverlayMessage(message);
        }
      );

      const reconciliation = compute_asset_reconciliation(journal);
      const reconciliationLine =
        `Reconciliation: Sum(Fixed Assets debits) ${reconciliation.fixedAssetDebits.toFixed(2)} ` +
        `- Sum(asset disposals) ${reconciliation.assetDisposals.toFixed(2)} ` +
        `= ${reconciliation.netFixedAssetMovement.toFixed(2)}. ` +
        `Total Assets shown ${result.balanceSheet.totalAssets.toFixed(2)}.`;

      let finalAuditLog = [...mergedAuditLog, reconciliationLine];

      const augmentedWarnings = [...importWarnings];
      if (assetsRegisterRows.length > 0 && result.balanceSheet.totalAssets === 0) {
        augmentedWarnings.push(
          'Assets Register detected, but Balance Sheet requires asset purchase transactions. We generated journal entries; please review mappings.'
        );
      }

      result.warnings = [...new Set([...result.warnings, ...augmentedWarnings])];

      const difference = Math.abs(
        Math.round((result.balanceSheet.totalAssets - result.balanceSheet.totalLiabilitiesAndEquity) * 100) / 100
      );
      const openingMissing = Boolean(result.reconciliationDiagnostics?.opening.missingOpeningAssets);
      const driftWithinTolerance = difference > 0 && difference <= BALANCE_SHEET_TOLERANCE;
      const shouldBlockForBalance = difference > BALANCE_SHEET_TOLERANCE;
      if (!openingMissing && driftWithinTolerance) {
        finalAuditLog = [
          ...finalAuditLog,
          `Rounding drift accepted: ${difference.toFixed(2)} (tolerance ${BALANCE_SHEET_TOLERANCE.toFixed(2)}).`,
        ];
      }
      if (shouldBlockForBalance || openingMissing) {
        const diagnostics = result.reconciliationDiagnostics;
        const closingEvidence = diagnostics?.closing.evidence.length
          ? diagnostics.closing.evidence.join(' | ')
          : 'none';
        const openingEvidence = diagnostics?.opening.evidence.length
          ? diagnostics.opening.evidence.join(' | ')
          : 'none';
        const totalDebits = Math.round(journal.reduce((sum, row) => sum + (row.Debit || 0), 0) * 100) / 100;
        const totalCredits = Math.round(journal.reduce((sum, row) => sum + (row.Credit || 0), 0) * 100) / 100;
        const journalImbalance = Math.round((totalDebits - totalCredits) * 100) / 100;
        const hasSingleEntryProfile = Math.abs(journalImbalance) > JOURNAL_LINE_TOLERANCE;
        const existingAutoOffsets = journal.filter(row => row.SourceColumn === OPENING_INITIALIZATION_SOURCE_COLUMN).length;
        const previewOffsetBuild = buildOpeningInitializationOffsets(journal);

        const blockLines = [
          `Assets (normal balances): ${result.balanceSheet.totalAssets.toFixed(2)}`,
          `Liabilities: ${result.balanceSheet.totalLiabilities.toFixed(2)}`,
          `Equity: ${result.balanceSheet.totalEquity.toFixed(2)}`,
          `Net Income: ${result.profitAndLoss.netIncome.toFixed(2)}`,
          `Trial debits: ${totalDebits.toFixed(2)}`,
          `Trial credits: ${totalCredits.toFixed(2)}`,
          `Journal imbalance (debits - credits): ${journalImbalance.toFixed(2)}`,
          `Normal-balance rule: ${diagnostics?.normalBalanceRule || 'Assets=Debits-Credits; Liabilities/Equity=Credits-Debits'}`,
          `Closing detected? ${diagnostics?.closing.closingDetected ? 'yes' : 'no'} (${closingEvidence})`,
          `Opening balances detected? ${diagnostics?.opening.openingDetected ? 'yes' : 'no'} (${openingEvidence})`,
        ];
        if (hasSingleEntryProfile && existingAutoOffsets === 0) {
          blockLines.push(
            `Likely cause: single-entry summary data (not full double-entry journal). ` +
            `Opening Balance Initialization (${formatOpeningInitializationStrategy(previewOffsetBuild.strategy)}) will compress ${previewOffsetBuild.eligibleRows.toLocaleString()} source rows into ${previewOffsetBuild.offsets.length.toLocaleString()} balancing offsets.`
          );
        }
        setReconciliationBlockDetails(blockLines);
        setBlockedJournalSnapshot(journal);
        setBlockedFallbackView(fallbackView);

        if (openingMissing) {
          const suggestedAmount =
            diagnostics?.opening.suggestedAmount && diagnostics.opening.suggestedAmount > 0
              ? diagnostics.opening.suggestedAmount
              : difference;
          setOpeningFixSuggestion({
            amount: Math.round(suggestedAmount * 100) / 100,
            date: diagnostics?.opening.firstTransactionDate || new Date().toISOString().split('T')[0],
            debitAccount: diagnostics?.opening.suggestedDebitAccount || 'Cash',
            creditAccount: diagnostics?.opening.suggestedCreditAccount || 'Opening Balance Equity',
          });
        } else {
          setOpeningFixSuggestion(null);
        }

        if (hasSingleEntryProfile && existingAutoOffsets === 0 && previewOffsetBuild.offsets.length > 0) {
          setSingleEntryFixSuggestion({
            offsetRows: previewOffsetBuild.offsets.length,
            sourceRows: previewOffsetBuild.eligibleRows,
            journalImbalance,
            strategy: previewOffsetBuild.strategy,
          });
        } else {
          setSingleEntryFixSuggestion(null);
        }

        const message =
          openingMissing
            ? "Opening balances missing. Balance Sheet can't reconcile without opening assets (Cash/AR/Inventory) to match Liabilities/Equity."
            : `Report generation blocked: Assets must equal Liabilities + Equity. ` +
              `Assets=${result.balanceSheet.totalAssets.toFixed(2)}, ` +
              `Liabilities+Equity=${result.balanceSheet.totalLiabilitiesAndEquity.toFixed(2)}, ` +
              `Difference=${difference.toFixed(2)}.`;
        setImportAuditLog([...finalAuditLog, ...blockLines, message]);
        toast.error(message);
        toast.error('Correct mappings/journal entries and re-run import.');
        setView(fallbackView);
        return;
      }

      setReconciliationBlockDetails([]);
      setBlockedJournalSnapshot([]);
      setBlockedFallbackView('upload');
      setOpeningFixSuggestion(null);
      setSingleEntryFixSuggestion(null);
      setImportAuditLog(finalAuditLog);

      setOverlayStage('complete');
      setOverlayProgress(100);
      setOverlayMessage('Financial report generated!');
      await new Promise(resolve => setTimeout(resolve, 600));

      setReport(result);
      setChartData(generateFinanceChartData(result));
      setView('dashboard');

      if (result.warnings.length > 0) {
        result.warnings.forEach(warning => toast.warning(warning));
      }

      toast.success('Financial statements generated successfully!');
    } catch (error) {
      console.error('Report generation error:', error);
      toast.error('Failed to generate financial report. Please check your data.');
      setView(fallbackView);
    } finally {
      setTimeout(() => {
        setShowOverlay(false);
        setOverlayProgress(0);
      }, 1000);
    }
  };

  const openAssetWizard = (
    baseJournal: CanonicalTransaction[],
    baseWarnings: string[],
    baseAuditLog: string[],
    fallbackView: FinanceView
  ) => {
    setPendingBaseJournal(baseJournal);
    setPendingAssetJournal([]);
    setPendingImportWarnings(baseWarnings);
    setPendingAuditLog([...baseAuditLog, `Asset wizard fallback view: ${fallbackView}`]);
    setPendingFallbackView(fallbackView);
    setAssetPreviewTransactions([]);
    setImportSummaryLines([]);
    setLiabilityAssumptions([]);
    setAssetWizardMessage(
      assetsRegisterRows.length > 0
        ? 'Assets Register detected, but Balance Sheet requires asset purchase transactions. We will generate the required journal entries for you.'
        : 'Liability indicators detected. We will convert liability signals into journal entries for Balance Sheet-safe reporting.'
    );
    setView('assetWizard');
  };

  const confirmAssetJournalGeneration = async () => {
    try {
      const generated = buildGeneratedAssetJournal();
      const mergedJournal = merge_with_existing_journal(pendingBaseJournal, generated.transactions);
      setPendingAssetJournal(generated.transactions);
      setLiabilityDetection(generated.liabilityDetection);
      setLiabilityAssumptions(generated.assumptions);
      setImportSummaryLines(generated.summaryLines);

      if (generated.modeUsed === 'asset_module' && mergedJournal.length === 0) {
        toast.error('Asset module mode selected, but no local transactions are available to build reports. Switch to journal_generation.');
        return;
      }

      if (generated.assumptions.length > 0) {
        generated.assumptions.slice(0, 5).forEach(assumption => toast.warning(`Assumption: ${assumption}`));
      }

      await runReportWithCanonicalJournal(
        mergedJournal,
        [...pendingImportWarnings, ...generated.warnings],
        [...pendingAuditLog, ...generated.auditLog],
        pendingFallbackView,
        [
          ...generated.summaryLines,
          ...generated.assumptions.map(assumption => `Assumption: ${assumption}`),
        ]
      );
    } catch (error: any) {
      toast.error(error?.message || 'Unable to apply selected asset handling mode.');
    }
  };

  const generateReport = async () => {
    const fallbackView: FinanceView = rawData.length > 0
      ? (formatDetection?.format === 'wide' ? 'wideWizard' : 'mapping')
      : 'upload';

    try {
      const base = buildBaseCanonicalJournal();
      const hasLiabilitySignals = Boolean(liabilityDetection?.detected && liabilityDetection.signals.length > 0);
      const isLikelyLiabilityAccount = (accountName: string) => {
        const account = String(accountName || '').toLowerCase().trim();
        if (!account) return false;
        if (
          account.includes('deferred tax expense') ||
          account.includes('deferred tax benefit') ||
          account.includes('deferred tax asset')
        ) {
          return false;
        }
        if (/(payable|loan|debt|accrued|unearned|liability|deferred revenue|deferred income|deferred tax liability)/i.test(account)) {
          return true;
        }
        if (account.includes('deferred')) {
          return account.includes('revenue') || account.includes('income') || account.includes('liability');
        }
        return false;
      };
      const hasLiabilityJournalEntries = base.transactions.some(
        row =>
          row.Category.toLowerCase().includes('liability') ||
          isLikelyLiabilityAccount(row.Account)
      );
      const hasAssetJournalEntries = base.transactions.some(
        row =>
          row.Debit > 0 &&
          (row.Category === 'non_current_asset' || row.Account.toLowerCase().includes('asset'))
      );

      if (assetsRegisterRows.length > 0 && hasAssetJournalEntries) {
        base.auditLog.push(
          'Asset register detected and existing asset journal entries were found; auto-generation was skipped.'
        );
      }

      if (assetsRegisterRows.length > 0 && !hasAssetJournalEntries) {
        openAssetWizard(base.transactions, base.warnings, base.auditLog, fallbackView);
        return;
      }

      if (hasLiabilitySignals && !hasLiabilityJournalEntries) {
        openAssetWizard(base.transactions, base.warnings, base.auditLog, fallbackView);
        return;
      }

      if (base.transactions.length === 0 && (assetsRegisterRows.length > 0 || hasLiabilitySignals)) {
        openAssetWizard([], [], ['No transaction journal detected.'], fallbackView);
        return;
      }

      if (base.transactions.length === 0) {
        toast.error('No transactions available for report generation.');
        return;
      }

      await runReportWithCanonicalJournal(
        base.transactions,
        base.warnings,
        base.auditLog,
        fallbackView
      );
    } catch (error: any) {
      toast.error(error?.message || 'Unable to prepare report generation.');
    }
  };

  const applyOpeningBalanceFix = async () => {
    if (!openingFixSuggestion) {
      toast.error('No opening balance fix is available.');
      return;
    }

    if (blockedJournalSnapshot.length === 0) {
      toast.error('No blocked journal snapshot found. Please regenerate the report.');
      return;
    }

    const fixRows: CanonicalTransaction[] = [
      {
        Date: openingFixSuggestion.date,
        Account: openingFixSuggestion.debitAccount,
        Category: 'current_asset',
        Type: 'Expense',
        Debit: openingFixSuggestion.amount,
        Credit: 0,
        Description: 'Auto-generated opening balance adjustment',
        SourceColumn: 'Opening_Balance_Fix',
        SourceRow: -1,
      },
      {
        Date: openingFixSuggestion.date,
        Account: openingFixSuggestion.creditAccount,
        Category: 'equity',
        Type: 'Income',
        Debit: 0,
        Credit: openingFixSuggestion.amount,
        Description: 'Auto-generated opening balance offset',
        SourceColumn: 'Opening_Balance_Fix',
        SourceRow: -2,
      },
    ];

    const fixedJournal = merge_with_existing_journal(blockedJournalSnapshot, fixRows);
    toast.info(
      `Applied opening fix: Debit ${openingFixSuggestion.debitAccount}, Credit ${openingFixSuggestion.creditAccount}, Amount ${openingFixSuggestion.amount.toFixed(2)}.`
    );

    await runReportWithCanonicalJournal(
      fixedJournal,
      ['Applied one-click opening balance fix before reconciliation.'],
      ['Opening balance fix: auto-generated balancing opening entry was added.'],
      blockedFallbackView
    );
  };

  const applySingleEntryOffsetFix = async () => {
    if (!singleEntryFixSuggestion) {
      toast.error('No Opening Balance Initialization action is available.');
      return;
    }

    if (blockedJournalSnapshot.length === 0) {
      toast.error('No blocked journal snapshot found. Please regenerate the report.');
      return;
    }

    const offsetBuild = buildOpeningInitializationOffsets(blockedJournalSnapshot);
    const offsets = offsetBuild.offsets;

    if (offsets.length === 0) {
      toast.error('No eligible rows found for opening balance initialization.');
      return;
    }

    const fixedJournal = merge_with_existing_journal(blockedJournalSnapshot, offsets);
    toast.info(
      `Applied Opening Balance Initialization (${formatOpeningInitializationStrategy(offsetBuild.strategy)}): generated ${offsets.length} offsets from ${offsetBuild.eligibleRows} source rows.`
    );

    await runReportWithCanonicalJournal(
      fixedJournal,
      ['Applied Opening Balance Initialization before reconciliation.'],
      [
        `Opening Balance Initialization (${formatOpeningInitializationStrategy(offsetBuild.strategy)}): generated ${offsets.length} ${OPENING_INITIALIZATION_CLEARING_ACCOUNT} offset rows from ${offsetBuild.eligibleRows} source rows.`,
        `Opening Balance Initialization totals: Debit ${offsetBuild.totalOffsetDebit.toFixed(2)} | Credit ${offsetBuild.totalOffsetCredit.toFixed(2)}.`,
        `Opening Balance Initialization evidence: prior journal imbalance was ${singleEntryFixSuggestion.journalImbalance.toFixed(2)}.`,
      ],
      blockedFallbackView
    );
  };

  const getAccessToken = async (): Promise<string | null> => {
    if (!supabase) {
      return session?.access_token || null;
    }

    // Prefer the SDK session so we can recover from stale in-memory tokens
    // after third-party payment redirects.
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token) {
      return data.session.access_token;
    }

    // Last resort: force refresh.
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      return session?.access_token || null;
    }

    return refreshed.session?.access_token || session?.access_token || null;
  };

  const hasPaidPDFAccess = async (): Promise<boolean> => {
    if (paidPdfAccessCache?.hasAccess) {
      const cacheAge = Date.now() - paidPdfAccessCache.checkedAt;
      if (cacheAge <= PDF_ACCESS_CACHE_TTL_MS) {
        return true;
      }
    }

    const token = await getAccessToken();
    if (!token) return false;

    const fetchAccessFromBackend = async (timeoutMs: number): Promise<boolean | null> => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(getApiUrl('/api/subscriptions/pdf-access'), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);
        if (response.ok && typeof payload?.has_access === 'boolean') {
          return payload.has_access;
        }

        if (response.status === 401 || response.status === 403) {
          return false;
        }

        return null;
      } catch (apiError) {
        console.error('PDF access check via backend failed:', apiError);
        return null;
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    try {
      let backendAccess = await fetchAccessFromBackend(7000);
      if (backendAccess === null) {
        backendAccess = await fetchAccessFromBackend(12000);
      }

      if (backendAccess !== null) {
        setPaidPdfAccessCache({ hasAccess: backendAccess, checkedAt: Date.now() });
        return backendAccess;
      }
    } catch (apiRetryError) {
      console.error('PDF access check retry failed:', apiRetryError);
    }

    // Fallback to direct Supabase lookup if backend access check is unavailable.
    if (!user?.email || !isSupabaseConfigured || !supabase) return false;

    try {
      const { data, error } = await supabase
        .from('customers')
        .select('subscription_status')
        .eq('email', user.email)
        .limit(5);

      if (error || !data || data.length === 0) {
        if (paidPdfAccessCache?.hasAccess) {
          return true;
        }
        return false;
      }

      const hasAccess = data.some((row) => {
        const status = String(row.subscription_status || '').toLowerCase().trim();
        return PAID_SUBSCRIPTION_STATUSES.has(status);
      });
      setPaidPdfAccessCache({ hasAccess, checkedAt: Date.now() });
      return hasAccess;
    } catch (fallbackError) {
      console.error('Subscription status fallback lookup failed:', fallbackError);
      if (paidPdfAccessCache?.hasAccess) {
        return true;
      }
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
          return_path: window.location.pathname || '/finance',
        }),
      });

      const payload = await response.json();
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

  const verifyPaymentReturn = async () => {
    if (isVerifyingPayment) return;

    const params = new URLSearchParams(window.location.search);
    const paymentState = params.get('pdfPayment');
    const provider = (params.get('provider') || '').toLowerCase();

    if (paymentState === 'cancel') {
      toast.info('Payment was canceled.');
      const nextUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, document.title, nextUrl);
      return;
    }

    if (paymentState !== 'success') return;
    if (provider !== 'stripe' && provider !== 'paystack') return;
    if (!user) return;

    const token = await getAccessToken();
    if (!token) return;

    const sessionId = params.get('session_id');
    const reference = params.get('reference');
    if (provider === 'stripe' && !sessionId) return;
    if (provider === 'paystack' && !reference) return;

    setIsVerifyingPayment(true);
    try {
      const verifyQuery = new URLSearchParams({
        provider,
      });

      if (sessionId) verifyQuery.set('session_id', sessionId);
      if (reference) verifyQuery.set('reference', reference);

      const response = await fetch(getApiUrl(`/api/subscriptions/pdf-verify?${verifyQuery.toString()}`), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json();
      if (!response.ok || !payload?.verified) {
        throw new Error(payload?.error || 'Payment verification failed.');
      }

      setPaidPdfAccessCache({ hasAccess: true, checkedAt: Date.now() });
      setShowPaywall(false);
      toast.success(`Payment verified via ${provider}. PDF access unlocked.`);

      const nextUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, document.title, nextUrl);
    } catch (error: any) {
      console.error('Payment verification error:', error);
      toast.error(error?.message || 'Could not verify payment yet. Please retry shortly.');
    } finally {
      setIsVerifyingPayment(false);
      setCheckoutLoadingProvider(null);
    }
  };

  useEffect(() => {
    verifyPaymentReturn();
    // Intentionally depends on authenticated user/session changes after redirects.
  }, [user, session]);

  const getSingleEntryOffsetRows = (): CanonicalTransaction[] =>
    canonicalTransactions.filter(row => row.SourceColumn === OPENING_INITIALIZATION_SOURCE_COLUMN);

  const escapeCsvField = (value: unknown): string => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const handleDownloadFinancePDF = async () => {
    if (!report || !writtenReport) {
      toast.error('Generate a financial report first.');
      return;
    }

    if (isGeneratingFinancePDF) return;

    const hasAccess = await hasPaidPDFAccess();
    if (!hasAccess) {
      setShowPaywall(true);
      return;
    }

    setIsGeneratingFinancePDF(true);
    try {
      generateFinanceOnePagePDF(report, writtenReport, {
        title: `${report.companyName} One-Page Financial Report`,
        filenamePrefix: `${report.companyName}_one_page_financial_report`,
      });
      toast.success('Finance PDF generated successfully.');
    } catch (error) {
      console.error('Finance PDF generation error:', error);
      toast.error('Unable to generate finance PDF. Please try again.');
    } finally {
      setIsGeneratingFinancePDF(false);
    }
  };

  const handleDownloadOffsetCSV = () => {
    if (!report) {
      toast.error('Generate a financial report first.');
      return;
    }

    const rows = getSingleEntryOffsetRows();
    if (rows.length === 0) {
      toast.error('No auto-generated offset entries found for this report.');
      return;
    }

    const headers = ['Date', 'Account', 'Category', 'Type', 'Debit', 'Credit', 'Description', 'SourceColumn', 'SourceRow'];
    const body = rows.map(row => [
      escapeCsvField(row.Date),
      escapeCsvField(row.Account),
      escapeCsvField(row.Category),
      escapeCsvField(row.Type),
      escapeCsvField(row.Debit),
      escapeCsvField(row.Credit),
      escapeCsvField(row.Description),
      escapeCsvField(row.SourceColumn),
      escapeCsvField(row.SourceRow),
    ].join(','));

    const csv = [headers.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = report.companyName.replace(/[^a-zA-Z0-9_-]+/g, '_');
    anchor.href = url;
    anchor.download = `${safeName}_offset_entries_${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    toast.success(`Downloaded ${rows.length.toLocaleString()} offset rows (CSV).`);
  };

  const handleDownloadOffsetPDFAppendix = () => {
    if (!report) {
      toast.error('Generate a financial report first.');
      return;
    }

    const rows = getSingleEntryOffsetRows();
    if (rows.length === 0) {
      toast.error('No auto-generated offset entries found for this report.');
      return;
    }

    if (isGeneratingOffsetPDF) return;

    setIsGeneratingOffsetPDF(true);
    try {
      generateOffsetEntriesAppendixPDF(report, rows, {
        filenamePrefix: `${report.companyName}_offset_entries_appendix`,
        auditLines: importAuditLog,
      });
      toast.success(`Downloaded offset appendix PDF (${rows.length.toLocaleString()} rows).`);
    } catch (error) {
      console.error('Offset appendix PDF generation error:', error);
      toast.error('Unable to generate offset appendix PDF. Please try again.');
    } finally {
      setIsGeneratingOffsetPDF(false);
    }
  };

  const regenerateWrittenReport = () => {
    if (!report) return;
    setWrittenReport(generateOnePageFinancialNarrative(report));
    toast.success('One-page written report refreshed.');
  };

  const copyWrittenReport = async () => {
    if (!writtenReport) return;

    try {
      await navigator.clipboard.writeText(writtenReport);
      toast.success('Written report copied to clipboard.');
    } catch (error) {
      console.error('Clipboard copy error:', error);
      toast.error('Could not copy report text.');
    }
  };

  // ============================================================
  // HELPERS
  // ============================================================

  const formatCurrency = (amount: number): string => {
    if (amount < 0) return `-$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const computeStartingPositionSnapshot = () => {
    if (!report || canonicalTransactions.length === 0) return null;

    const rowsWithDate = canonicalTransactions.filter(row => row.Date && row.Date.trim() !== '');
    if (rowsWithDate.length === 0) return null;

    const openingDate =
      report.reconciliationDiagnostics?.opening.firstTransactionDate ||
      [...new Set(rowsWithDate.map(row => row.Date))].sort((a, b) => a.localeCompare(b))[0];

    if (!openingDate) return null;

    const openingRows = canonicalTransactions.filter(row => row.Date === openingDate);
    const toCategory = (value: string | undefined): string => (value || '').toLowerCase().trim();
    const isAsset = (value: string): boolean =>
      toCategory(value) === 'current_asset' || toCategory(value) === 'non_current_asset';
    const isLiability = (value: string): boolean =>
      toCategory(value) === 'current_liability' || toCategory(value) === 'non_current_liability';
    const isEquity = (value: string): boolean => toCategory(value) === 'equity';
    const roundMoney = (value: number): number => Math.round(value * 100) / 100;

    const openingAssets = roundMoney(
      openingRows
        .filter(row => isAsset(row.Category))
        .reduce((sum, row) => sum + (row.Debit || 0) - (row.Credit || 0), 0)
    );
    const openingLiabilities = roundMoney(
      openingRows
        .filter(row => isLiability(row.Category))
        .reduce((sum, row) => sum + (row.Credit || 0) - (row.Debit || 0), 0)
    );
    const openingEquity = roundMoney(
      openingRows
        .filter(row => isEquity(row.Category))
        .reduce((sum, row) => sum + (row.Credit || 0) - (row.Debit || 0), 0)
    );

    const syntheticOffsetRows = canonicalTransactions.filter(row => row.SourceColumn === OPENING_INITIALIZATION_SOURCE_COLUMN);
    const openingFixRows = canonicalTransactions.filter(row => row.SourceColumn === 'Opening_Balance_Fix');
    const hasSyntheticInitialization = syntheticOffsetRows.length > 0 || openingFixRows.length > 0;
    const openingDetected = Boolean(report.reconciliationDiagnostics?.opening.openingDetected);

    let sourceType: 'imported' | 'inferred' | 'synthetic' = 'inferred';
    if (hasSyntheticInitialization) {
      sourceType = 'synthetic';
    } else if (openingDetected) {
      sourceType = 'imported';
    }

    const syntheticDebit = roundMoney(
      [...syntheticOffsetRows, ...openingFixRows].reduce((sum, row) => sum + (row.Debit || 0), 0)
    );
    const syntheticCredit = roundMoney(
      [...syntheticOffsetRows, ...openingFixRows].reduce((sum, row) => sum + (row.Credit || 0), 0)
    );

    const description =
      sourceType === 'synthetic'
        ? 'Opening balances were initialized with generated balancing entries and fully logged in the audit trail.'
        : sourceType === 'imported'
          ? 'Opening balances came directly from imported entries on the first transaction date.'
          : 'Opening balances were inferred from first-date postings because explicit opening journals were not provided.';

    return {
      openingDate,
      openingAssets,
      openingLiabilities,
      openingEquity,
      sourceType,
      description,
      syntheticDebit,
      syntheticCredit,
    };
  };

  const setFinanceChartMode = (
    key: keyof typeof financeChartModes,
    value: FinanceChartVisualType
  ) => {
    setFinanceChartModes(prev => ({ ...prev, [key]: value }));
  };

  const StatusBadge: React.FC<{ status: 'healthy' | 'caution' | 'warning' | 'na' }> = ({ status }) => {
    const config = {
      healthy: { color: 'bg-green-100 text-green-700 border-green-300', label: 'Healthy' },
      caution: { color: 'bg-yellow-100 text-yellow-700 border-yellow-300', label: 'Caution' },
      warning: { color: 'bg-red-100 text-red-700 border-red-300', label: 'Warning' },
      na: { color: 'bg-gray-100 text-gray-500 border-gray-300', label: 'N/A' },
    };
    const c = config[status];
    return <Badge className={`${c.color} text-xs border`}>{c.label}</Badge>;
  };

  // Statement table renderer
  const StatementSection: React.FC<{
    title: string;
    items: LineItem[];
    total: number;
    totalLabel: string;
    isPositive?: boolean;
  }> = ({ title, items, total, totalLabel, isPositive }) => (
    <div className="mb-4">
      <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide mb-2 flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-violet-500" />
        {title}
      </h4>
      {items.map((item, idx) => (
        <div key={idx} className="flex justify-between py-1.5 px-4 text-sm hover:bg-gray-50 rounded">
          <span className="text-gray-600">{item.label}</span>
          <span className="font-mono text-gray-800">{formatCurrency(item.amount)}</span>
        </div>
      ))}
      {items.length > 0 && (
        <div className={`flex justify-between py-2 px-4 text-sm font-bold border-t border-b ${isPositive !== undefined ? (isPositive ? 'text-green-700' : 'text-red-700') : 'text-gray-900'}`}>
          <span>{totalLabel}</span>
          <span className="font-mono">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );

  const renderCompactPiePercentLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius = 0,
    outerRadius = 0,
    percent,
  }: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
  }) => {
    if (
      typeof cx !== 'number' ||
      typeof cy !== 'number' ||
      typeof midAngle !== 'number' ||
      typeof percent !== 'number' ||
      percent < 0.08
    ) {
      return null;
    }

    const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text x={x} y={y} fill="#ffffff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  };

  const renderReconciliationBlockCard = () => {
    if (reconciliationBlockDetails.length === 0) return null;

    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-red-800">Report Reconciliation Block</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {reconciliationBlockDetails.map((line, idx) => (
            <p key={idx} className="text-xs text-red-700">{line}</p>
          ))}
          {singleEntryFixSuggestion && (
            <div className="pt-3 rounded-md border-2 border-red-300 bg-white p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">
                  Action Required
                </p>
                <Badge className="bg-red-600 text-white border-transparent">Recommended</Badge>
              </div>
              <Button
                size="default"
                className="w-full h-12 text-base font-bold bg-red-600 hover:bg-red-700 text-white border border-red-700 ring-2 ring-red-300 shadow-lg shadow-red-300/60 animate-pulse"
                onClick={applySingleEntryOffsetFix}
              >
                <AlertTriangle className="h-5 w-5 mr-2" />
                Apply Opening Balance Initialization ({singleEntryFixSuggestion.offsetRows} offsets)
              </Button>
              <p className="mt-2 text-[11px] text-red-700 font-medium">
                Strategy: {formatOpeningInitializationStrategy(singleEntryFixSuggestion.strategy)} compression ({singleEntryFixSuggestion.sourceRows.toLocaleString()} source rows {'->'} {singleEntryFixSuggestion.offsetRows.toLocaleString()} offsets).
              </p>
              <p className="mt-1 text-[11px] text-red-700 font-medium">
                Use this when your file is a summary export (not a full double-entry journal).
              </p>
            </div>
          )}
          {openingFixSuggestion && (
            <div className="pt-2">
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                onClick={applyOpeningBalanceFix}
              >
                Apply One-Click Opening Balance Fix ({openingFixSuggestion.amount.toFixed(2)})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderNetIncomeEquityCheatSheet = () => (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
      <p className="text-xs text-slate-700">
        <span className="font-semibold">Auto:</span> Recommended. We detect closing signals and choose whether to add or skip.
      </p>
      <p className="text-xs text-slate-700">
        <span className="font-semibold">Skip:</span> Earnings already closed into equity.
      </p>
      <p className="text-xs text-slate-700">
        <span className="font-semibold">Add:</span> Earnings not closed; roll net income into equity.
      </p>
    </div>
  );

  // ============================================================
  // RENDER: UPLOAD VIEW
  // ============================================================

  if (view === 'upload') {
    return (
      <div className="space-y-8">
        {/* Hero Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-100 to-teal-100 px-4 py-2 rounded-full">
            <DollarSign className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">Financial Statement Generator</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">
            Generate Your Financial Statements
          </h1>
          <p className="text-gray-500 max-w-2xl mx-auto">
            Upload your income and expenditure data or enter it manually. We&apos;ll generate your
            Profit &amp; Loss, Cash Flow Statement, and Balance Sheet instantly.
          </p>
        </div>

        {/* Company Name */}
        <div className="max-w-md mx-auto">
          <Label htmlFor="company-name" className="text-sm font-medium text-gray-700">Company / Business Name</Label>
          <Input
            id="company-name"
            placeholder="Enter your company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* File Upload */}
          <Card
            className="border-2 border-dashed border-emerald-200 hover:border-emerald-400 transition-colors cursor-pointer group"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <CardContent className="py-12 text-center">
              <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Upload Financial Data</h3>
              <p className="text-sm text-gray-500 mb-4">
                Drag &amp; drop your CSV or Excel file, or click to browse
              </p>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                id="finance-file-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              <label htmlFor="finance-file-upload">
                <Button asChild variant="outline" className="border-emerald-300 text-emerald-600 hover:bg-emerald-50">
                  <span>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Choose File
                  </span>
                </Button>
              </label>
              <div className="mt-4">
                <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-xs text-gray-400 hover:text-emerald-600">
                  <Download className="h-3 w-3 mr-1" />
                  Download Template
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Manual Entry */}
          <Card
            className="border-2 border-dashed border-blue-200 hover:border-blue-400 transition-colors cursor-pointer group"
            onClick={() => setShowManualEntry(!showManualEntry)}
          >
            <CardContent className="py-12 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <FileText className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Enter Manually</h3>
              <p className="text-sm text-gray-500 mb-4">
                Type in your income, expenses, assets, and liabilities directly
              </p>
              <Button variant="outline" className="border-blue-300 text-blue-600 hover:bg-blue-50">
                <Plus className="h-4 w-4 mr-2" />
                Start Entering
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Manual Entry Form */}
        {showManualEntry && (
          <Card className="max-w-5xl mx-auto">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-500" />
                Manual Data Entry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Date</TableHead>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="w-[180px]">Category</TableHead>
                      <TableHead className="w-[120px]">Amount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualRows.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.date}
                            onChange={(e) => updateManualRow(row.id, 'date', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder="e.g., Sales Revenue"
                            value={row.account}
                            onChange={(e) => updateManualRow(row.id, 'account', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.category}
                            onValueChange={(v) => updateManualRow(row.id, 'category', v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Auto-detect" />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value || 'auto'}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={row.amount}
                            onChange={(e) => updateManualRow(row.id, 'amount', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder="Optional"
                            value={row.description}
                            onChange={(e) => updateManualRow(row.id, 'description', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => removeManualRow(row.id)} className="h-7 w-7 p-0">
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div className="flex justify-between mt-4">
                <Button variant="outline" size="sm" onClick={addManualRow}>
                  <Plus className="h-4 w-4 mr-1" /> Add Row
                </Button>
                <Button onClick={processManualEntry} className="bg-gradient-to-r from-blue-600 to-cyan-600">
                  <ChevronRight className="h-4 w-4 mr-1" /> Continue to Mapping
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ============================================================
  // RENDER: WIDE WIZARD VIEW
  // ============================================================

  if (view === 'wideWizard') {
    if (!wideConfig) return null;

    const columnNames = columns.map(c => c.name);
    const measureColumns = columnNames.filter(column => column !== wideConfig.dateColumn);
    const selectedColumns = [...new Set([...wideConfig.incomeColumns, ...wideConfig.expenseColumns])];

    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-gray-800">Wide â†’ Transaction Conversion Wizard</h2>
          <p className="text-gray-600">We detected a WIDE financial dataset. This will be converted into transactions.</p>
        </div>

        {renderReconciliationBlockCard()}

        <Card className="border-cyan-200 bg-cyan-50">
          <CardContent className="py-4 text-sm text-cyan-900 space-y-1">
            <p className="font-medium">Detection Summary</p>
            {formatDetection?.reasons.slice(0, 4).map((reason, index) => (
              <p key={index}>â€¢ {reason}</p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-700">Saved Wide Profiles</Label>
                <Select value={selectedWideProfileId} onValueChange={applyWideProfile}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {wideProfiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="wide-profile-name" className="text-sm font-medium text-gray-700">Profile Name</Label>
                <Input
                  id="wide-profile-name"
                  placeholder="e.g., Monthly Summary Import"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={saveCurrentWideProfile} className="w-full">
                  Save Mapping Profile
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-5 gap-4 pt-2 border-t">
              <div>
                <Label className="text-sm font-medium text-gray-700">Date Column</Label>
                <Select
                  value={wideConfig.dateColumn || 'none'}
                  onValueChange={(value) => setWideConfig(previous => previous ? { ...previous, dateColumn: value === 'none' ? '' : value } : previous)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select date column" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select date column</SelectItem>
                    {columnNames.map(column => (
                      <SelectItem key={column} value={column}>{column}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium text-gray-700">Report Period</Label>
                <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as ReportPeriod)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium text-gray-700">Net Income to Equity Mode</Label>
                <Select value={netIncomeToEquityMode} onValueChange={(v) => setNetIncomeToEquityMode(v as NetIncomeToEquityMode)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">auto (Recommended)</SelectItem>
                    <SelectItem value="always">always</SelectItem>
                    <SelectItem value="never">never</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium text-gray-700">net_income_equity_default (Medium Signal)</Label>
                <Select
                  value={autoNetIncomeDefaultOnMediumSignal}
                  onValueChange={(v) => setAutoNetIncomeDefaultOnMediumSignal(v as NetIncomeAutoMediumSignalDefault)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (Recommended)</SelectItem>
                    <SelectItem value="add">Add Net Income</SelectItem>
                    <SelectItem value="skip">Skip Net Income</SelectItem>
                  </SelectContent>
                </Select>
                {renderNetIncomeEquityCheatSheet()}
              </div>

              <div>
                <Label htmlFor="wide-default-description" className="text-sm font-medium text-gray-700">Default Description</Label>
                <Input
                  id="wide-default-description"
                  value={wideConfig.defaultDescription || ''}
                  onChange={(event) =>
                    setWideConfig(previous => previous ? { ...previous, defaultDescription: event.target.value } : previous)
                  }
                  className="mt-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Column Role Assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[320px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Column</TableHead>
                    <TableHead className="w-[180px]">Role</TableHead>
                    <TableHead>Account (Optional)</TableHead>
                    <TableHead>Category (Optional)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {measureColumns.map(column => {
                    const role = wideConfig.incomeColumns.includes(column)
                      ? 'income'
                      : wideConfig.expenseColumns.includes(column)
                        ? 'expense'
                        : 'ignore';

                    return (
                      <TableRow key={column}>
                        <TableCell className="font-medium">{column}</TableCell>
                        <TableCell>
                          <Select
                            value={role}
                            onValueChange={(value) => {
                              if (value === 'ignore') {
                                clearWideColumnSelection(column);
                                return;
                              }

                              toggleWideColumnSelection(column, value as 'income' | 'expense');
                            }}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ignore">Ignore</SelectItem>
                              <SelectItem value="income">Income (Credit)</SelectItem>
                              <SelectItem value="expense">Expense (Debit)</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={wideConfig.accountMappings[column] || ''}
                            onChange={(event) => updateWideColumnMapping(column, 'account', event.target.value)}
                            placeholder={column}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={wideConfig.categoryMappings[column] || ''}
                            onChange={(event) => updateWideColumnMapping(column, 'category', event.target.value)}
                            placeholder={column}
                            className="h-8"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated Transaction Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {previewWarnings.map((warning, index) => (
              <p key={index} className="text-xs text-amber-700">{warning}</p>
            ))}

            {selectedColumns.length === 0 ? (
              <p className="text-sm text-gray-500">Select income/expense columns to generate a preview.</p>
            ) : (
              <>
                <ScrollArea className="max-h-[300px] border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Debit</TableHead>
                        <TableHead>Credit</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>SourceColumn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewTransactions.map((transaction, index) => (
                        <TableRow key={`${transaction.SourceRow}-${transaction.SourceColumn}-${index}`}>
                          <TableCell className="text-xs">{transaction.Date}</TableCell>
                          <TableCell className="text-xs">{transaction.Account}</TableCell>
                          <TableCell className="text-xs">{transaction.Category}</TableCell>
                          <TableCell className="text-xs">{transaction.Type}</TableCell>
                          <TableCell className="text-xs">{transaction.Debit}</TableCell>
                          <TableCell className="text-xs">{transaction.Credit}</TableCell>
                          <TableCell className="text-xs">{transaction.Description}</TableCell>
                          <TableCell className="text-xs">{transaction.SourceColumn}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <p className="text-xs text-gray-500">
                  Showing first {previewTransactions.length} generated transactions. Conversion only happens after confirmation.
                </p>
                {previewAuditLog.length > 0 && (
                  <div className="rounded bg-gray-50 border p-3">
                    <p className="text-xs font-medium text-gray-700 mb-1">Audit Trail Preview</p>
                    {previewAuditLog.slice(0, 4).map((line, index) => (
                      <p key={index} className="text-xs text-gray-600">{line}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setView('upload');
              resetImportSession();
            }}
          >
            Back
          </Button>
          <Button
            onClick={generateReport}
            className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700"
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Confirm Conversion &amp; Generate Statements
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: ASSET WIZARD VIEW
  // ============================================================

  if (view === 'assetWizard') {
    const fallbackView: FinanceView = pendingFallbackView;

    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-gray-800">Asset/Liability Conversion Wizard</h2>
          <p className="text-gray-600">
            Supplemental entries are required so assets and liabilities flow correctly to the Balance Sheet.
          </p>
        </div>

        {renderReconciliationBlockCard()}

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-900 space-y-2">
            <p className="font-medium">
              {assetWizardMessage || 'Assets Register detected, but Balance Sheet requires asset purchase transactions. We will generate the required journal entries for you.'}
            </p>
            <p>Assets detected: {assetsRegisterRows.length}</p>
            {assetsRegisterSheetName && <p>Source sheet: {assetsRegisterSheetName}</p>}
            <p>Asset-module configured: {assetModuleReady ? 'Yes' : 'No'}</p>
            <p>Current requested mode: {assetHandlingMode}</p>
            {resolvedAssetHandlingSummary && (
              <p className="text-amber-800">{resolvedAssetHandlingSummary}</p>
            )}
          </CardContent>
        </Card>

        {sheetDetectionSummary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detected Sheets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {sheetDetectionSummary.map((line, index) => (
                <p key={index} className="text-xs text-gray-600">{line}</p>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generation Rules</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-4">
            <div>
              <Label className="text-sm font-medium text-gray-700">Asset Handling Mode</Label>
              <Select
                value={assetHandlingMode}
                onValueChange={(value) => setAssetHandlingMode(value as AssetHandlingMode)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (Recommended)</SelectItem>
                  <SelectItem value="asset_module">asset_module</SelectItem>
                  <SelectItem value="journal_generation">journal_generation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Net Income to Equity Mode</Label>
              <Select value={netIncomeToEquityMode} onValueChange={(value) => setNetIncomeToEquityMode(value as NetIncomeToEquityMode)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (Recommended)</SelectItem>
                  <SelectItem value="always">always</SelectItem>
                  <SelectItem value="never">never</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">net_income_equity_default (Medium Signal)</Label>
              <Select
                value={autoNetIncomeDefaultOnMediumSignal}
                onValueChange={(value) =>
                  setAutoNetIncomeDefaultOnMediumSignal(value as NetIncomeAutoMediumSignalDefault)
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Recommended)</SelectItem>
                  <SelectItem value="add">Add Net Income</SelectItem>
                  <SelectItem value="skip">Skip Net Income</SelectItem>
                </SelectContent>
              </Select>
              {renderNetIncomeEquityCheatSheet()}
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Acquisition Credit Account</Label>
              <Select
                value={assetAcquisitionOptions.creditAccount}
                onValueChange={(value) =>
                  setAssetAcquisitionOptions({
                    ...assetAcquisitionOptions,
                    creditAccount: value as 'Cash' | 'Accounts Payable' | 'Loan Payable',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash (Default)</SelectItem>
                  <SelectItem value="Accounts Payable">Accounts Payable (Financing)</SelectItem>
                  <SelectItem value="Loan Payable">Loan Payable (Financing)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Respect Financing Type</Label>
              <Select
                value={assetAcquisitionOptions.respectFinancingType === false ? 'no' : 'yes'}
                onValueChange={(value) =>
                  setAssetAcquisitionOptions({
                    ...assetAcquisitionOptions,
                    respectFinancingType: value === 'yes',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (Recommended)</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Include Monthly Depreciation</Label>
              <Select
                value={includeDepreciation ? 'yes' : 'no'}
                onValueChange={(value) => setIncludeDepreciation(value === 'yes')}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (Recommended)</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Depreciation Start</Label>
              <Select
                value={assetDepreciationOptions.startFrom}
                onValueChange={(value) =>
                  setAssetDepreciationOptions({
                    ...assetDepreciationOptions,
                    startFrom: value as 'acquisition_month' | 'next_month',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="next_month">Next Month</SelectItem>
                  <SelectItem value="acquisition_month">Acquisition Month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Include Liability Column Conversion</Label>
              <Select
                value={liabilityOptions.includeDetectedSheetLiabilities ? 'yes' : 'no'}
                onValueChange={(value) =>
                  setLiabilityOptions({
                    ...liabilityOptions,
                    includeDetectedSheetLiabilities: value === 'yes',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (Recommended)</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Default Financing Liability</Label>
              <Select
                value={liabilityOptions.defaultAssetFinancingLiabilityAccount}
                onValueChange={(value) =>
                  setLiabilityOptions({
                    ...liabilityOptions,
                    defaultAssetFinancingLiabilityAccount: value as 'Accounts Payable' | 'Loan Payable',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accounts Payable">Accounts Payable</SelectItem>
                  <SelectItem value="Loan Payable">Loan Payable</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {importSummaryLines.length > 0 ? (
              importSummaryLines.map((line, index) => (
                <p key={index} className="text-xs text-slate-700">{line}</p>
              ))
            ) : (
              <p className="text-xs text-slate-600">Preview summary will update as you change options.</p>
            )}
            {liabilityDetection && (
              <p className="text-xs text-slate-600">
                Liability signals detected: {liabilityDetection.signals.length}
              </p>
            )}
          </CardContent>
        </Card>

        {liabilityAssumptions.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-base text-amber-900">Assumptions (Review Required)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {liabilityAssumptions.slice(0, 8).map((line, index) => (
                <p key={index} className="text-xs text-amber-800">{line}</p>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview of Generated Journal Entries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ScrollArea className="max-h-[320px] border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Debit</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>SourceSheet</TableHead>
                    <TableHead>SourceAssetID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetPreviewTransactions.map((row, index) => (
                    <TableRow key={`${row.SourceRow}-${row.SourceAssetID || 'na'}-${index}`}>
                      <TableCell className="text-xs">{row.Date}</TableCell>
                      <TableCell className="text-xs">{row.Account}</TableCell>
                      <TableCell className="text-xs">{row.Category}</TableCell>
                      <TableCell className="text-xs">{row.Type}</TableCell>
                      <TableCell className="text-xs">{row.Debit}</TableCell>
                      <TableCell className="text-xs">{row.Credit}</TableCell>
                      <TableCell className="text-xs">{row.Description}</TableCell>
                      <TableCell className="text-xs">{row.SourceSheet || ''}</TableCell>
                      <TableCell className="text-xs">{row.SourceAssetID || ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            <p className="text-xs text-gray-500">
              Preview shows the first {assetPreviewTransactions.length} generated entries. Confirm to merge with your journal.
            </p>
            {assetPreviewTransactions.length === 0 && (
              <p className="text-xs text-amber-700">
                No local supplemental journal rows are currently generated for this mode.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setView(fallbackView)}>
            Back
          </Button>
          <Button
            onClick={confirmAssetJournalGeneration}
            className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Confirm Preview &amp; Continue
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: MAPPING VIEW
  // ============================================================

  if (view === 'mapping') {
    const columnNames = columns.map(c => c.name);

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-gray-800">Confirm Column Mapping</h2>
          <p className="text-gray-500">We&apos;ve auto-detected your columns. Adjust if needed.</p>
        </div>

        {renderReconciliationBlockCard()}

        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-4 text-sm text-emerald-900">
            Detected format: LONG financial dataset. Continue with transaction-level mapping.
            {sheetDetectionSummary.length > 0 && (
              <div className="mt-2 space-y-1">
                {sheetDetectionSummary.map((line, index) => (
                  <p key={index} className="text-xs text-emerald-800">{line}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-700">Saved Long Profiles</Label>
                <Select value={selectedLongProfileId} onValueChange={applyLongProfile}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {longProfiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="long-profile-name" className="text-sm font-medium text-gray-700">Profile Name</Label>
                <Input
                  id="long-profile-name"
                  placeholder="e.g., General Ledger Import"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={saveCurrentLongProfile} className="w-full">
                  Save Mapping Profile
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              {(['date', 'account', 'category', 'type', 'debit', 'credit', 'description', 'amount'] as const).map(field => (
                <div key={field}>
                  <Label className="text-sm font-medium text-gray-700 capitalize">
                    {field === 'type' ? 'Type (Income/Expense)' : field}
                  </Label>
                  <Select
                    value={mapping[field] || 'none'}
                    onValueChange={(v) => setMapping(prev => ({ ...prev, [field]: v === 'none' ? undefined : v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not mapped</SelectItem>
                      {columnNames.map(col => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Period selector */}
            <div className="pt-4 border-t">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Report Period</Label>
                  <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as ReportPeriod)}>
                    <SelectTrigger className="mt-1 max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">Net Income to Equity Mode</Label>
                  <Select value={netIncomeToEquityMode} onValueChange={(v) => setNetIncomeToEquityMode(v as NetIncomeToEquityMode)}>
                    <SelectTrigger className="mt-1 max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto (Recommended)</SelectItem>
                      <SelectItem value="always">always</SelectItem>
                      <SelectItem value="never">never</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">net_income_equity_default (Medium Signal)</Label>
                  <Select
                    value={autoNetIncomeDefaultOnMediumSignal}
                    onValueChange={(v) => setAutoNetIncomeDefaultOnMediumSignal(v as NetIncomeAutoMediumSignalDefault)}
                  >
                    <SelectTrigger className="mt-1 max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Recommended)</SelectItem>
                      <SelectItem value="add">Add Net Income</SelectItem>
                      <SelectItem value="skip">Skip Net Income</SelectItem>
                    </SelectContent>
                  </Select>
                  {renderNetIncomeEquityCheatSheet()}
                </div>
              </div>
            </div>

            {/* Data Preview */}
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Data Preview (First 5 Rows)</h4>
              <ScrollArea className="max-h-[200px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columnNames.map(col => (
                        <TableHead key={col} className="text-xs">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawData.slice(0, 5).map((row, idx) => (
                      <TableRow key={idx}>
                        {columnNames.map(col => (
                          <TableCell key={col} className="text-xs py-1">{String(row[col] ?? '')}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setView('upload');
              resetImportSession();
            }}
          >
            Back
          </Button>
          <Button onClick={generateReport} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            <BarChart3 className="h-4 w-4 mr-2" />
            Generate Financial Statements
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: PROCESSING VIEW (overlay handles this)
  // ============================================================

  if (view === 'processing') {
    return (
      <>
        <DataProcessingOverlay
          isVisible={showOverlay}
          stage={overlayStage}
          progress={overlayProgress}
          message={overlayMessage}
        />
        <div className="text-center py-20 text-gray-400">
          <RefreshCw className="h-12 w-12 mx-auto animate-spin text-emerald-300" />
          <p className="mt-4">Generating your financial statements...</p>
        </div>
      </>
    );
  }

  // ============================================================
  // RENDER: DASHBOARD VIEW
  // ============================================================

  if (!report || !chartData) return null;

  const pnl = report.profitAndLoss;
  const bs = report.balanceSheet;
  const cf = report.cashFlow;
  const singleEntryOffsetRows = getSingleEntryOffsetRows();
  const isSingleEntryAdjusted = singleEntryOffsetRows.length > 0;
  const startingPosition = computeStartingPositionSnapshot();
  const expenseBreakdownSeries = chartData.expenseBreakdown.map(item => ({ category: item.name, value: item.value }));
  const assetAllocationSeries = chartData.assetAllocation.map(item => ({ category: item.name, value: item.value }));
  const profitabilityMarginSeries = chartData.profitabilityMargins.map(item => ({ category: item.name, value: item.value, color: item.color }));

  return (
    <div className="space-y-6">
      {/* Processing Overlay (for regeneration) */}
      <DataProcessingOverlay
        isVisible={showOverlay}
        stage={overlayStage}
        progress={overlayProgress}
        message={overlayMessage}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-emerald-600" />
            {report.companyName}
          </h1>
          <p className="text-sm text-gray-500">{report.reportPeriod} &middot; Generated {report.generatedAt.toLocaleDateString()}</p>
          {isSingleEntryAdjusted && (
            <UiTooltip>
              <UiTooltipTrigger asChild>
                <Badge className="mt-2 bg-amber-100 text-amber-800 border border-amber-300 cursor-help">
                  Single-entry adjusted - {singleEntryOffsetRows.length.toLocaleString()} auto-generated offsets
                </Badge>
              </UiTooltipTrigger>
              <UiTooltipContent className="max-w-xs text-xs">
                Single-entry adjusted means we created balancing opening offsets so a single-entry summary import can reconcile like a double-entry journal.
              </UiTooltipContent>
            </UiTooltip>
          )}
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {isSingleEntryAdjusted && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadOffsetCSV}
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Offset CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadOffsetPDFAppendix}
                disabled={isGeneratingOffsetPDF}
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                {isGeneratingOffsetPDF ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-1" />
                    Offset Appendix PDF
                  </>
                )}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadFinancePDF}
            disabled={isGeneratingFinancePDF}
          >
            {isGeneratingFinancePDF ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Download PDF (Paid)
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setView('upload');
              setReport(null);
              setChartData(null);
              resetImportSession();
            }}
          >
            <Upload className="h-4 w-4 mr-1" /> New Report
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="py-3">
            {report.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-orange-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {startingPosition && (
        <Card
          className={
            startingPosition.sourceType === 'synthetic'
              ? 'border-amber-200 bg-amber-50'
              : startingPosition.sourceType === 'imported'
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-sky-200 bg-sky-50'
          }
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-800">Starting Position</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={
                  startingPosition.sourceType === 'synthetic'
                    ? 'bg-amber-200 text-amber-900 border border-amber-300'
                    : startingPosition.sourceType === 'imported'
                      ? 'bg-emerald-200 text-emerald-900 border border-emerald-300'
                      : 'bg-sky-200 text-sky-900 border border-sky-300'
                }
              >
                {startingPosition.sourceType === 'synthetic'
                  ? 'Synthetic initialization'
                  : startingPosition.sourceType === 'imported'
                    ? 'Imported opening balances'
                    : 'Inferred opening balances'}
              </Badge>
              <p className="text-xs text-slate-700">As of {startingPosition.openingDate}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="rounded border border-white/70 bg-white/70 p-2">
                <p className="text-[11px] text-slate-500">Opening Assets</p>
                <p className="text-sm font-semibold text-slate-800">{formatCurrency(startingPosition.openingAssets)}</p>
              </div>
              <div className="rounded border border-white/70 bg-white/70 p-2">
                <p className="text-[11px] text-slate-500">Opening Liabilities</p>
                <p className="text-sm font-semibold text-slate-800">{formatCurrency(startingPosition.openingLiabilities)}</p>
              </div>
              <div className="rounded border border-white/70 bg-white/70 p-2">
                <p className="text-[11px] text-slate-500">Opening Equity</p>
                <p className="text-sm font-semibold text-slate-800">{formatCurrency(startingPosition.openingEquity)}</p>
              </div>
            </div>

            <p className="text-xs text-slate-700">{startingPosition.description}</p>

            {startingPosition.sourceType === 'synthetic' && (
              <p className="text-xs text-amber-900">
                Synthetic balancing totals: Debit {formatCurrency(startingPosition.syntheticDebit)} | Credit {formatCurrency(startingPosition.syntheticCredit)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {importAuditLog.length > 0 && (
        <Card className="border-slate-200 bg-slate-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">Import Audit Trail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {importAuditLog.slice(0, 10).map((line, index) => (
              <p key={index} className="text-xs text-slate-600">{line}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">Total Revenue</span>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-xl font-bold text-emerald-700">{formatCurrency(pnl.totalRevenue)}</p>
        </Card>

        <Card className={`p-4 bg-gradient-to-br ${pnl.netIncome >= 0 ? 'from-green-50 to-white border-green-100' : 'from-red-50 to-white border-red-100'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">Net Income</span>
            {pnl.netIncome >= 0 ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />}
          </div>
          <p className={`text-xl font-bold ${pnl.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {formatCurrency(pnl.netIncome)}
          </p>
          <p className="text-xs text-gray-400">{pnl.netMargin.toFixed(1)}% margin</p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-blue-50 to-white border-blue-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">Total Assets</span>
            <Landmark className="h-4 w-4 text-blue-500" />
          </div>
          <p className="text-xl font-bold text-blue-700">{formatCurrency(bs.totalAssets)}</p>
        </Card>

        <Card className={`p-4 bg-gradient-to-br ${cf.netCashChange >= 0 ? 'from-cyan-50 to-white border-cyan-100' : 'from-orange-50 to-white border-orange-100'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 font-medium">Net Cash Flow</span>
            <Wallet className="h-4 w-4 text-cyan-500" />
          </div>
          <p className={`text-xl font-bold ${cf.netCashChange >= 0 ? 'text-cyan-700' : 'text-orange-700'}`}>
            {formatCurrency(cf.netCashChange)}
          </p>
        </Card>
      </div>

      {/* Financial Health Score */}
      <Card className="p-4 bg-gradient-to-r from-violet-50 via-purple-50 to-fuchsia-50 border-violet-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white ${
              report.healthScore >= 70 ? 'bg-green-500' : report.healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
            }`}>
              {report.healthScore}
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Heart className="h-4 w-4 text-violet-500" />
                Financial Health Score
              </h3>
              <p className="text-sm text-gray-500">
                {report.healthScore >= 70 ? 'Your business is in good financial health' :
                 report.healthScore >= 40 ? 'Some areas need attention' :
                 'Significant financial concerns detected'}
              </p>
            </div>
          </div>
          <Badge className={`${
            report.healthScore >= 70 ? 'bg-green-500' : report.healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
          }`}>
            {report.healthScore >= 70 ? 'Strong' : report.healthScore >= 40 ? 'Fair' : 'Weak'}
          </Badge>
        </div>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1.5 rounded-2xl border border-border/80 bg-gradient-to-r from-background via-background to-primary/5 p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] flex-nowrap overflow-x-auto">
          <TabsTrigger value="pnl" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <DollarSign className="h-4 w-4 mr-2" />
            Profit &amp; Loss
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <Activity className="h-4 w-4 mr-2" />
            Cash Flow
          </TabsTrigger>
          <TabsTrigger value="balance" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <Scale className="h-4 w-4 mr-2" />
            Balance Sheet
          </TabsTrigger>
          <TabsTrigger value="ratios" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <Shield className="h-4 w-4 mr-2" />
            Ratios &amp; Health
          </TabsTrigger>
          <TabsTrigger value="charts" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <BarChart3 className="h-4 w-4 mr-2" />
            Visualizations
          </TabsTrigger>
          <TabsTrigger value="written" className="shrink-0 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-border hover:bg-background hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-[0_6px_18px_rgba(37,99,235,0.2)]">
            <FileText className="h-4 w-4 mr-2" />
            Written Report
          </TabsTrigger>
        </TabsList>

        {/* ---- P&L Tab ---- */}
        <TabsContent value="pnl" className="p-6">
          <Card>
            <CardHeader className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Profit &amp; Loss Statement
              </CardTitle>
              <p className="text-sm text-gray-500">{report.reportPeriod}</p>
            </CardHeader>
            <CardContent className="pt-6">
              <StatementSection title="Revenue" items={pnl.revenue} total={pnl.totalRevenue} totalLabel="Total Revenue" isPositive={true} />
              <StatementSection title="Cost of Goods Sold" items={pnl.costOfGoodsSold} total={pnl.totalCOGS} totalLabel="Total COGS" />

              <div className={`flex justify-between py-3 px-4 text-sm font-bold bg-emerald-50 rounded-lg mb-4 ${pnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                <span>Gross Profit</span>
                <div className="text-right">
                  <span className="font-mono">{formatCurrency(pnl.grossProfit)}</span>
                  <span className="text-xs ml-2 opacity-70">({pnl.grossMargin.toFixed(1)}%)</span>
                </div>
              </div>

              <StatementSection title="Operating Expenses" items={pnl.operatingExpenses} total={pnl.totalOperatingExpenses} totalLabel="Total Operating Expenses" />

              <div className={`flex justify-between py-3 px-4 text-sm font-bold bg-blue-50 rounded-lg mb-4 ${pnl.operatingIncome >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                <span>Operating Income (EBIT)</span>
                <span className="font-mono">{formatCurrency(pnl.operatingIncome)}</span>
              </div>

              {pnl.otherIncome.length > 0 && (
                <StatementSection title="Other Income" items={pnl.otherIncome} total={pnl.totalOtherIncome} totalLabel="Total Other Income" isPositive={true} />
              )}
              {pnl.otherExpenses.length > 0 && (
                <StatementSection title="Other Expenses" items={pnl.otherExpenses} total={pnl.totalOtherExpenses} totalLabel="Total Other Expenses" />
              )}

              {pnl.taxExpense > 0 && (
                <div className="flex justify-between py-1.5 px-4 text-sm">
                  <span className="text-gray-600">Income Tax Expense</span>
                  <span className="font-mono text-gray-800">{formatCurrency(pnl.taxExpense)}</span>
                </div>
              )}

              <Separator className="my-4" />
              <div className={`flex justify-between py-4 px-4 text-lg font-bold rounded-lg ${pnl.netIncome >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <span>Net Income</span>
                <div className="text-right">
                  <span className="font-mono">{formatCurrency(pnl.netIncome)}</span>
                  <span className="text-sm ml-2 opacity-70">({pnl.netMargin.toFixed(1)}% margin)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Cash Flow Tab ---- */}
        <TabsContent value="cashflow" className="p-6">
          <Card>
            <CardHeader className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-cyan-600" />
                Cash Flow Statement
              </CardTitle>
              <p className="text-sm text-gray-500">{report.reportPeriod}</p>
            </CardHeader>
            <CardContent className="pt-6">
              <StatementSection title="Operating Activities" items={cf.operatingActivities} total={cf.netOperatingCashFlow} totalLabel="Net Cash from Operations" isPositive={cf.netOperatingCashFlow >= 0} />
              <StatementSection title="Investing Activities" items={cf.investingActivities} total={cf.netInvestingCashFlow} totalLabel="Net Cash from Investing" isPositive={cf.netInvestingCashFlow >= 0} />
              <StatementSection title="Financing Activities" items={cf.financingActivities} total={cf.netFinancingCashFlow} totalLabel="Net Cash from Financing" isPositive={cf.netFinancingCashFlow >= 0} />

              <Separator className="my-4" />
              <div className={`flex justify-between py-3 px-4 text-sm font-bold rounded-lg ${cf.netCashChange >= 0 ? 'bg-cyan-50 text-cyan-800' : 'bg-orange-50 text-orange-800'}`}>
                <span>Net Change in Cash</span>
                <span className="font-mono">{formatCurrency(cf.netCashChange)}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <Card className="p-3 bg-gray-50">
                  <p className="text-xs text-gray-500">Beginning Cash</p>
                  <p className="text-lg font-bold text-gray-700">{formatCurrency(cf.beginningCash)}</p>
                </Card>
                <Card className="p-3 bg-gray-50">
                  <p className="text-xs text-gray-500">Ending Cash</p>
                  <p className="text-lg font-bold text-gray-700">{formatCurrency(cf.endingCash)}</p>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Balance Sheet Tab ---- */}
        <TabsContent value="balance" className="p-6">
          <Card>
            <CardHeader className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Scale className="h-5 w-5 text-blue-600" />
                    Balance Sheet
                  </CardTitle>
                  <p className="text-sm text-gray-500">As of {bs.asOfDate}</p>
                </div>
                {bs.isBalanced ? (
                  <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Balanced</Badge>
                ) : (
                  <Badge className="bg-orange-500"><AlertTriangle className="h-3 w-3 mr-1" /> Not Balanced</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Assets */}
                <div>
                  <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center gap-2">
                    <Landmark className="h-5 w-5 text-blue-500" />
                    Assets
                  </h3>
                  <StatementSection title="Current Assets" items={bs.currentAssets} total={bs.totalCurrentAssets} totalLabel="Total Current Assets" />
                  <StatementSection title="Non-Current Assets" items={bs.nonCurrentAssets} total={bs.totalNonCurrentAssets} totalLabel="Total Non-Current Assets" />
                  <div className="flex justify-between py-3 px-4 text-sm font-bold bg-blue-50 text-blue-800 rounded-lg">
                    <span>Total Assets</span>
                    <span className="font-mono">{formatCurrency(bs.totalAssets)}</span>
                  </div>
                </div>

                {/* Liabilities & Equity */}
                <div>
                  <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center gap-2">
                    <Scale className="h-5 w-5 text-indigo-500" />
                    Liabilities &amp; Equity
                  </h3>
                  <StatementSection title="Current Liabilities" items={bs.currentLiabilities} total={bs.totalCurrentLiabilities} totalLabel="Total Current Liabilities" />
                  <StatementSection title="Non-Current Liabilities" items={bs.nonCurrentLiabilities} total={bs.totalNonCurrentLiabilities} totalLabel="Total Non-Current Liabilities" />
                  <StatementSection title="Equity" items={bs.equity} total={bs.totalEquity} totalLabel="Total Equity" isPositive={true} />
                  <div className="flex justify-between py-3 px-4 text-sm font-bold bg-indigo-50 text-indigo-800 rounded-lg">
                    <span>Total Liabilities &amp; Equity</span>
                    <span className="font-mono">{formatCurrency(bs.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Ratios Tab ---- */}
        <TabsContent value="ratios" className="p-6">
          <div className="grid md:grid-cols-3 gap-4">
            {report.ratioInterpretations.map((ratio, idx) => (
              <Card key={idx} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{ratio.name}</span>
                  <StatusBadge status={ratio.status} />
                </div>
                <p className="text-2xl font-bold text-gray-900 mb-1">{ratio.formatted}</p>
                <p className="text-xs text-gray-500">{ratio.description}</p>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---- Charts Tab ---- */}
        <TabsContent value="charts" className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Revenue vs Expenses */}
            <Card className="p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-500" />
                  Revenue vs Expenses
                </h4>
                <Select
                  value={financeChartModes.revenueVsExpenses}
                  onValueChange={(value) =>
                    setFinanceChartMode('revenueVsExpenses', value as FinanceChartVisualType)
                  }
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCE_CHART_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {FINANCE_CHART_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {financeChartModes.revenueVsExpenses === 'table' ? (
                <div className="h-[250px] overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Category</th>
                        <th className="text-right p-2">Revenue</th>
                        <th className="text-right p-2">Expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.revenueVsExpenses.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2">{row.category}</td>
                          <td className="p-2 text-right">{formatCurrency(row.revenue)}</td>
                          <td className="p-2 text-right">{formatCurrency(row.expenses)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  {financeChartModes.revenueVsExpenses === 'bar' ? (
                    <BarChart data={chartData.revenueVsExpenses}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Bar dataKey="revenue" fill={POSITIVE_CHART_COLOR} name="Revenue" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" fill={NEGATIVE_CHART_COLOR} name="Expenses" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : financeChartModes.revenueVsExpenses === 'line' ? (
                    <LineChart data={chartData.revenueVsExpenses}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke={POSITIVE_CHART_COLOR} strokeWidth={2.5} name="Revenue" />
                      <Line type="monotone" dataKey="expenses" stroke={NEGATIVE_CHART_COLOR} strokeWidth={2.5} name="Expenses" />
                    </LineChart>
                  ) : financeChartModes.revenueVsExpenses === 'area' ? (
                    <AreaChart data={chartData.revenueVsExpenses}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Area type="monotone" dataKey="revenue" stroke={POSITIVE_CHART_COLOR} fill={POSITIVE_CHART_COLOR} fillOpacity={0.25} name="Revenue" />
                      <Area type="monotone" dataKey="expenses" stroke={NEGATIVE_CHART_COLOR} fill={NEGATIVE_CHART_COLOR} fillOpacity={0.2} name="Expenses" />
                    </AreaChart>
                  ) : financeChartModes.revenueVsExpenses === 'pie' ? (
                    <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <Pie
                        data={[
                          { name: 'Revenue', value: chartData.revenueVsExpenses.reduce((sum, row) => sum + (row.revenue || 0), 0) },
                          { name: 'Expenses', value: chartData.revenueVsExpenses.reduce((sum, row) => sum + (row.expenses || 0), 0) },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={34}
                        outerRadius={78}
                        dataKey="value"
                        nameKey="name"
                      >
                        <Cell fill={POSITIVE_CHART_COLOR} />
                        <Cell fill={NEGATIVE_CHART_COLOR} />
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                    </PieChart>
                  ) : (
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" name="Revenue" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="y" name="Expenses" tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name) => [formatCurrency(value), name]}
                        labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name ?? 'Point'}
                      />
                      <Scatter
                        data={chartData.revenueVsExpenses.map(row => ({
                          x: row.revenue,
                          y: row.expenses,
                          name: row.category,
                        }))}
                        fill={CHART_COLORS[4]}
                      />
                    </ScatterChart>
                  )}
                </ResponsiveContainer>
              )}
            </Card>

            {/* Expense Breakdown */}
            <Card className="p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <PieIcon className="h-4 w-4 text-violet-500" />
                  Expense Breakdown
                </h4>
                <Select
                  value={financeChartModes.expenseBreakdown}
                  onValueChange={(value) =>
                    setFinanceChartMode('expenseBreakdown', value as FinanceChartVisualType)
                  }
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCE_CHART_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {FINANCE_CHART_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {chartData.expenseBreakdown.length > 0 ? (
                financeChartModes.expenseBreakdown === 'table' ? (
                  <div className="h-[250px] overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Category</th>
                          <th className="text-right p-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenseBreakdownSeries.map((row, index) => (
                          <tr key={index} className="border-t">
                            <td className="p-2">{row.category}</td>
                            <td className="p-2 text-right">{formatCurrency(row.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    {financeChartModes.expenseBreakdown === 'pie' ? (
                      <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <Pie
                          data={chartData.expenseBreakdown}
                          cx="50%"
                          cy="50%"
                          innerRadius={34}
                          outerRadius={78}
                          dataKey="value"
                          nameKey="name"
                          label={renderCompactPiePercentLabel}
                          labelLine={false}
                        >
                          {chartData.expenseBreakdown.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    ) : financeChartModes.expenseBreakdown === 'bar' ? (
                      <BarChart data={expenseBreakdownSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {expenseBreakdownSeries.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    ) : financeChartModes.expenseBreakdown === 'line' ? (
                      <LineChart data={expenseBreakdownSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Line type="monotone" dataKey="value" stroke={CHART_COLORS[4]} strokeWidth={2.5} />
                      </LineChart>
                    ) : financeChartModes.expenseBreakdown === 'area' ? (
                      <AreaChart data={expenseBreakdownSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Area type="monotone" dataKey="value" stroke={CHART_COLORS[4]} fill={CHART_COLORS[4]} fillOpacity={0.25} />
                      </AreaChart>
                    ) : (
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" name="Index" tick={{ fontSize: 11 }} />
                        <YAxis dataKey="y" name="Value" tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                          labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name ?? 'Point'}
                        />
                        <Scatter
                          data={expenseBreakdownSeries.map((row, index) => ({
                            x: index + 1,
                            y: row.value,
                            name: row.category,
                          }))}
                          fill={CHART_COLORS[3]}
                        />
                      </ScatterChart>
                    )}
                  </ResponsiveContainer>
                )
              ) : (
                <div className="h-[250px] flex items-center justify-center text-gray-400">
                  <p>No expense data available</p>
                </div>
              )}
            </Card>

            {/* Cash Flow Waterfall */}
            <Card className="p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-500" />
                  Cash Flow Components
                </h4>
                <Select
                  value={financeChartModes.cashFlowComponents}
                  onValueChange={(value) =>
                    setFinanceChartMode('cashFlowComponents', value as FinanceChartVisualType)
                  }
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCE_CHART_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {FINANCE_CHART_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {financeChartModes.cashFlowComponents === 'table' ? (
                <div className="h-[250px] overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Component</th>
                        <th className="text-right p-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.cashFlowWaterfall.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2">{row.name}</td>
                          <td className="p-2 text-right">{formatCurrency(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  {financeChartModes.cashFlowComponents === 'bar' ? (
                    <BarChart data={chartData.cashFlowWaterfall}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {chartData.cashFlowWaterfall.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  ) : financeChartModes.cashFlowComponents === 'line' ? (
                    <LineChart data={chartData.cashFlowWaterfall}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Line type="monotone" dataKey="value" stroke={CHART_COLORS[1]} strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  ) : financeChartModes.cashFlowComponents === 'area' ? (
                    <AreaChart data={chartData.cashFlowWaterfall}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Area type="monotone" dataKey="value" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.25} />
                    </AreaChart>
                  ) : financeChartModes.cashFlowComponents === 'pie' ? (
                    <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <Pie
                        data={chartData.cashFlowWaterfall.map(item => ({
                          name: item.name,
                          value: Math.abs(item.value),
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={34}
                        outerRadius={78}
                        dataKey="value"
                        nameKey="name"
                      >
                        {chartData.cashFlowWaterfall.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  ) : (
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" name="Index" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="y" name="Value" tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name ?? 'Point'}
                      />
                      <Scatter
                        data={chartData.cashFlowWaterfall.map((row, index) => ({
                          x: index + 1,
                          y: row.value,
                          name: row.name,
                        }))}
                        fill={CHART_COLORS[2]}
                      />
                    </ScatterChart>
                  )}
                </ResponsiveContainer>
              )}
            </Card>

            {/* Asset Allocation */}
            <Card className="p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-blue-500" />
                  Asset Allocation
                </h4>
                <Select
                  value={financeChartModes.assetAllocation}
                  onValueChange={(value) =>
                    setFinanceChartMode('assetAllocation', value as FinanceChartVisualType)
                  }
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCE_CHART_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {FINANCE_CHART_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {chartData.assetAllocation.length > 0 ? (
                financeChartModes.assetAllocation === 'table' ? (
                  <div className="h-[250px] overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Category</th>
                          <th className="text-right p-2">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assetAllocationSeries.map((row, index) => (
                          <tr key={index} className="border-t">
                            <td className="p-2">{row.category}</td>
                            <td className="p-2 text-right">{formatCurrency(row.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    {financeChartModes.assetAllocation === 'pie' ? (
                      <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <Pie
                          data={chartData.assetAllocation}
                          cx="50%"
                          cy="50%"
                          innerRadius={34}
                          outerRadius={78}
                          dataKey="value"
                          nameKey="name"
                          label={renderCompactPiePercentLabel}
                          labelLine={false}
                        >
                          {chartData.assetAllocation.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    ) : financeChartModes.assetAllocation === 'bar' ? (
                      <BarChart data={assetAllocationSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {assetAllocationSeries.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    ) : financeChartModes.assetAllocation === 'line' ? (
                      <LineChart data={assetAllocationSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2.5} />
                      </LineChart>
                    ) : financeChartModes.assetAllocation === 'area' ? (
                      <AreaChart data={assetAllocationSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={55} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Area type="monotone" dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.25} />
                      </AreaChart>
                    ) : (
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" name="Index" tick={{ fontSize: 11 }} />
                        <YAxis dataKey="y" name="Value" tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                          labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name ?? 'Point'}
                        />
                        <Scatter
                          data={assetAllocationSeries.map((row, index) => ({
                            x: index + 1,
                            y: row.value,
                            name: row.category,
                          }))}
                          fill={CHART_COLORS[0]}
                        />
                      </ScatterChart>
                    )}
                  </ResponsiveContainer>
                )
              ) : (
                <div className="h-[250px] flex items-center justify-center text-gray-400">
                  <p>No asset data available</p>
                </div>
              )}
            </Card>

            {/* Profitability Margins */}
            <Card className="p-4 md:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Profitability Margins
                </h4>
                <Select
                  value={financeChartModes.profitabilityMargins}
                  onValueChange={(value) =>
                    setFinanceChartMode('profitabilityMargins', value as FinanceChartVisualType)
                  }
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Visual" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCE_CHART_OPTIONS.map(option => (
                      <SelectItem key={option} value={option} className="text-xs">
                        {FINANCE_CHART_TYPE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {financeChartModes.profitabilityMargins === 'table' ? (
                <div className="h-[200px] overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Margin</th>
                        <th className="text-right p-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitabilityMarginSeries.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2">{row.category}</td>
                          <td className="p-2 text-right">{row.value.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  {financeChartModes.profitabilityMargins === 'bar' ? (
                    <BarChart data={chartData.profitabilityMargins} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {chartData.profitabilityMargins.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  ) : financeChartModes.profitabilityMargins === 'line' ? (
                    <LineChart data={profitabilityMarginSeries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                      <Line type="monotone" dataKey="value" stroke={CHART_COLORS[5]} strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  ) : financeChartModes.profitabilityMargins === 'area' ? (
                    <AreaChart data={profitabilityMarginSeries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                      <Area type="monotone" dataKey="value" stroke={CHART_COLORS[5]} fill={CHART_COLORS[5]} fillOpacity={0.25} />
                    </AreaChart>
                  ) : financeChartModes.profitabilityMargins === 'pie' ? (
                    <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <Pie
                        data={profitabilityMarginSeries.map((row) => ({ name: row.category, value: Math.abs(row.value) }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={28}
                        outerRadius={72}
                        dataKey="value"
                        nameKey="name"
                      >
                        {profitabilityMarginSeries.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                    </PieChart>
                  ) : (
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" name="Index" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="y" name="Margin" tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip
                        formatter={(value: number) => `${value.toFixed(1)}%`}
                        labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name ?? 'Point'}
                      />
                      <Scatter
                        data={profitabilityMarginSeries.map((row, index) => ({
                          x: index + 1,
                          y: row.value,
                          name: row.category,
                        }))}
                        fill={CHART_COLORS[5]}
                      />
                    </ScatterChart>
                  )}
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* ---- Written Report Tab ---- */}
        <TabsContent value="written" className="p-6">
          <Card>
            <CardHeader className="bg-gradient-to-r from-slate-100 to-white border-b">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    One-Page Written Financial Report
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    Automatically generated from your latest financial statements.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyWrittenReport}>
                    <ClipboardCopy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={regenerateWrittenReport}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate
                  </Button>
                  <Button size="sm" onClick={handleDownloadFinancePDF} disabled={isGeneratingFinancePDF}>
                    {isGeneratingFinancePDF ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Download PDF (Paid)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="rounded-lg border bg-white p-4 md:p-6">
                <p className="text-sm text-gray-700 leading-7 whitespace-pre-wrap">
                  {writtenReport || 'Written report will appear after report generation.'}
                </p>
              </div>
              <p className="text-xs text-gray-500 mt-4">
                PDF download is available for paid accounts. Free accounts can preview and copy this one-page report.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PDFPaywallDialog
        open={showPaywall}
        onOpenChange={setShowPaywall}
        onStripeCheckout={async (plan) => startProviderCheckout('stripe', plan)}
        onPaystackCheckout={async (plan) => startProviderCheckout('paystack', plan)}
        checkoutLoadingProvider={checkoutLoadingProvider}
      />
    </div>
  );
};

export default FinanceDashboard;
