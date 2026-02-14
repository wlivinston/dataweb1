// Finance Module Type Definitions
// All TypeScript interfaces for the financial statement engine

// === Account Classification ===

export type AccountCategory =
  | 'revenue'
  | 'cost_of_goods_sold'
  | 'operating_expense'
  | 'other_income'
  | 'other_expense'
  | 'tax'
  | 'current_asset'
  | 'non_current_asset'
  | 'current_liability'
  | 'non_current_liability'
  | 'equity'
  | 'operating_cash'
  | 'investing_cash'
  | 'financing_cash';

export interface ClassifiedTransaction {
  date: string;
  account: string;
  category: AccountCategory;
  amount: number;
  description?: string;
  type: 'debit' | 'credit';
  originalRow?: number;
}

// === Column Mapping ===

export interface FinanceColumnMapping {
  date?: string;
  account?: string;
  category?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string; // income/expense or debit/credit indicator
  description?: string;
}

// === Line Items for Statements ===

export interface LineItem {
  label: string;
  amount: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
  children?: LineItem[];
}

// === Profit & Loss Statement ===

export interface ProfitAndLoss {
  period: string;
  revenue: LineItem[];
  totalRevenue: number;
  costOfGoodsSold: LineItem[];
  totalCOGS: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: LineItem[];
  totalOperatingExpenses: number;
  operatingIncome: number;
  otherIncome: LineItem[];
  totalOtherIncome: number;
  otherExpenses: LineItem[];
  totalOtherExpenses: number;
  incomeBeforeTax: number;
  taxExpense: number;
  netIncome: number;
  netMargin: number;
}

// === Balance Sheet ===

export interface BalanceSheet {
  asOfDate: string;
  currentAssets: LineItem[];
  totalCurrentAssets: number;
  nonCurrentAssets: LineItem[];
  totalNonCurrentAssets: number;
  totalAssets: number;
  currentLiabilities: LineItem[];
  totalCurrentLiabilities: number;
  nonCurrentLiabilities: LineItem[];
  totalNonCurrentLiabilities: number;
  totalLiabilities: number;
  equity: LineItem[];
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

// === Cash Flow Statement ===

export interface CashFlowStatement {
  period: string;
  operatingActivities: LineItem[];
  netOperatingCashFlow: number;
  investingActivities: LineItem[];
  netInvestingCashFlow: number;
  financingActivities: LineItem[];
  netFinancingCashFlow: number;
  netCashChange: number;
  beginningCash: number;
  endingCash: number;
}

// === Financial Ratios ===

export interface FinancialRatios {
  // Profitability
  grossMargin: number | null;
  operatingMargin: number | null;
  netProfitMargin: number | null;
  returnOnAssets: number | null;
  returnOnEquity: number | null;
  // Liquidity
  currentRatio: number | null;
  quickRatio: number | null;
  // Leverage
  debtToEquity: number | null;
  debtToAssets: number | null;
  // Efficiency
  assetTurnover: number | null;
  // Cash
  operatingCashFlowRatio: number | null;
}

export interface RatioInterpretation {
  name: string;
  value: number | null;
  formatted: string;
  status: 'healthy' | 'caution' | 'warning' | 'na';
  description: string;
}

// === Full Financial Report ===

export interface FinancialReport {
  companyName: string;
  reportPeriod: string;
  generatedAt: Date;
  profitAndLoss: ProfitAndLoss;
  balanceSheet: BalanceSheet;
  cashFlow: CashFlowStatement;
  ratios: FinancialRatios;
  ratioInterpretations: RatioInterpretation[];
  transactions: ClassifiedTransaction[];
  warnings: string[];
  healthScore: number; // 0-100
  reconciliationDiagnostics?: ReconciliationDiagnostics;
}

export type NetIncomeToEquityMode = 'auto' | 'always' | 'never';
export type NetIncomeAutoMediumSignalDefault = 'add' | 'skip' | 'auto';

export interface ClosingDetectionDiagnostics {
  signalStrength: 'strong' | 'medium' | 'none';
  closingDetected: boolean;
  addedNetIncomeToEquity: boolean;
  reason: string;
  evidence: string[];
}

export interface OpeningBalanceDiagnostics {
  firstTransactionDate: string;
  openingDetected: boolean;
  missingOpeningAssets: boolean;
  hasLiabilitiesOrEquity: boolean;
  evidence: string[];
  suggestedDebitAccount?: string;
  suggestedCreditAccount?: string;
  suggestedAmount?: number;
}

export interface ReconciliationDiagnostics {
  assets: number;
  liabilities: number;
  equity: number;
  netIncome: number;
  normalBalanceRule: string;
  closing: ClosingDetectionDiagnostics;
  opening: OpeningBalanceDiagnostics;
}

// === Period filter ===

export type ReportPeriod = 'monthly' | 'quarterly' | 'annual' | 'custom';

// === Chart Data ===

export interface FinanceChartData {
  revenueVsExpenses: { category: string; revenue: number; expenses: number }[];
  expenseBreakdown: { name: string; value: number }[];
  cashFlowWaterfall: { name: string; value: number; fill: string }[];
  assetAllocation: { name: string; value: number }[];
  liabilityBreakdown: { name: string; value: number }[];
  profitabilityMargins: { name: string; value: number; color: string }[];
}

// === Manual Entry Row ===

export interface ManualEntryRow {
  id: string;
  date: string;
  account: string;
  category: AccountCategory | '';
  amount: number | '';
  description: string;
}
