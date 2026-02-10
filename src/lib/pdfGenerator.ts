// PDF Generation Utility for Analyzed Data
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PDFExportData {
  datasets: Array<{
    name: string;
    rowCount: number;
    columns: string[];
    sampleData: any[][];
  }>;
  kpis: Array<{
    title: string;
    value: string;
    change?: string;
  }>;
  visualizations: Array<{
    title: string;
    type: string;
  }>;
  daxCalculations: Array<{
    name: string;
    formula: string;
    result?: any;
  }>;
  relationships?: Array<{
    from: string;
    to: string;
    type: string;
  }>;
  interpretation?: string;
}

export const generatePDF = (data: PDFExportData, title: string = 'Data Analysis Report'): void => {
  const doc = new jsPDF();
  let yPosition = 20;

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, yPosition);
  yPosition += 10;

  // Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, yPosition);
  yPosition += 15;

  // Executive Summary / Interpretation
  if (data.interpretation) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Analysis Interpretation', 14, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const interpretationLines = doc.splitTextToSize(data.interpretation, 180);
    doc.text(interpretationLines, 14, yPosition);
    yPosition += interpretationLines.length * 5 + 10;
  }

  // KPIs
  if (data.kpis && data.kpis.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Key Performance Indicators', 14, yPosition);
    yPosition += 10;

    const kpiData = data.kpis.map(kpi => [
      kpi.title,
      kpi.value,
      kpi.change || 'N/A'
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['Metric', 'Value', 'Change']],
      body: kpiData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // Datasets Summary
  if (data.datasets && data.datasets.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Datasets Summary', 14, yPosition);
    yPosition += 10;

    const datasetData = data.datasets.map(ds => [
      ds.name,
      ds.rowCount.toString(),
      ds.columns.length.toString()
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['Dataset', 'Rows', 'Columns']],
      body: datasetData,
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] },
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // DAX Calculations
  if (data.daxCalculations && data.daxCalculations.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DAX Calculations', 14, yPosition);
    yPosition += 10;

    const calcData = data.daxCalculations.map(calc => [
      calc.name,
      calc.formula,
      calc.result !== undefined && calc.result !== null 
        ? String(calc.result) 
        : 'Not executed'
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['Calculation', 'Formula', 'Result']],
      body: calcData,
      theme: 'striped',
      headStyles: { fillColor: [139, 92, 246] },
      columnStyles: {
        1: { cellWidth: 80 },
        2: { cellWidth: 60 }
      }
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // Relationships
  if (data.relationships && data.relationships.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Data Relationships', 14, yPosition);
    yPosition += 10;

    const relData = data.relationships.map(rel => [
      rel.from,
      rel.to,
      rel.type
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['From', 'To', 'Type']],
      body: relData,
      theme: 'striped',
      headStyles: { fillColor: [245, 158, 11] },
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // Visualizations
  if (data.visualizations && data.visualizations.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Visualizations', 14, yPosition);
    yPosition += 10;

    const vizData = data.visualizations.map(viz => [
      viz.title,
      viz.type
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['Title', 'Type']],
      body: vizData,
      theme: 'striped',
      headStyles: { fillColor: [236, 72, 153] },
    });
  }

  // Save PDF
  doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
};

