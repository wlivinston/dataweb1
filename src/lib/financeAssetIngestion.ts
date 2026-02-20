import { ColumnInfo } from './types';
import {
  CanonicalTransaction,
  FinancialDatasetFormatDetection,
  detectFinancialDatasetFormat,
  validateCanonicalTransactions,
} from './financeImportPipeline';

export interface UploadedFinanceSheet {
  sheetName: string;
  data: Record<string, any>[];
  columns: ColumnInfo[];
}

export type AssetHandlingMode = 'auto' | 'asset_module' | 'journal_generation';
export type ResolvedAssetHandlingMode = 'asset_module' | 'journal_generation';
export type AssetHandlingFallbackReason = 'disabled_module' | 'missing_configuration' | 'unsupported_feature';

export interface AssetModuleConfiguration {
  enabled: boolean;
  flowsToBalanceSheet: boolean;
  supportsIngestionFeature?: boolean;
}

export interface AssetHandlingResolution {
  requestedMode: AssetHandlingMode;
  modeUsed: ResolvedAssetHandlingMode;
  usedFallback: boolean;
  message: string;
  fallbackReason?: AssetHandlingFallbackReason;
  userNotice?: string;
}

export interface AssetRegisterRow {
  assetId: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeYears: number | null;
  depreciationMethod: string;
  assetCategory: string;
  financingType?: string;
  sourceSheet: string;
  sourceRow: number;
  disposalDate?: string | null;
  disposalAmount?: number | null;
}

export interface AssetRegisterDetectionResult {
  detected: boolean;
  confidence: number;
  reasons: string[];
  sheetName: string;
  rows: AssetRegisterRow[];
  columnMap: Record<string, string>;
  missingRequiredFields: string[];
}

export interface SheetRoleDetection {
  sheetName: string;
  role: 'assets_register' | 'transaction_journal' | 'pnl_dataset' | 'unknown';
  formatDetection: FinancialDatasetFormatDetection;
  assetsDetection: AssetRegisterDetectionResult;
}

export interface FinancialSheetDetectionSummary {
  sheetDetections: SheetRoleDetection[];
  assetsRegisterSheet?: UploadedFinanceSheet;
  transactionJournalSheet?: UploadedFinanceSheet;
  pnlSheet?: UploadedFinanceSheet;
}

export interface AssetJournalGenerationOptions {
  creditAccount: 'Cash' | 'Accounts Payable' | 'Loan Payable';
  respectFinancingType?: boolean;
  sourceSheetName?: string;
}

export interface DepreciationGenerationOptions {
  reportEndDate?: string;
  startFrom: 'acquisition_month' | 'next_month';
}

export interface JournalGenerationResult {
  transactions: CanonicalTransaction[];
  warnings: string[];
  auditLog: string[];
}

export type LiabilitySignalType =
  | 'asset_purchase_on_credit'
  | 'loan_received'
  | 'expense_accrued_unpaid'
  | 'revenue_received_in_advance'
  | 'liability_sheet_detected';

export interface LiabilityDetectionSignal {
  type: LiabilitySignalType;
  sheetName: string;
  columnName?: string;
  rowIndex?: number;
  amount?: number;
  date?: string;
  description: string;
}

export interface LiabilityDetectionResult {
  detected: boolean;
  reasons: string[];
  columns: string[];
  sheets: string[];
  signals: LiabilityDetectionSignal[];
}

export interface LiabilityJournalGenerationOptions {
  includeDetectedSheetLiabilities: boolean;
  includeAssetFinancingLiabilities: boolean;
  defaultAssetFinancingLiabilityAccount: 'Accounts Payable' | 'Loan Payable';
}

export interface LiabilityJournalGenerationResult extends JournalGenerationResult {
  assumptions: string[];
  detection: LiabilityDetectionResult;
}

export interface LiabilityValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

const ASSET_FIELD_HINTS: Record<string, string[]> = {
  assetId: ['asset_id', 'asset id', 'assetid', 'id', 'asset code', 'asset_number', 'asset number'],
  acquisitionDate: ['acquisition_date', 'acquisition date', 'purchase_date', 'purchase date', 'date_acquired', 'date acquired'],
  acquisitionCost: ['acquisition_cost', 'acquisition cost', 'purchase_cost', 'purchase cost', 'cost', 'value', 'amount'],
  usefulLifeYears: ['useful_life', 'useful life', 'useful_life_years', 'useful life years', 'life_years', 'life years'],
  depreciationMethod: ['depreciation_method', 'depreciation method', 'method'],
  assetCategory: ['asset_category', 'asset category', 'category', 'class'],
  financingType: ['financing_type', 'financing type', 'funding_type', 'funding type', 'payment_type', 'payment type', 'paid_with', 'financed_by'],
  disposalDate: ['disposal_date', 'disposal date', 'date_disposed', 'date disposed'],
  disposalAmount: ['disposal_amount', 'disposal amount', 'disposal_value', 'disposal value', 'sale_value', 'sale value'],
};

