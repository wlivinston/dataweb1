import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FinancialReport } from './financeTypes';
import { CanonicalTransaction } from './financeImportPipeline';

interface FinancePDFOptions {
  title?: string;
  filenamePrefix?: string;
}

interface OffsetAppendixPDFOptions {
  filenamePrefix?: string;
  auditLines?: string[];
}

const formatCurrency = (value: number): string => {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
};

const formatPercent = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
};

export const generateFinanceOnePagePDF = (
  report: FinancialReport,
  narrative: string,
  options?: FinancePDFOptions
): void => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = 48;

  const title = options?.title || `${report.companyName} Financial Report`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, margin, y);

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Period: ${report.reportPeriod}`, margin, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin + 220, y);

  y += 14;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['KPI', 'Value', 'KPI', 'Value']],
    body: [[
      'Revenue',
      formatCurrency(report.profitAndLoss.totalRevenue),
      'Net Income',
      formatCurrency(report.profitAndLoss.netIncome),
    ], [
      'Net Margin',
      formatPercent(report.profitAndLoss.netMargin),
      'Health Score',
      `${report.healthScore}/100`,
    ], [
      'Total Assets',
      formatCurrency(report.balanceSheet.totalAssets),
      'Net Cash Change',
      formatCurrency(report.cashFlow.netCashChange),
    ]],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { fontStyle: 'bold' },
    },
  });

  y = (((doc as any).lastAutoTable?.finalY) || y) + 16;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('One-Page Written Financial Report', margin, y);

  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const lines = doc.splitTextToSize(narrative, contentWidth);
  const usableHeight = pageHeight - y - 24;
  const maxLines = Math.max(1, Math.floor(usableHeight / 12));
  const outputLines = lines.slice(0, maxLines);

  doc.text(outputLines, margin, y);

  if (lines.length > maxLines) {
    const noteY = pageHeight - 16;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Report text truncated to keep the PDF on one page.', margin, noteY);
  }

  const safePrefix = (options?.filenamePrefix || `${report.companyName}_financial_report`)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_');

  doc.save(`${safePrefix}_${Date.now()}.pdf`);
};

export const generateOffsetEntriesAppendixPDF = (
  report: FinancialReport,
  offsetEntries: CanonicalTransaction[],
  options?: OffsetAppendixPDFOptions
): void => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = 48;

  const totalDebit = offsetEntries.reduce((sum, row) => sum + (row.Debit || 0), 0);
  const totalCredit = offsetEntries.reduce((sum, row) => sum + (row.Credit || 0), 0);
  const net = totalDebit - totalCredit;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`${report.companyName} - Offset Entries Appendix`, margin, y);

  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Report Period: ${report.reportPeriod}`, margin, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin + 250, y);

  y += 12;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Metric', 'Value']],
    body: [
      ['Auto-generated offset rows', offsetEntries.length.toLocaleString()],
      ['Total debit', formatCurrency(totalDebit)],
      ['Total credit', formatCurrency(totalCredit)],
      ['Net (debit - credit)', formatCurrency(net)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [185, 28, 28], textColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 210 },
      1: { cellWidth: 210 },
    },
  });

  y = (((doc as any).lastAutoTable?.finalY) || y) + 12;

  if (options?.auditLines && options.auditLines.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text('Audit Notes', margin, y);
    y += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const notes = options.auditLines.slice(0, 8).map(line => `- ${line}`);
    const noteLines = doc.splitTextToSize(notes.join('\n'), contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 10 + 8;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Date', 'Account', 'Category', 'Type', 'Debit', 'Credit', 'Source Row', 'Description']],
    body: offsetEntries.map(row => [
      row.Date,
      row.Account,
      row.Category,
      row.Type,
      formatCurrency(row.Debit || 0),
      formatCurrency(row.Credit || 0),
      String(row.SourceRow),
      row.Description || '',
    ]),
    theme: 'striped',
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 78 },
      2: { cellWidth: 66 },
      3: { cellWidth: 42 },
      4: { cellWidth: 56, halign: 'right' },
      5: { cellWidth: 56, halign: 'right' },
      6: { cellWidth: 45, halign: 'right' },
      7: { cellWidth: 100 },
    },
  });

  const safePrefix = (options?.filenamePrefix || `${report.companyName}_offset_entries_appendix`)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_');

  doc.save(`${safePrefix}_${Date.now()}.pdf`);
};
