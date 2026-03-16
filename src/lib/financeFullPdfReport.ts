import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  FinancialReport,
  LineItem,
  TrialBalance,
  BankReconciliation,
  AccountCategory,
} from './financeTypes';
import { formatCurrency, formatPercent, triggerPdfDownload } from './financePdfReport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FullReportPDFOptions {
  report: FinancialReport;
  writtenReport: string;
  trialBalance: TrialBalance | null;
  bankReconciliation: BankReconciliation | null;
  chartImages?: Record<string, string>;
  filenamePrefix?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARGIN = 40;
const HEADER_FILL: [number, number, number] = [16, 185, 129]; // emerald
const DATA_HEADER_FILL: [number, number, number] = [15, 23, 42]; // slate-900
const SECTION_HEADER_SIZE = 16;
const LINE_HEIGHT = 12;

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  revenue: 'Revenue',
  cost_of_goods_sold: 'Cost of Goods Sold',
  operating_expense: 'Operating Expenses',
  other_income: 'Other Income',
  other_expense: 'Other Expenses',
  tax: 'Tax',
  current_asset: 'Current Assets',
  non_current_asset: 'Non-Current Assets',
  current_liability: 'Current Liabilities',
  non_current_liability: 'Non-Current Liabilities',
  equity: 'Equity',
  operating_cash: 'Operating Cash',
  investing_cash: 'Investing Cash',
  financing_cash: 'Financing Cash',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getAutoTableFinalY(doc: jsPDF, fallback: number): number {
  return ((doc as any).lastAutoTable?.finalY as number) || fallback;
}

function addSectionHeader(doc: jsPDF, title: string, subtitle?: string): number {
  doc.addPage();
  let y = MARGIN + 8;

  // Accent bar
  doc.setFillColor(HEADER_FILL[0], HEADER_FILL[1], HEADER_FILL[2]);
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.rect(MARGIN, y - 4, pageWidth - MARGIN * 2, 3, 'F');
  y += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_HEADER_SIZE);
  doc.setTextColor(20, 20, 20);
  doc.text(title, MARGIN, y);
  y += 6;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(subtitle, MARGIN, y + 8);
    y += 14;
  }

  y += 10;
  return y;
}

/** Flatten LineItem[] into autoTable body rows. */
function lineItemRows(
  items: LineItem[],
  indent = 0,
): (string | { content: string; styles?: Record<string, unknown> })[][] {
  const rows: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
  for (const item of items) {
    const prefix = '  '.repeat(indent + (item.indent ?? 0));
    const isBold = item.isSubtotal || item.isTotal;
    const label = isBold
      ? { content: `${prefix}${item.label}`, styles: { fontStyle: 'bold' as const } }
      : `${prefix}${item.label}`;
    const amount = isBold
      ? { content: formatCurrency(item.amount), styles: { fontStyle: 'bold' as const } }
      : formatCurrency(item.amount);
    rows.push([label, amount]);
    if (item.children) {
      rows.push(...lineItemRows(item.children, indent + 1));
    }
  }
  return rows;
}

function addStatementTable(
  doc: jsPDF,
  startY: number,
  head: string[][],
  body: any[][],
  headerFill = HEADER_FILL,
): number {
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head,
    body,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: headerFill, textColor: [255, 255, 255], fontSize: 9 },
    columnStyles: { 1: { halign: 'right', cellWidth: 110 } },
  });
  return getAutoTableFinalY(doc, startY) + 8;
}

function addBoldRow(label: string, amount: number): any[] {
  return [
    { content: label, styles: { fontStyle: 'bold' } },
    { content: formatCurrency(amount), styles: { fontStyle: 'bold' } },
  ];
}

// ---------------------------------------------------------------------------
// Chart capture
// ---------------------------------------------------------------------------