const LIABILITY_COLUMN_PATTERNS = {
  payable: /payable/i,
  loanDebt: /(loan|debt|borrowing|mortgage|note payable)/i,
  accrued: /(accrued|accrual)/i,
  deferred: /(deferred|unearned|advance revenue|received in advance)/i,
};

const LIABILITY_SHEET_PATTERNS = /(liabilit|loan schedule|payables|accrued|deferred)/i;

const LIABILITY_ACCOUNT_KEYWORDS = /(payable|loan|debt|accrued|unearned|liability|deferred revenue|deferred income|deferred tax liability)/i;
const PNL_CATEGORY_KEYWORDS = /(revenue|income|expense|cogs|tax)/i;

function isLikelyLiabilityAccount(accountName: string): boolean {
  const account = String(accountName || '').toLowerCase().trim();
  if (!account) return false;

  // Avoid false positives on legitimate P&L/tax lines.
  if (
    account.includes('deferred tax expense') ||
    account.includes('deferred tax benefit') ||
    account.includes('deferred tax asset')
  ) {
    return false;
  }

  if (LIABILITY_ACCOUNT_KEYWORDS.test(account)) {
    return true;
  }

  if (account.includes('deferred')) {
    return account.includes('revenue') || account.includes('income') || account.includes('liability');
  }

  return false;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumericValue(value: any): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const parenthesized = raw.startsWith('(') && raw.endsWith(')');
  const cleaned = raw
    .replace(/[,$€£₦\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.-]/g, '');

  if (!cleaned || cleaned === '-' || cleaned === '.') return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  if (parenthesized && parsed > 0) return -parsed;
  return parsed;
}

function parseDateValue(value: any): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10);
}

function findColumn(columns: string[], field: keyof typeof ASSET_FIELD_HINTS): string | undefined {
  const normalizedMap = columns.map(column => ({
    original: column,
    normalized: normalizeHeader(column),
  }));

  const hints = ASSET_FIELD_HINTS[field];
  const normalizedHints = hints.map(normalizeHeader);

  for (const hint of normalizedHints) {
    const exact = normalizedMap.find(entry => entry.normalized === hint);
    if (exact) return exact.original;
  }

  for (const hint of normalizedHints) {
    const partial = normalizedMap.find(entry => entry.normalized.includes(hint) || hint.includes(entry.normalized));
    if (partial) return partial.original;
  }

  return undefined;
}

function endOfMonth(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const end = new Date(Date.UTC(year, month + 1, 0));
  return end.toISOString().slice(0, 10);
}

