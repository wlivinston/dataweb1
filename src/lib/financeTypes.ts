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
  reference?: string;
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
  reference?: string;
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

// ============================================================
// === Trial Balance ===
// ============================================================

export interface TrialBalanceRow {
  account: string;
  category: AccountCategory;
  /** Raw sum of all debit-side entries for this account */
  totalDebits: number;
  /** Raw sum of all credit-side entries for this account */
  totalCredits: number;
  /** Net debit balance (positive when debits exceed credits, else 0) */
  debitBalance: number;
  /** Net credit balance (positive when credits exceed debits, else 0) */
  creditBalance: number;
}

export interface TrialBalance {
  asOfDate: string;
  rows: TrialBalanceRow[];
  /** Sum of all debitBalance values across accounts */
  totalDebits: number;
  /** Sum of all creditBalance values across accounts */
  totalCredits: number;
  isBalanced: boolean;
  /** Math.abs(totalDebits - totalCredits) */
  difference: number;
  /** Same account name posted to multiple categories in source transactions */
  categoryConflicts: Array<{
    account: string;
    categories: AccountCategory[];
  }>;
}

// ============================================================
// === Bank Reconciliation ===
// ============================================================

export type BankReconItemType =
  | 'matched'          // present in both bank statement and books
  | 'bank_only'        // in bank statement only (e.g. bank charges, bank interest)
  | 'book_only'        // in books only (e.g. outstanding cheques, deposits in transit)
  | 'amount_mismatch'; // same transaction, different amounts

export interface BankStatementRow {
  id: string;
  date: string;
  description: string;
  reference?: string;
  /** Amount flowing out of the account (e.g. payments, withdrawals) */
  debit: number;
  /** Amount flowing into the account (e.g. deposits, receipts) */
  credit: number;
  /** Running balance from the bank statement, if available */
  balance?: number;
  isOpeningBalance?: boolean;
  rawRow?: number;
}

export interface ReconciliationMatch {
  bankRow?: BankStatementRow;
  bookTransaction?: ClassifiedTransaction;
  type: BankReconItemType;
  /** Absolute transaction amount */
  amount: number;
  /** Amount difference between bank and book sides (0 when matched) */
  variance: number;
}

export interface BankReconciliation {
  statementDate: string;
  bankClosingBalance: number;
  bookClosingBalance: number;
  /** Which book account scope was used ('auto' or a concrete account name) */
  bookAccountScope: 'auto' | string;
  /** Book cash/bank accounts used in reconciliation */
  bookAccountsUsed: string[];
  /** Book cash debits not yet cleared by bank (deposits in transit) */
  depositsInTransit: ReconciliationMatch[];
  /** Book cash credits not yet cleared by bank (outstanding checks/payments) */
  outstandingCheques: ReconciliationMatch[];
  /** Bank debits not recorded in books (e.g. bank fees, charges) */
  bankChargesUnrecorded: ReconciliationMatch[];
  /** Bank credits not recorded in books (e.g. interest earned) */
  bankCreditsUnrecorded: ReconciliationMatch[];
  /** Transactions matched by amount but with a small date/value discrepancy */
  amountMismatches: ReconciliationMatch[];
  /** Fully matched transactions */
  matchedItems: ReconciliationMatch[];
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  isReconciled: boolean;
  /** Math.abs(adjustedBankBalance - adjustedBookBalance) */
  difference: number;
  totalTransactionsMatched: number;
  totalTransactionsUnmatched: number;
  quality: {
    bankRowsTotal: number;
    bankRowsMatchingPool: number;
    bookRowsTotal: number;
    bookRowsMatchingPool: number;
    bankReferenceCoveragePct: number;
    bookReferenceCoveragePct: number;
    bankOpeningExcluded: number;
    bookOpeningExcluded: number;
    bankOutOfWindowExcluded: number;
    bookOutOfWindowExcluded: number;
    matchedByReference: number;
    matchedByAmountDateFallback: number;
    nearMatchesFlagged: number;
    reliabilityScore: number;
    verdict: 'high' | 'medium' | 'low';
  };
  /** Caveats and assumptions made during reconciliation */
  notes: string[];
}

export interface BankStatementColumnMapping {
  date?: string;
  description?: string;
  reference?: string;
  /** Column holding withdrawal / debit amounts */
  debit?: string;
  /** Column holding deposit / credit amounts */
  credit?: string;
  /** Single net-amount column (negative = debit, positive = credit) */
  amount?: string;
  /** Optional transaction direction indicator (e.g. Debit/Credit, Dr/Cr, Out/In) */
  type?: string;
  balance?: string;
}

export type BankStatementDateFormat = 'auto' | 'mdy' | 'dmy' | 'ymd';

export interface ParsedBankStatementResult {
  rows: BankStatementRow[];
  droppedRowCount: number;
  unparseableDateRows: number;
  zeroAmountRows: number;
  warnings: string[];
}

export interface BankReconciliationOptions {
  statementDate?: string;
  statementStartDate?: string;
  statementEndDate?: string;
  bookAccountScope?: 'auto' | string;
}