export async function captureChartImages(): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  const elements = document.querySelectorAll<HTMLElement>('[data-pdf-chart]');
  if (elements.length === 0) return images;

  // Find the parent TabsContent that may be hidden
  const tabsContentSet = new Set<HTMLElement>();
  elements.forEach((el) => {
    const parent = el.closest('[data-state="inactive"]') as HTMLElement | null;
    if (parent) tabsContentSet.add(parent);
  });

  // Temporarily make hidden tab content visible for html2canvas
  const restoreFns: (() => void)[] = [];
  tabsContentSet.forEach((el) => {
    const prev = {
      display: el.style.display,
      position: el.style.position,
      visibility: el.style.visibility,
      left: el.style.left,
    };
    el.style.display = 'block';
    el.style.position = 'absolute';
    el.style.visibility = 'visible';
    el.style.left = '-9999px';
    restoreFns.push(() => {
      el.style.display = prev.display;
      el.style.position = prev.position;
      el.style.visibility = prev.visibility;
      el.style.left = prev.left;
    });
  });

  // Brief delay to let the browser layout the newly-visible elements
  await new Promise((r) => window.setTimeout(r, 200));

  for (const el of elements) {
    const key = el.getAttribute('data-pdf-chart') || '';
    if (!key) continue;
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
      });
      images[key] = canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      // Non-blocking: skip this chart
    }
  }

  // Restore hidden tab styles
  restoreFns.forEach((fn) => fn());
  return images;
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function renderCover(
  doc: jsPDF,
  report: FinancialReport,
  sectionNames: string[],
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  let y = 140;

  // Company name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(20, 20, 20);
  doc.text(report.companyName, centerX, y, { align: 'center' });

  y += 34;
  doc.setFontSize(16);
  doc.setTextColor(HEADER_FILL[0], HEADER_FILL[1], HEADER_FILL[2]);
  doc.text('Comprehensive Financial Report', centerX, y, { align: 'center' });

  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text(`Reporting Period: ${report.reportPeriod}`, centerX, y, { align: 'center' });

  y += 16;
  doc.text(`Generated: ${new Date().toLocaleString()}`, centerX, y, { align: 'center' });

  // Table of Contents
  y += 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text('Table of Contents', MARGIN + 100, y);

  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  sectionNames.forEach((name, idx) => {
    doc.setTextColor(50, 50, 50);
    doc.text(`${idx + 1}.  ${name}`, MARGIN + 110, y);
    y += 16;
  });
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderProfitAndLoss(doc: jsPDF, report: FinancialReport): void {
  let y = addSectionHeader(doc, 'Profit & Loss Statement', `Period: ${report.reportPeriod}`);
  const pnl = report.profitAndLoss;

  const body: any[][] = [];

  // Revenue
  body.push([{ content: 'Revenue', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(pnl.revenue));
  body.push(addBoldRow('Total Revenue', pnl.totalRevenue));

  // COGS
  body.push([{ content: 'Cost of Goods Sold', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(pnl.costOfGoodsSold));
  body.push(addBoldRow('Total COGS', pnl.totalCOGS));
  body.push(addBoldRow(`Gross Profit (${pnl.grossMargin.toFixed(1)}%)`, pnl.grossProfit));

  // Operating Expenses
  body.push([{ content: 'Operating Expenses', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(pnl.operatingExpenses));
  body.push(addBoldRow('Total Operating Expenses', pnl.totalOperatingExpenses));
  body.push(addBoldRow('Operating Income', pnl.operatingIncome));

  // Other Income / Expenses
  if (pnl.otherIncome.length > 0) {
    body.push([{ content: 'Other Income', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
    body.push(...lineItemRows(pnl.otherIncome));
  }
  if (pnl.otherExpenses.length > 0) {
    body.push([{ content: 'Other Expenses', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
    body.push(...lineItemRows(pnl.otherExpenses));
  }

  body.push(addBoldRow('Income Before Tax', pnl.incomeBeforeTax));
  body.push(addBoldRow('Tax Expense', pnl.taxExpense));
  body.push(addBoldRow(`Net Income (${pnl.netMargin.toFixed(1)}%)`, pnl.netIncome));

  addStatementTable(doc, y, [['Item', 'Amount']], body);
}

function renderCashFlow(doc: jsPDF, report: FinancialReport): void {
  let y = addSectionHeader(doc, 'Cash Flow Statement', `Period: ${report.reportPeriod}`);
  const cf = report.cashFlow;

  const body: any[][] = [];

  body.push([{ content: 'Operating Activities', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(cf.operatingActivities));
  body.push(addBoldRow('Net Operating Cash Flow', cf.netOperatingCashFlow));

  body.push([{ content: 'Investing Activities', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(cf.investingActivities));
  body.push(addBoldRow('Net Investing Cash Flow', cf.netInvestingCashFlow));

  body.push([{ content: 'Financing Activities', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(cf.financingActivities));
  body.push(addBoldRow('Net Financing Cash Flow', cf.netFinancingCashFlow));

  body.push([{ content: '', styles: { fillColor: [220, 220, 220] } }, '']);
  body.push(addBoldRow('Net Cash Change', cf.netCashChange));
  body.push(addBoldRow('Beginning Cash', cf.beginningCash));
  body.push(addBoldRow('Ending Cash', cf.endingCash));

  addStatementTable(doc, y, [['Item', 'Amount']], body);
}

function renderBalanceSheet(doc: jsPDF, report: FinancialReport): void {
  let y = addSectionHeader(doc, 'Balance Sheet', `As of: ${report.balanceSheet.asOfDate}`);
  const bs = report.balanceSheet;

  const body: any[][] = [];

  // Assets
  body.push([{ content: 'ASSETS', styles: { fontStyle: 'bold', fillColor: [219, 234, 254] } }, '']);
  body.push([{ content: 'Current Assets', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(bs.currentAssets));
  body.push(addBoldRow('Total Current Assets', bs.totalCurrentAssets));

  body.push([{ content: 'Non-Current Assets', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(bs.nonCurrentAssets));
  body.push(addBoldRow('Total Non-Current Assets', bs.totalNonCurrentAssets));
  body.push(addBoldRow('Total Assets', bs.totalAssets));

  // Liabilities
  body.push([{ content: 'LIABILITIES', styles: { fontStyle: 'bold', fillColor: [254, 226, 226] } }, '']);
  body.push([{ content: 'Current Liabilities', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(bs.currentLiabilities));
  body.push(addBoldRow('Total Current Liabilities', bs.totalCurrentLiabilities));

  body.push([{ content: 'Non-Current Liabilities', styles: { fontStyle: 'bold', fillColor: [240, 253, 244] } }, '']);
  body.push(...lineItemRows(bs.nonCurrentLiabilities));
  body.push(addBoldRow('Total Non-Current Liabilities', bs.totalNonCurrentLiabilities));
  body.push(addBoldRow('Total Liabilities', bs.totalLiabilities));

  // Equity
  body.push([{ content: 'EQUITY', styles: { fontStyle: 'bold', fillColor: [237, 233, 254] } }, '']);
  body.push(...lineItemRows(bs.equity));
  body.push(addBoldRow('Total Equity', bs.totalEquity));

  body.push([{ content: '', styles: { fillColor: [220, 220, 220] } }, '']);
  body.push(addBoldRow('Total Liabilities & Equity', bs.totalLiabilitiesAndEquity));

  y = addStatementTable(doc, y, [['Item', 'Amount']], body);

  // Balance indicator
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  if (bs.isBalanced) {
    doc.setTextColor(16, 185, 129);
    doc.text('Balance Sheet is balanced.', MARGIN, y + 4);
  } else {
    doc.setTextColor(220, 38, 38);
    const diff = Math.abs(bs.totalAssets - bs.totalLiabilitiesAndEquity);
    doc.text(`Balance Sheet is NOT balanced. Difference: ${formatCurrency(diff)}`, MARGIN, y + 4);
  }
}

function renderRatios(doc: jsPDF, report: FinancialReport): void {
  let y = addSectionHeader(doc, 'Financial Ratios & Health Score');

  // Health score
  const score = report.healthScore;
  const scoreColor: [number, number, number] =
    score >= 70 ? [16, 185, 129] : score >= 40 ? [234, 179, 8] : [220, 38, 38];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.text(`${score}`, MARGIN, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text('/ 100  Health Score', MARGIN + 48, y + 6);

  y += 26;

  // Ratios table
  const statusColors: Record<string, [number, number, number]> = {
    healthy: [16, 185, 129],
    caution: [234, 179, 8],
    warning: [220, 38, 38],
    na: [160, 160, 160],
  };

  const body = report.ratioInterpretations.map((r) => [
    r.name,
    r.formatted,
    {
      content: r.status.toUpperCase(),
      styles: { textColor: statusColors[r.status] || [100, 100, 100], fontStyle: 'bold' as const },
    },
    { content: r.description, styles: { fontSize: 7.5 } },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Ratio', 'Value', 'Status', 'Interpretation']],
    body,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: HEADER_FILL, textColor: [255, 255, 255], fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 60, halign: 'right' },
      2: { cellWidth: 55, halign: 'center' },
      3: { cellWidth: 'auto' },
    },
  });
}

function renderCharts(doc: jsPDF, chartImages: Record<string, string>): void {
  const keys = Object.keys(chartImages);
  if (keys.length === 0) return;

  let y = addSectionHeader(doc, 'Financial Visualizations');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const imgW = (contentWidth - 10) / 2; // two columns with 10pt gap
  const imgH = 180;

  const chartLabels: Record<string, string> = {
    'revenue-vs-expenses': 'Revenue vs Expenses',
    'expense-breakdown': 'Expense Breakdown',
    'cashflow-waterfall': 'Cash Flow Waterfall',
    'asset-allocation': 'Asset Allocation',
    'liability-breakdown': 'Liability Breakdown',
    'profitability-margins': 'Profitability Margins',
  };

  keys.forEach((key, idx) => {
    const col = idx % 2;
    const isNewRow = col === 0 && idx > 0;

    if (isNewRow) y += imgH + 28;

    // Check if we need a new page
    if (y + imgH + 20 > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN + 16;
    }

    const x = col === 0 ? MARGIN : MARGIN + imgW + 10;

    // Chart label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(chartLabels[key] || key, x, y);

    try {
      doc.addImage(chartImages[key], 'JPEG', x, y + 4, imgW, imgH);
    } catch {
      // skip
    }
  });
}

function renderWrittenReport(doc: jsPDF, writtenReport: string, report: FinancialReport): void {
  let y = addSectionHeader(doc, 'Written Financial Report');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);

  const lines: string[] = doc.splitTextToSize(writtenReport, contentWidth);

  for (const line of lines) {
    if (y + LINE_HEIGHT > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN + 16;
    }
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT;
  }
}

function renderTrialBalance(doc: jsPDF, tb: TrialBalance): void {
  let y = addSectionHeader(doc, 'Trial Balance', `As of: ${tb.asOfDate}`);

  // Group rows by category
  const grouped = new Map<AccountCategory, typeof tb.rows>();
  for (const row of tb.rows) {
    const group = grouped.get(row.category) || [];
    group.push(row);
    grouped.set(row.category, group);
  }

  const body: any[][] = [];
  grouped.forEach((rows, category) => {
    body.push([
      { content: CATEGORY_LABELS[category] || category, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [243, 244, 246] } },
      '',
      '',
    ]);
    for (const row of rows) {
      body.push([
        `  ${row.account}`,
        row.debitBalance > 0 ? formatCurrency(row.debitBalance) : '\u2014',
        row.creditBalance > 0 ? formatCurrency(row.creditBalance) : '\u2014',
      ]);
    }
  });

  // Totals
  body.push([
    { content: 'TOTALS', styles: { fontStyle: 'bold' } },
    { content: formatCurrency(tb.totalDebits), styles: { fontStyle: 'bold' } },
    { content: formatCurrency(tb.totalCredits), styles: { fontStyle: 'bold' } },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Account', 'Debit (DR)', 'Credit (CR)']],
    body,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: DATA_HEADER_FILL, textColor: [255, 255, 255], fontSize: 9 },
    columnStyles: {
      1: { halign: 'right', cellWidth: 90 },
      2: { halign: 'right', cellWidth: 90 },
    },
  });

  y = getAutoTableFinalY(doc, y) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  if (tb.isBalanced) {
    doc.setTextColor(16, 185, 129);
    doc.text('Trial Balance is balanced.', MARGIN, y);
  } else {
    doc.setTextColor(220, 38, 38);
    doc.text(`Trial Balance is NOT balanced. Difference: ${formatCurrency(tb.difference)}`, MARGIN, y);
  }
}

function renderBankReconciliation(doc: jsPDF, recon: BankReconciliation): void {
  let y = addSectionHeader(doc, 'Bank Reconciliation', `Statement Date: ${recon.statementDate}`);

  // Summary table
  const summaryBody = [
    ['Bank Closing Balance', formatCurrency(recon.bankClosingBalance)],
    ['Book Closing Balance', formatCurrency(recon.bookClosingBalance)],
    ['Adjusted Bank Balance', formatCurrency(recon.adjustedBankBalance)],
    ['Adjusted Book Balance', formatCurrency(recon.adjustedBookBalance)],
    [
      { content: 'Difference', styles: { fontStyle: 'bold' } },
      {
        content: formatCurrency(recon.difference),
        styles: {
          fontStyle: 'bold',
          textColor: recon.isReconciled ? [16, 185, 129] : [220, 38, 38],
        },
      },
    ],
    [
      'Status',
      {
        content: recon.isReconciled ? 'RECONCILED' : 'NOT RECONCILED',
        styles: {
          fontStyle: 'bold',
          textColor: recon.isReconciled ? [16, 185, 129] : [220, 38, 38],
        },
      },
    ],
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Metric', 'Value']],
    body: summaryBody,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: HEADER_FILL, textColor: [255, 255, 255] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 } },
  });

  y = getAutoTableFinalY(doc, y) + 12;

  // Quality metrics
  const q = recon.quality;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Quality Metric', 'Value']],
    body: [
      ['Reliability Score', `${q.reliabilityScore}/100 (${q.verdict})`],
      ['Bank Reference Coverage', `${q.bankReferenceCoveragePct.toFixed(1)}%`],
      ['Book Reference Coverage', `${q.bookReferenceCoveragePct.toFixed(1)}%`],
      ['Matched by Reference', String(q.matchedByReference)],
      ['Matched by Amount/Date Fallback', String(q.matchedByAmountDateFallback)],
      ['Transactions Matched', String(recon.totalTransactionsMatched)],
      ['Transactions Unmatched', String(recon.totalTransactionsUnmatched)],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: DATA_HEADER_FILL, textColor: [255, 255, 255], fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 200 } },
  });

  y = getAutoTableFinalY(doc, y) + 12;

  // Detail sections
  const pageHeight = doc.internal.pageSize.getHeight();
  const details: { label: string; items: typeof recon.depositsInTransit }[] = [
    { label: 'Deposits in Transit', items: recon.depositsInTransit },
    { label: 'Outstanding Cheques / Payments', items: recon.outstandingCheques },
    { label: 'Bank Charges Not in Books', items: recon.bankChargesUnrecorded },
    { label: 'Bank Credits Not in Books', items: recon.bankCreditsUnrecorded },
    { label: 'Amount Mismatches', items: recon.amountMismatches },
  ];

  for (const detail of details) {
    if (detail.items.length === 0) continue;

    if (y + 60 > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN + 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(`${detail.label} (${detail.items.length})`, MARGIN, y);
    y += 10;

    const detailBody = detail.items.map((item) => [
      item.bankRow?.date || item.bookTransaction?.date || '',
      formatCurrency(item.amount),
      item.bankRow?.description || '',
      item.bookTransaction?.description || item.bookTransaction?.account || '',
      item.variance !== 0 ? formatCurrency(item.variance) : '\u2014',
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Date', 'Amount', 'Bank Description', 'Book Description', 'Variance']],
      body: detailBody,
      theme: 'striped',
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [100, 116, 139], textColor: [255, 255, 255], fontSize: 8 },
    });

    y = getAutoTableFinalY(doc, y) + 12;
  }

  // Notes
  if (recon.notes.length > 0) {
    if (y + 40 > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN + 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text('Notes:', MARGIN, y);
    y += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    for (const note of recon.notes.slice(0, 10)) {
      const noteLines: string[] = doc.splitTextToSize(`- ${note}`, doc.internal.pageSize.getWidth() - MARGIN * 2);
      for (const line of noteLines) {
        if (y + LINE_HEIGHT > pageHeight - MARGIN) {
          doc.addPage();
          y = MARGIN + 16;
        }
        doc.text(line, MARGIN, y);
        y += LINE_HEIGHT;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Page footers
// ---------------------------------------------------------------------------

function addPageFooters(doc: jsPDF, companyName: string): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);

    // Company name (left)
    doc.text(companyName, MARGIN, pageHeight - 20);

    // Page number (right)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 20, { align: 'right' });
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateFullFinancePDF(options: FullReportPDFOptions): Promise<void> {
  const { report, writtenReport, trialBalance, bankReconciliation, chartImages, filenamePrefix } = options;

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  // Build dynamic section list
  const sections: string[] = [
    'Profit & Loss Statement',
    'Cash Flow Statement',
    'Balance Sheet',
    'Financial Ratios & Health Score',
  ];
  if (chartImages && Object.keys(chartImages).length > 0) sections.push('Financial Visualizations');
  sections.push('Written Financial Report');
  if (trialBalance) sections.push('Trial Balance');
  if (bankReconciliation) sections.push('Bank Reconciliation');

  // 1. Cover page
  renderCover(doc, report, sections);

  // 2. P&L
  renderProfitAndLoss(doc, report);

  // 3. Cash Flow
  renderCashFlow(doc, report);

  // 4. Balance Sheet
  renderBalanceSheet(doc, report);

  // 5. Ratios & Health
  renderRatios(doc, report);

  // 6. Charts (optional)
  if (chartImages && Object.keys(chartImages).length > 0) {
    renderCharts(doc, chartImages);
  }

  // 7. Written Report
  renderWrittenReport(doc, writtenReport, report);

  // 8. Trial Balance (optional)
  if (trialBalance) {
    renderTrialBalance(doc, trialBalance);
  }

  // 9. Bank Reconciliation (optional)
  if (bankReconciliation) {
    renderBankReconciliation(doc, bankReconciliation);
  }

  // Page footers
  addPageFooters(doc, report.companyName);

  // Download
  const safePrefix = (filenamePrefix || `${report.companyName}_full_report`)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_');

  triggerPdfDownload(doc, `${safePrefix}_${Date.now()}.pdf`);
}