function addMonths(dateString: string, months: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function sortTransactions(rows: CanonicalTransaction[]): CanonicalTransaction[] {
  return [...rows].sort((a, b) => {
    if (a.Date !== b.Date) return compareDates(a.Date, b.Date);
    if (a.SourceSheet !== b.SourceSheet) return String(a.SourceSheet || '').localeCompare(String(b.SourceSheet || ''));
    if (a.SourceAssetID !== b.SourceAssetID) return String(a.SourceAssetID || '').localeCompare(String(b.SourceAssetID || ''));
    if (a.Account !== b.Account) return a.Account.localeCompare(b.Account);
    if (a.Type !== b.Type) return a.Type.localeCompare(b.Type);
    return a.SourceRow - b.SourceRow;
  });
}

function isAssetModuleReady(configuration: AssetModuleConfiguration): boolean {
  const supportsIngestionFeature = configuration.supportsIngestionFeature !== false;
  return configuration.enabled && configuration.flowsToBalanceSheet && supportsIngestionFeature;
}

export function resolve_asset_handling_mode(
  requestedMode: AssetHandlingMode,
  configuration: AssetModuleConfiguration
): AssetHandlingResolution {
  const moduleReady = isAssetModuleReady(configuration);
  const supportsIngestionFeature = configuration.supportsIngestionFeature !== false;

  if (requestedMode === 'asset_module') {
    if (!moduleReady) {
      throw new Error(
        'Asset Handling Mode is set to asset_module, but native asset-module ingestion is not enabled/configured to flow to Balance Sheet.'
      );
    }

    return {
      requestedMode,
      modeUsed: 'asset_module',
      usedFallback: false,
      message: 'Asset Handling Mode asset_module selected. Native asset-module ingestion will be used.',
      userNotice: 'Native asset handling is active. Assets will be posted through the configured asset module.',
    };
  }

  if (requestedMode === 'journal_generation') {
    return {
      requestedMode,
      modeUsed: 'journal_generation',
      usedFallback: false,
      message: 'Asset Handling Mode journal_generation selected. Journal entries will be generated from assets/liabilities.',
      userNotice: 'Journal generation mode is active. Assets will be converted into journal entries for reporting.',
    };
  }

  if (moduleReady) {
    return {
      requestedMode,
      modeUsed: 'asset_module',
      usedFallback: false,
      message: 'Asset Handling Mode auto selected native asset-module ingestion because it is enabled and flows to Balance Sheet.',
      userNotice: 'Auto mode selected native asset handling. Assets will flow directly to the Balance Sheet.',
    };
  }

  let fallbackReason: AssetHandlingFallbackReason = 'missing_configuration';
  if (!configuration.enabled) {
    fallbackReason = 'disabled_module';
  } else if (!supportsIngestionFeature) {
    fallbackReason = 'unsupported_feature';
  }

  const fallbackNoticeByReason: Record<AssetHandlingFallbackReason, string> = {
    disabled_module:
      'Auto mode switched to journal generation because the asset module is disabled. Your assets were still converted correctly into journal entries.',
    missing_configuration:
      'Auto mode switched to journal generation because asset-module setup is incomplete. Your assets were still converted correctly into journal entries.',
    unsupported_feature:
      'Auto mode switched to journal generation because this asset-module feature is not supported yet. Your assets were still converted correctly into journal entries.',
  };

  return {
    requestedMode,
    modeUsed: 'journal_generation',
    usedFallback: true,
    message: `Asset Handling Mode auto fell back to journal_generation (${fallbackReason}).`,
    fallbackReason,
    userNotice: fallbackNoticeByReason[fallbackReason],
  };
}

function inferAssetFinancingAccount(
  asset: AssetRegisterRow,
  options: AssetJournalGenerationOptions
): 'Cash' | 'Accounts Payable' | 'Loan Payable' {
  const respectFinancingType = options.respectFinancingType !== false;
  if (!respectFinancingType) {
    return options.creditAccount;
  }

  const financing = String(asset.financingType || '').toLowerCase().trim();
  if (!financing) {
    return options.creditAccount;
  }

  if (financing.includes('cash')) {
    return 'Cash';
  }

  if (
    financing.includes('payable') ||
    financing.includes('vendor') ||
    financing.includes('supplier') ||
    financing.includes('credit')
  ) {
    return 'Accounts Payable';
  }

  if (
    financing.includes('loan') ||
    financing.includes('debt') ||
    financing.includes('mortgage') ||
    financing.includes('financ')
  ) {
    return 'Loan Payable';
  }

  return options.creditAccount;
}

function pickDateColumn(sheet: UploadedFinanceSheet): string | null {
  if (sheet.columns.length === 0 || sheet.data.length === 0) return null;

  const namedDateColumn = sheet.columns.find(column => normalizeHeader(column.name).includes('date'));
  if (namedDateColumn) return namedDateColumn.name;

  for (const column of sheet.columns) {
    const values = sheet.data
      .slice(0, 80)
      .map(row => row[column.name])
      .filter(value => value != null && value !== '');
    if (values.length === 0) continue;

    const parseable = values.filter(value => parseDateValue(value) != null).length;
    if (parseable / values.length >= 0.6) {
      return column.name;
    }
  }

  return null;
}

function detectLiabilitySignalType(columnName: string): LiabilitySignalType | null {
  if (LIABILITY_COLUMN_PATTERNS.loanDebt.test(columnName)) return 'loan_received';
  if (LIABILITY_COLUMN_PATTERNS.accrued.test(columnName)) return 'expense_accrued_unpaid';
  if (LIABILITY_COLUMN_PATTERNS.deferred.test(columnName)) return 'revenue_received_in_advance';
  if (LIABILITY_COLUMN_PATTERNS.payable.test(columnName)) return 'expense_accrued_unpaid';
  return null;
}

export function detect_format(columns: ColumnInfo[], data: Record<string, any>[]): FinancialDatasetFormatDetection {
  return detectFinancialDatasetFormat(columns, data);
}

export function detect_assets_register(
  sheetName: string,
  data: Record<string, any>[],
  columns?: ColumnInfo[]
): AssetRegisterDetectionResult {
  const columnNames = (columns && columns.length > 0)
    ? columns.map(column => column.name)
    : (data[0] ? Object.keys(data[0]) : []);

  const columnMap: Record<string, string> = {};
  const requiredFields: Array<keyof typeof ASSET_FIELD_HINTS> = ['assetId', 'acquisitionDate', 'acquisitionCost'];

  for (const field of Object.keys(ASSET_FIELD_HINTS) as Array<keyof typeof ASSET_FIELD_HINTS>) {
    const mapped = findColumn(columnNames, field);
    if (mapped) {
      columnMap[field] = mapped;
    }
  }

  const missingRequiredFields = requiredFields.filter(field => !columnMap[field]);
  const reasons: string[] = [];

  if (columnMap.assetId) reasons.push(`Detected asset identifier column: ${columnMap.assetId}`);
  if (columnMap.acquisitionDate) reasons.push(`Detected acquisition date column: ${columnMap.acquisitionDate}`);
  if (columnMap.acquisitionCost) reasons.push(`Detected acquisition cost column: ${columnMap.acquisitionCost}`);
  if (columnMap.usefulLifeYears) reasons.push(`Detected useful life column: ${columnMap.usefulLifeYears}`);
  if (columnMap.depreciationMethod) reasons.push(`Detected depreciation method column: ${columnMap.depreciationMethod}`);
  if (columnMap.financingType) reasons.push(`Detected financing type column: ${columnMap.financingType}`);

  const rows: AssetRegisterRow[] = [];

  for (let index = 0; index < data.length; index++) {
    const row = data[index];

    const assetId = columnMap.assetId ? String(row[columnMap.assetId] ?? '').trim() : '';
    const acquisitionDate = columnMap.acquisitionDate ? parseDateValue(row[columnMap.acquisitionDate]) : null;
    const acquisitionCostRaw = columnMap.acquisitionCost ? parseNumericValue(row[columnMap.acquisitionCost]) : null;

    if (!assetId && acquisitionDate == null && acquisitionCostRaw == null) {
      continue;
    }

    const usefulLifeRaw = columnMap.usefulLifeYears ? parseNumericValue(row[columnMap.usefulLifeYears]) : null;
    const usefulLifeYears = usefulLifeRaw != null && usefulLifeRaw > 0 ? usefulLifeRaw : null;

    const depreciationMethod =
      (columnMap.depreciationMethod ? String(row[columnMap.depreciationMethod] ?? '').trim() : '') ||
      'Straight-Line';

    const assetCategory =
      (columnMap.assetCategory ? String(row[columnMap.assetCategory] ?? '').trim() : '') ||
      'Fixed Asset';

    const financingType =
      (columnMap.financingType ? String(row[columnMap.financingType] ?? '').trim() : '') ||
      'Cash';

    const disposalDate = columnMap.disposalDate ? parseDateValue(row[columnMap.disposalDate]) : null;
    const disposalAmount = columnMap.disposalAmount ? parseNumericValue(row[columnMap.disposalAmount]) : null;

    rows.push({
      assetId: assetId || `ASSET-${index + 1}`,
      acquisitionDate: acquisitionDate || '',
      acquisitionCost: acquisitionCostRaw ?? 0,
      usefulLifeYears,
      depreciationMethod,
      assetCategory,
      financingType,
      sourceSheet: sheetName,
      sourceRow: index,
      disposalDate,
      disposalAmount,
    });
  }

  const requiredFieldHits = requiredFields.length - missingRequiredFields.length;
  const confidence = Math.max(0, Math.min(1, (requiredFieldHits + (rows.length > 0 ? 1 : 0)) / (requiredFields.length + 1)));
  const detected = missingRequiredFields.length === 0 && rows.length > 0;

  if (!detected) {
    reasons.push('Required asset register fields are missing or no asset rows were found.');
  }

  return {
    detected,
    confidence,
    reasons,
    sheetName,
    rows,
    columnMap,
    missingRequiredFields: missingRequiredFields.map(field => String(field)),
  };
}

function detectTransactionJournalColumns(columns: ColumnInfo[]): boolean {
  const names = columns.map(column => normalizeHeader(column.name));
  const hasDate = names.some(name => name.includes('date'));
  const hasAccount = names.some(name => name.includes('account') || name.includes('ledger'));
  const hasDebitOrCredit = names.some(name => name.includes('debit') || name.includes('credit'));
  const hasAmount = names.some(name => name.includes('amount'));

  return hasDate && hasAccount && (hasDebitOrCredit || hasAmount);
}

export function detect_financial_sheets(sheets: UploadedFinanceSheet[]): FinancialSheetDetectionSummary {
  const sheetDetections: SheetRoleDetection[] = sheets.map(sheet => {
    const formatDetection = detect_format(sheet.columns, sheet.data);
    const assetsDetection = detect_assets_register(sheet.sheetName, sheet.data, sheet.columns);
    const hasTransactionJournal = detectTransactionJournalColumns(sheet.columns);

    let role: SheetRoleDetection['role'] = 'unknown';

    if (assetsDetection.detected) {
      role = 'assets_register';
    } else if (hasTransactionJournal) {
      role = 'transaction_journal';
    } else if (formatDetection.format !== 'unknown') {
      role = 'pnl_dataset';
    }

    return {
      sheetName: sheet.sheetName,
      role,
      formatDetection,
      assetsDetection,
    };
  });

  const assetsSheetRole = sheetDetections.find(sheet => sheet.role === 'assets_register');
  const journalSheetRole = sheetDetections.find(sheet => sheet.role === 'transaction_journal');
  const pnlSheetRole = sheetDetections.find(sheet => sheet.role === 'pnl_dataset');

  const assetsRegisterSheet = assetsSheetRole
    ? sheets.find(sheet => sheet.sheetName === assetsSheetRole.sheetName)
    : undefined;

  const transactionJournalSheet = journalSheetRole
    ? sheets.find(sheet => sheet.sheetName === journalSheetRole.sheetName)
    : undefined;

  const pnlSheet = pnlSheetRole
    ? sheets.find(sheet => sheet.sheetName === pnlSheetRole.sheetName)
    : undefined;

  return {
    sheetDetections,
    assetsRegisterSheet,
    transactionJournalSheet,
    pnlSheet,
  };
}

export function detect_liability_indicators(
  sheets: UploadedFinanceSheet[],
  assets: AssetRegisterRow[] = []
): LiabilityDetectionResult {
  const reasons: string[] = [];
  const columns = new Set<string>();
  const sheetNames = new Set<string>();
  const signals: LiabilityDetectionSignal[] = [];

  const financedAssets = assets.filter(asset => {
    const financing = String(asset.financingType || '').toLowerCase().trim();
    return financing !== '' && !financing.includes('cash');
  });

  for (const asset of financedAssets) {
    sheetNames.add(asset.sourceSheet || 'Assets_Register');
    signals.push({
      type: 'asset_purchase_on_credit',
      sheetName: asset.sourceSheet || 'Assets_Register',
      rowIndex: asset.sourceRow,
      amount: asset.acquisitionCost,
      date: parseDateValue(asset.acquisitionDate) || asset.acquisitionDate,
      description: `Asset ${asset.assetId} financing detected (${asset.financingType}).`,
    });
  }

  if (financedAssets.length > 0) {
    reasons.push(`Detected ${financedAssets.length} financed asset purchases (financing type != Cash).`);
  }

  for (const sheet of sheets) {
    let sheetHasLiabilitySignals = false;

    if (LIABILITY_SHEET_PATTERNS.test(sheet.sheetName)) {
      sheetHasLiabilitySignals = true;
      sheetNames.add(sheet.sheetName);
      signals.push({
        type: 'liability_sheet_detected',
        sheetName: sheet.sheetName,
        description: `Sheet name "${sheet.sheetName}" suggests liability or loan data.`,
      });
    }

    const dateColumn = pickDateColumn(sheet);

    for (const column of sheet.columns) {
      const signalType = detectLiabilitySignalType(column.name);
      if (!signalType) continue;

      columns.add(column.name);
      sheetHasLiabilitySignals = true;
      sheetNames.add(sheet.sheetName);

      const sampledRows = sheet.data.slice(0, 250);
      for (let rowIndex = 0; rowIndex < sampledRows.length; rowIndex++) {
        const row = sampledRows[rowIndex];
        const amount = parseNumericValue(row[column.name]);
        if (amount == null || amount === 0) continue;

        signals.push({
          type: signalType,
          sheetName: sheet.sheetName,
          columnName: column.name,
          rowIndex,
          amount,
          date: dateColumn ? parseDateValue(row[dateColumn]) || undefined : undefined,
          description: `Detected ${signalType.replace(/_/g, ' ')} signal in ${sheet.sheetName}.${column.name}.`,
        });
      }
    }

    if (sheetHasLiabilitySignals) {
      reasons.push(`Liability indicators detected in sheet "${sheet.sheetName}".`);
    }
  }

  if (columns.size > 0) {
    reasons.push(`Liability-related columns detected: ${[...columns].join(', ')}.`);
  }

  if (reasons.length === 0) {
    reasons.push('No explicit liability indicators detected.');
  }

  return {
    detected: signals.length > 0 || columns.size > 0 || sheetNames.size > 0,
    reasons: [...new Set(reasons)],
    columns: [...columns],
    sheets: [...sheetNames],
    signals,
  };
}

function createJournalRow(
  row: Partial<CanonicalTransaction> &
  Pick<CanonicalTransaction, 'Date' | 'Account' | 'Category' | 'Type' | 'Debit' | 'Credit' | 'Description' | 'SourceColumn' | 'SourceRow'>
): CanonicalTransaction {
  return {
    Date: row.Date,
    Account: row.Account,
    Category: row.Category,
    Type: row.Type,
    Debit: row.Debit,
    Credit: row.Credit,
    Description: row.Description,
    SourceColumn: row.SourceColumn,
    SourceRow: row.SourceRow,
    SourceSheet: row.SourceSheet,
    SourceAssetID: row.SourceAssetID,
  };
}

export function generate_liability_journal(
  sheets: UploadedFinanceSheet[],
  assets: AssetRegisterRow[],
  options: LiabilityJournalGenerationOptions
): LiabilityJournalGenerationResult {
  const detection = detect_liability_indicators(sheets, assets);
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const auditLog: string[] = [];
  const transactions: CanonicalTransaction[] = [];

  auditLog.push('Liability module: evaluating liability indicators.');
  auditLog.push(`Liability module: detected ${detection.signals.length} liability signals.`);

  if (options.includeAssetFinancingLiabilities) {
    for (const asset of assets) {
      const financingType = String(asset.financingType || '').toLowerCase().trim();
      if (!financingType || financingType.includes('cash')) continue;

      const acquisitionDate = parseDateValue(asset.acquisitionDate);
      if (!acquisitionDate) {
        warnings.push(`Asset ${asset.assetId}: liability generation skipped because acquisition date is invalid.`);
        continue;
      }

      const amount = Number(asset.acquisitionCost || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        warnings.push(`Asset ${asset.assetId}: liability generation skipped because acquisition cost is invalid.`);
        continue;
      }

      let liabilityAccount: 'Accounts Payable' | 'Loan Payable' = options.defaultAssetFinancingLiabilityAccount;
      if (financingType.includes('loan') || financingType.includes('debt') || financingType.includes('mortgage')) {
        liabilityAccount = 'Loan Payable';
      } else if (
        financingType.includes('payable') ||
        financingType.includes('vendor') ||
        financingType.includes('supplier') ||
        financingType.includes('credit')
      ) {
        liabilityAccount = 'Accounts Payable';
      }

      if (
        !financingType.includes('loan') &&
        !financingType.includes('debt') &&
        !financingType.includes('mortgage') &&
        !financingType.includes('payable') &&
        !financingType.includes('vendor') &&
        !financingType.includes('supplier') &&
        !financingType.includes('credit')
      ) {
        assumptions.push(
          `Asset ${asset.assetId}: financing type "${asset.financingType}" was mapped to ${liabilityAccount}.`
        );
      }

      transactions.push(
        createJournalRow({
          Date: acquisitionDate,
          Account: `Fixed Assets - ${asset.assetCategory || 'General'}`,
          Category: 'non_current_asset',
          Type: 'Expense',
          Debit: amount,
          Credit: 0,
          Description: `Asset purchased on credit for ${asset.assetId}`,
          SourceColumn: 'Acquisition_Cost',
          SourceRow: asset.sourceRow,
          SourceSheet: asset.sourceSheet || 'Assets_Register',
          SourceAssetID: asset.assetId,
        })
      );

      transactions.push(
        createJournalRow({
          Date: acquisitionDate,
          Account: liabilityAccount,
          Category: liabilityAccount === 'Loan Payable' ? 'non_current_liability' : 'current_liability',
          Type: 'Income',
          Debit: 0,
          Credit: amount,
          Description: `Liability created for financed asset ${asset.assetId}`,
          SourceColumn: 'Financing_Type',
          SourceRow: asset.sourceRow,
          SourceSheet: asset.sourceSheet || 'Assets_Register',
          SourceAssetID: asset.assetId,
        })
      );
    }
  }

  if (options.includeDetectedSheetLiabilities) {
    for (const sheet of sheets) {
      const dateColumn = pickDateColumn(sheet);

      for (let rowIndex = 0; rowIndex < sheet.data.length; rowIndex++) {
        const row = sheet.data[rowIndex];
        const rowDate = dateColumn ? parseDateValue(row[dateColumn]) : null;

        for (const column of sheet.columns) {
          const signalType = detectLiabilitySignalType(column.name);
          if (!signalType) continue;

          const amountRaw = parseNumericValue(row[column.name]);
          if (amountRaw == null || amountRaw === 0) continue;

          const amount = Math.abs(amountRaw);
          const bookingDate = rowDate || new Date().toISOString().slice(0, 10);
          if (!rowDate) {
            assumptions.push(
              `${sheet.sheetName}.${column.name} row ${rowIndex + 1}: date was not parseable, defaulted to ${bookingDate}.`
            );
          }

          if (signalType === 'loan_received') {
            const loanAccount = normalizeHeader(column.name).includes('short') ? 'Short-term Loan Payable' : 'Loan Payable';
            const loanCategory = loanAccount === 'Loan Payable' ? 'non_current_liability' : 'current_liability';

            if (amountRaw > 0) {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Cash',
                  Category: 'current_asset',
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Loan proceeds from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: loanAccount,
                  Category: loanCategory,
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Loan liability recorded from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            } else {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: loanAccount,
                  Category: loanCategory,
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Loan repayment from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Cash',
                  Category: 'current_asset',
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Cash reduction for loan repayment from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            }
            continue;
          }

          if (signalType === 'expense_accrued_unpaid') {
            const expenseAccount = `Accrued Expense - ${column.name}`;
            const liabilityAccount = normalizeHeader(column.name).includes('payable')
              ? 'Accounts Payable'
              : 'Accrued Liabilities';

            if (amountRaw > 0) {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: expenseAccount,
                  Category: 'operating_expense',
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Expense accrued but unpaid from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: liabilityAccount,
                  Category: 'current_liability',
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Accrued liability recorded from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            } else {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: liabilityAccount,
                  Category: 'current_liability',
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Accrued liability settled from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Cash',
                  Category: 'current_asset',
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Cash paid to settle ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            }
            continue;
          }

          if (signalType === 'revenue_received_in_advance') {
            if (amountRaw > 0) {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Cash',
                  Category: 'current_asset',
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Cash received in advance from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Deferred Revenue',
                  Category: 'current_liability',
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Deferred revenue recorded from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            } else {
              transactions.push(
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Deferred Revenue',
                  Category: 'current_liability',
                  Type: 'Expense',
                  Debit: amount,
                  Credit: 0,
                  Description: `Deferred revenue recognized from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                }),
                createJournalRow({
                  Date: bookingDate,
                  Account: 'Revenue Recognition',
                  Category: 'revenue',
                  Type: 'Income',
                  Debit: 0,
                  Credit: amount,
                  Description: `Revenue recognized from ${column.name}`,
                  SourceColumn: column.name,
                  SourceRow: rowIndex,
                  SourceSheet: sheet.sheetName,
                })
              );
            }
            continue;
          }
        }
      }
    }
  }

  if (assumptions.length > 0) {
    auditLog.push(`Liability module: applied ${assumptions.length} assumptions.`);
  }

  const merged = merge_with_existing_journal([], transactions);
  auditLog.push(`Liability module: generated ${merged.length} liability journal rows.`);

  return {
    transactions: merged,
    warnings: [...new Set(warnings)],
    assumptions: [...new Set(assumptions)],
    auditLog,
    detection,
  };
}

export function validate_liability_journal(journal: CanonicalTransaction[]): LiabilityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < journal.length; index++) {
    const row = journal[index];
    const rowLabel = `Row ${index + 1}`;
    const account = String(row.Account || '');
    const category = String(row.Category || '');
    const categoryNormalized = normalizeHeader(category);
    const isLiabilityAccount = isLikelyLiabilityAccount(account);
    const isLiabilityCategory = categoryNormalized.includes('liability');
    const isPnlCategory = PNL_CATEGORY_KEYWORDS.test(categoryNormalized);

    if (isLiabilityAccount && isPnlCategory) {
      errors.push(
        `${rowLabel}: Liability account "${row.Account}" is mapped to P&L category "${row.Category}". Liabilities must be on Balance Sheet categories only.`
      );
    }

    if (isLiabilityCategory && categoryNormalized.includes('revenue')) {
      warnings.push(`${rowLabel}: Liability row mapped to revenue-like category "${row.Category}". Review mapping.`);
    }

    if ((isLiabilityAccount || isLiabilityCategory) && row.Debit > 0 && row.Credit > 0) {
      errors.push(`${rowLabel}: Liability row has both Debit and Credit populated.`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export function generate_asset_acquisition_journal(
  assets: AssetRegisterRow[],
  options: AssetJournalGenerationOptions
): JournalGenerationResult {
  const warnings: string[] = [];
  const auditLog: string[] = [];
  const transactions: CanonicalTransaction[] = [];

  auditLog.push(`Asset module: generating acquisition entries for ${assets.length} assets.`);

  for (const asset of assets) {
    const acquisitionDate = parseDateValue(asset.acquisitionDate);
    if (!acquisitionDate) {
      warnings.push(`Asset ${asset.assetId}: acquisition date is not parseable and was skipped.`);
      continue;
    }

    const acquisitionCost = Number(asset.acquisitionCost || 0);
    if (!Number.isFinite(acquisitionCost) || acquisitionCost <= 0) {
      warnings.push(`Asset ${asset.assetId}: acquisition cost must be positive and was skipped.`);
      continue;
    }

    const assetAccount = `Fixed Assets - ${asset.assetCategory || 'General'}`;
    const sourceSheet = asset.sourceSheet || options.sourceSheetName || 'Assets_Register';

    transactions.push({
      Date: acquisitionDate,
      Account: assetAccount,
      Category: 'non_current_asset',
      Type: 'Expense',
      Debit: acquisitionCost,
      Credit: 0,
      Description: `Asset acquisition for ${asset.assetId}`,
      SourceColumn: 'Acquisition_Cost',
      SourceRow: asset.sourceRow,
      SourceSheet: sourceSheet,
      SourceAssetID: asset.assetId,
    });

    const creditAccount = inferAssetFinancingAccount(asset, options);
    const creditCategory =
      creditAccount === 'Cash'
        ? 'current_asset'
        : creditAccount === 'Loan Payable'
          ? 'non_current_liability'
          : 'current_liability';

    if (creditAccount !== 'Cash' && (!asset.financingType || asset.financingType.trim() === '')) {
      warnings.push(
        `Asset ${asset.assetId}: financing type missing; defaulted funding credit to ${creditAccount}.`
      );
    }

    transactions.push({
      Date: acquisitionDate,
      Account: creditAccount,
      Category: creditCategory,
      Type: 'Income',
      Debit: 0,
      Credit: acquisitionCost,
      Description: `Funding entry for asset ${asset.assetId}${creditAccount !== 'Cash' ? ' (financed)' : ''}`,
      SourceColumn: 'Acquisition_Cost',
      SourceRow: asset.sourceRow,
      SourceSheet: sourceSheet,
      SourceAssetID: asset.assetId,
    });
  }

  auditLog.push(`Asset module: generated ${transactions.length} acquisition journal entries.`);

  return {
    transactions: sortTransactions(transactions),
    warnings,
    auditLog,
  };
}

export function generate_depreciation_schedule(
  assets: AssetRegisterRow[],
  options: DepreciationGenerationOptions
): JournalGenerationResult {
  const warnings: string[] = [];
  const auditLog: string[] = [];
  const transactions: CanonicalTransaction[] = [];

  const reportEndDate = parseDateValue(options.reportEndDate || '') || new Date().toISOString().slice(0, 10);

  for (const asset of assets) {
    const acquisitionDate = parseDateValue(asset.acquisitionDate);
    if (!acquisitionDate) {
      warnings.push(`Asset ${asset.assetId}: no valid acquisition date for depreciation schedule.`);
      continue;
    }

    const usefulLifeYears = Number(asset.usefulLifeYears || 0);
    if (!Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) {
      warnings.push(`Asset ${asset.assetId}: useful life is missing for depreciation schedule.`);
      continue;
    }

    const acquisitionCost = Number(asset.acquisitionCost || 0);
    if (!Number.isFinite(acquisitionCost) || acquisitionCost <= 0) {
      warnings.push(`Asset ${asset.assetId}: acquisition cost missing for depreciation schedule.`);
      continue;
    }

    const method = String(asset.depreciationMethod || 'Straight-Line').toLowerCase();
    if (!method.includes('straight')) {
      warnings.push(`Asset ${asset.assetId}: only Straight-Line depreciation is supported; defaulting to Straight-Line.`);
    }

    const sourceSheet = asset.sourceSheet || 'Assets_Register';
    const monthlyAmount = acquisitionCost / usefulLifeYears / 12;

    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      warnings.push(`Asset ${asset.assetId}: computed monthly depreciation is invalid.`);
      continue;
    }

    const totalMonths = Math.max(1, Math.round(usefulLifeYears * 12));
    const startDate = options.startFrom === 'next_month'
      ? addMonths(endOfMonth(acquisitionDate), 1)
      : endOfMonth(acquisitionDate);

    for (let monthIndex = 0; monthIndex < totalMonths; monthIndex++) {
      const monthDate = endOfMonth(addMonths(startDate, monthIndex));
      if (compareDates(monthDate, reportEndDate) > 0) break;

      const amount = Math.round(monthlyAmount * 100) / 100;

      transactions.push({
        Date: monthDate,
        Account: 'Depreciation Expense',
        Category: 'operating_expense',
        Type: 'Expense',
        Debit: amount,
        Credit: 0,
        Description: `Monthly depreciation for ${asset.assetId}`,
        SourceColumn: 'Acquisition_Cost',
        SourceRow: asset.sourceRow,
        SourceSheet: sourceSheet,
        SourceAssetID: asset.assetId,
      });

      transactions.push({
        Date: monthDate,
        Account: 'Accumulated Depreciation',
        Category: 'non_current_asset',
        Type: 'Income',
        Debit: 0,
        Credit: amount,
        Description: `Monthly accumulated depreciation for ${asset.assetId}`,
        SourceColumn: 'Acquisition_Cost',
        SourceRow: asset.sourceRow,
        SourceSheet: sourceSheet,
        SourceAssetID: asset.assetId,
      });
    }
  }

  auditLog.push(`Asset module: generated ${transactions.length} depreciation entries through ${reportEndDate}.`);

  return {
    transactions: sortTransactions(transactions),
    warnings,
    auditLog,
  };
}

export function validate_journal(journal: CanonicalTransaction[]) {
  return validateCanonicalTransactions(journal);
}

export function merge_with_existing_journal(
  existingJournal: CanonicalTransaction[],
  generatedJournal: CanonicalTransaction[]
): CanonicalTransaction[] {
  const merged = [...existingJournal, ...generatedJournal];
  const seen = new Set<string>();
  const deduped: CanonicalTransaction[] = [];

  for (const row of merged) {
    const key = [
      row.Date,
      row.Account,
      row.Category,
      row.Type,
      row.Debit,
      row.Credit,
      row.Description,
      row.SourceSheet || '',
      row.SourceAssetID || '',
      row.SourceRow,
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return sortTransactions(deduped);
}

export function compute_asset_reconciliation(journal: CanonicalTransaction[]): {
  fixedAssetDebits: number;
  assetDisposals: number;
  netFixedAssetMovement: number;
} {
  const fixedAssetDebits = journal
    .filter(row => row.Category === 'non_current_asset' && row.Debit > 0)
    .reduce((sum, row) => sum + row.Debit, 0);

  const assetDisposals = journal
    .filter(row => row.Category === 'non_current_asset' && row.Credit > 0)
    .reduce((sum, row) => sum + row.Credit, 0);

  return {
    fixedAssetDebits: Math.round(fixedAssetDebits * 100) / 100,
    assetDisposals: Math.round(assetDisposals * 100) / 100,
    netFixedAssetMovement: Math.round((fixedAssetDebits - assetDisposals) * 100) / 100,
  };
}
