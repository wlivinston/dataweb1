// Enhanced PDF Generator with Visualization Images and AI-Generated Insights
// Generates comprehensive reports with charts and explanations

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { Visualization, Dataset, AIInsightSummary } from './types';
import { RENDERING_LIMITS } from './dataOptimization';

export interface EnhancedPDFExportData {
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
  visualizations: Visualization[];
  daxCalculations: Array<{
    name: string;
    formula: string;
    result?: any;
  }>;
  relationships?: Array<{
    from: string;
    to: string;
    type: string;
    role?: string;
    confidence?: number;
  }>;
  interpretation?: string;
  aiInsights?: AIInsightSummary | null;
  datasetsFull?: Dataset[];
  schemaInfo?: {
    schemaType: string;
    confidence: number;
    factTables: Array<{ name: string; rowCount: number }>;
    dimensionTables: Array<{ name: string; rowCount: number }>;
    explanation: string;
  };
}

const MAX_VISUALIZATIONS_IN_PDF = 6;
const MAX_CAPTURED_VISUALIZATIONS = 3;
const CHART_CAPTURE_TIMEOUT_MS = 3500;
const CHART_CAPTURE_ROW_THRESHOLD = 25000;

/**
 * Generate AI-powered insights for a visualization
 */
const generateVisualizationInsight = (viz: Visualization, dataset?: Dataset): string => {
  const insights: string[] = [];
  
  if (!viz.data || !Array.isArray(viz.data) || viz.data.length === 0) {
    return 'No data available for this visualization.';
  }

  const data = viz.data;
  
  // Bar Chart Insights
  if (viz.type === 'bar') {
    const values = data.map((d: any) => typeof d.value === 'number' ? d.value : Number(d.value) || 0);
    const categories = data.map((d: any) => String(d.category || d.name || ''));
    const total = values.reduce((a: number, b: number) => a + b, 0);
    const maxValue = Math.max(...values);
    const maxIndex = values.indexOf(maxValue);
    const minValue = Math.min(...values);
    const minIndex = values.indexOf(minValue);
    const avg = total / values.length;
    
    insights.push(`📊 This bar chart shows ${categories.length} categories with a total value of ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`);
    insights.push(`🏆 The highest value is "${categories[maxIndex]}" with ${maxValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}, representing ${((maxValue / total) * 100).toFixed(1)}% of the total.`);
    
    if (minValue > 0) {
      insights.push(`📉 The lowest value is "${categories[minIndex]}" with ${minValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`);
    }
    
    const variance = values.reduce((sum: number, val: number) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avg > 0 ? (stdDev / avg) * 100 : 0;
    
    if (coefficientOfVariation > 50) {
      insights.push(`⚠️ High variability detected (CV: ${coefficientOfVariation.toFixed(1)}%). Values show significant differences across categories.`);
    } else if (coefficientOfVariation < 20) {
      insights.push(`✓ Low variability (CV: ${coefficientOfVariation.toFixed(1)}%). Values are relatively consistent across categories.`);
    }
    
    // Check for outliers
    const q1 = values.sort((a: number, b: number) => a - b)[Math.floor(values.length * 0.25)];
    const q3 = values.sort((a: number, b: number) => a - b)[Math.floor(values.length * 0.75)];
    const iqr = q3 - q1;
    const outliers = values.filter((v: number) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    if (outliers.length > 0) {
      insights.push(`🔍 ${outliers.length} outlier${outliers.length > 1 ? 's' : ''} detected. Consider investigating these extreme values.`);
    }
  }
  
  // Pie Chart Insights
  if (viz.type === 'pie') {
    const values = data.map((d: any) => typeof d.value === 'number' ? d.value : Number(d.value) || 0);
    const categories = data.map((d: any) => String(d.category || d.name || ''));
    const total = values.reduce((a: number, b: number) => a + b, 0);
    
    if (total === 0) {
      return 'No data available for this pie chart.';
    }
    
    const percentages = values.map((v: number) => (v / total) * 100);
    const maxIndex = values.indexOf(Math.max(...values));
    const minIndex = values.indexOf(Math.min(...values.filter((v: number) => v > 0)));
    
    insights.push(`🥧 This pie chart represents ${categories.length} categories with a total of ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`);
    insights.push(`🎯 The largest segment is "${categories[maxIndex]}" at ${percentages[maxIndex].toFixed(1)}% (${values[maxIndex].toLocaleString(undefined, { maximumFractionDigits: 2 })}).`);
    
    if (minIndex >= 0) {
      insights.push(`📌 The smallest segment is "${categories[minIndex]}" at ${percentages[minIndex].toFixed(1)}% (${values[minIndex].toLocaleString(undefined, { maximumFractionDigits: 2 })}).`);
    }
    
    // Check for dominance
    const dominance = percentages[maxIndex];
    if (dominance > 50) {
      insights.push(`⚠️ "${categories[maxIndex]}" dominates the distribution with over 50% share. This may indicate an imbalance that warrants investigation.`);
    }
    
    // Check for even distribution
    const avgPercentage = 100 / categories.length;
    const isEvenlyDistributed = percentages.every((p: number) => Math.abs(p - avgPercentage) < 10);
    if (isEvenlyDistributed) {
      insights.push(`✓ Values are relatively evenly distributed across categories.`);
    }
  }
  
  // Line Chart Insights
  if (viz.type === 'line') {
    const values = data.map((d: any) => typeof d.value === 'number' ? d.value : Number(d.value) || 0);
    const categories = data.map((d: any) => String(d.category || d.name || ''));
    
    if (values.length < 2) {
      return 'Insufficient data points for trend analysis.';
    }
    
    // Calculate trend
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
    const sumX2 = x.reduce((a, b) => a + b * b, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
    const trend = slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable';
    
    insights.push(`📈 This line chart shows ${values.length} data points over time.`);
    
    if (Math.abs(slope) > 0.01) {
      insights.push(`📊 ${trend.charAt(0).toUpperCase() + trend.slice(1)} trend detected. The value ${trend === 'increasing' ? 'rises' : 'falls'} by an average of ${Math.abs(slope).toFixed(2)} per period.`);
    } else {
      insights.push(`➡️ Relatively stable trend with minimal change over time.`);
    }
    
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const range = maxValue - minValue;
    insights.push(`📏 Range: ${minValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} to ${maxValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} (span of ${range.toLocaleString(undefined, { maximumFractionDigits: 2 })}).`);
    
    // Check for volatility
    const mean = sumY / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? (stdDev / mean) * 100 : 0;
    
    if (coefficientOfVariation > 30) {
      insights.push(`⚡ High volatility detected (CV: ${coefficientOfVariation.toFixed(1)}%). Values fluctuate significantly.`);
    }
  }
  
  // Area Chart Insights (similar to line)
  if (viz.type === 'area') {
    const values = data.map((d: any) => typeof d.value === 'number' ? d.value : Number(d.value) || 0);
    insights.push(`📊 This area chart visualizes ${values.length} data points, showing cumulative or stacked values over time.`);
    const total = values.reduce((a: number, b: number) => a + b, 0);
    insights.push(`📈 Total area represents ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} units.`);
  }
  
  // Table Insights
  if (viz.type === 'table') {
    insights.push(`📋 This table displays ${data.length} rows of structured data.`);
    if (data.length > 0) {
      const columns = Object.keys(data[0]);
      insights.push(`📊 Contains ${columns.length} columns: ${columns.slice(0, 5).join(', ')}${columns.length > 5 ? '...' : ''}.`);
    }
  }
  
  // Scatter Plot Insights
  if (viz.type === 'scatter') {
    insights.push(`🔍 This scatter plot shows relationships between variables.`);
    insights.push(`💡 Look for clusters, trends, or outliers that indicate patterns or correlations.`);
  }
  
  // Gauge Insights
  if (viz.type === 'gauge') {
    const value = typeof data === 'number' ? data : (Array.isArray(data) && data.length > 0 ? data[0] : 0);
    insights.push(`🎯 Current value: ${typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}.`);
    insights.push(`📊 This gauge provides a quick visual indicator of performance against targets.`);
  }
  
  // Add correlation insights if AI insights are available
  if (dataset && viz.type === 'bar' && data.length > 0) {
    const categories = data.map((d: any) => String(d.category || d.name || ''));
    const values = data.map((d: any) => typeof d.value === 'number' ? d.value : Number(d.value) || 0);
    
    // Check if this might be related to correlations
    if (categories.length > 5) {
      insights.push(`💡 Consider segmenting or grouping categories if there are too many to analyze effectively.`);
    }
  }
  
  return insights.join(' ');
};

/**
 * Capture a chart element as an image with retry
 */
const captureWithRetry = async (element: HTMLElement, retries = 1): Promise<string | null> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
        useCORS: true,
        allowTaint: true,
        windowWidth: Math.min(element.scrollWidth || 800, 1000),
        windowHeight: Math.min(element.scrollHeight || 400, 700),
        onclone: (clonedDoc) => {
          const svgs = clonedDoc.querySelectorAll('svg');
          svgs.forEach(svg => {
            if (!svg.getAttribute('width')) {
              svg.setAttribute('width', String(element.offsetWidth || 600));
              svg.setAttribute('height', String(element.offsetHeight || 300));
            }
          });
        }
      });
      return canvas.toDataURL('image/png', 0.9);
    } catch (error) {
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  return null;
};

/**
 * Parse hex color to RGB components
 */
const parseHexColor = (hex: string): [number, number, number] => {
  const color = hex.replace('#', '');
  return [
    parseInt(color.slice(0, 2), 16) || 59,
    parseInt(color.slice(2, 4), 16) || 130,
    parseInt(color.slice(4, 6), 16) || 246
  ];
};

/**
 * Render a simplified bar chart directly in the PDF using jsPDF drawing APIs
 */
const renderSimplifiedBarChart = (
  doc: jsPDF,
  data: Array<{ category: string; value: number }>,
  x: number, y: number, width: number, height: number,
  colors: string[]
) => {
  if (!data || data.length === 0) return;

  const items = data.slice(0, 15);
  const maxValue = Math.max(...items.map(d => d.value), 1);
  const chartHeight = height - 18;
  const barWidth = Math.max((width - 20) / items.length - 2, 4);

  // Draw axes
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  doc.line(x + 15, y, x + 15, y + chartHeight);
  doc.line(x + 15, y + chartHeight, x + width, y + chartHeight);

  // Draw bars
  items.forEach((item, i) => {
    const barHeight = maxValue > 0 ? (item.value / maxValue) * (chartHeight - 5) : 0;
    const barX = x + 18 + i * (barWidth + 2);
    const barY = y + chartHeight - barHeight;

    const [r, g, b] = parseHexColor(colors[i % colors.length] || '#3B82F6');
    doc.setFillColor(r, g, b);
    doc.rect(barX, barY, barWidth, barHeight, 'F');

    // Label
    doc.setFontSize(5);
    doc.setTextColor(80, 80, 80);
    const label = item.category.length > 6 ? item.category.substring(0, 5) + '.' : item.category;
    doc.text(label, barX + 1, y + chartHeight + 5);
  });

  doc.setTextColor(0, 0, 0);
};

/**
 * Render a simplified pie chart directly in the PDF
 */
const renderSimplifiedPieChart = (
  doc: jsPDF,
  data: Array<{ category: string; value: number }>,
  x: number, y: number, width: number, height: number,
  colors: string[]
) => {
  if (!data || data.length === 0) return;

  const total = data.reduce((sum, d) => sum + (d.value || 0), 0);
  if (total === 0) return;

  const centerX = x + width / 3;
  const centerY = y + height / 2;
  const radius = Math.min(width / 3, height / 2) - 5;

  let startAngle = -Math.PI / 2; // Start from top

  data.slice(0, 10).forEach((item, i) => {
    const sliceAngle = (item.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;

    const [r, g, b] = parseHexColor(colors[i % colors.length] || '#3B82F6');
    doc.setFillColor(r, g, b);

    // Draw pie sector as a filled triangle approximation
    const steps = Math.max(Math.ceil(sliceAngle / 0.1), 3);
    const points: number[][] = [[centerX, centerY]];
    for (let s = 0; s <= steps; s++) {
      const angle = startAngle + (sliceAngle * s) / steps;
      points.push([centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)]);
    }

    // Draw filled polygon using triangles
    for (let p = 1; p < points.length - 1; p++) {
      doc.triangle(
        points[0][0], points[0][1],
        points[p][0], points[p][1],
        points[p + 1][0], points[p + 1][1],
        'F'
      );
    }

    startAngle = endAngle;
  });

  // Legend
  const legendX = x + width * 0.65;
  let legendY = y + 5;
  doc.setFontSize(6);
  data.slice(0, 8).forEach((item, i) => {
    const [r, g, b] = parseHexColor(colors[i % colors.length] || '#3B82F6');
    doc.setFillColor(r, g, b);
    doc.rect(legendX, legendY - 3, 4, 4, 'F');
    doc.setTextColor(60, 60, 60);
    const pct = ((item.value / total) * 100).toFixed(1);
    const label = item.category.length > 12 ? item.category.substring(0, 10) + '..' : item.category;
    doc.text(`${label} (${pct}%)`, legendX + 6, legendY);
    legendY += 6;
  });

  doc.setTextColor(0, 0, 0);
};

/**
 * Render a simplified line chart directly in the PDF
 */
const renderSimplifiedLineChart = (
  doc: jsPDF,
  data: Array<{ category: string; value: number }>,
  x: number, y: number, width: number, height: number,
  colors: string[]
) => {
  if (!data || data.length < 2) return;

  const items = data.slice(0, 50);
  const maxValue = Math.max(...items.map(d => d.value), 1);
  const minValue = Math.min(...items.map(d => d.value), 0);
  const range = maxValue - minValue || 1;
  const chartHeight = height - 18;
  const chartWidth = width - 20;

  // Draw axes
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  doc.line(x + 15, y, x + 15, y + chartHeight);
  doc.line(x + 15, y + chartHeight, x + width, y + chartHeight);

  // Draw line
  const [r, g, b] = parseHexColor(colors[0] || '#3B82F6');
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.8);

  const stepX = chartWidth / (items.length - 1);

  for (let i = 0; i < items.length - 1; i++) {
    const x1 = x + 18 + i * stepX;
    const y1 = y + chartHeight - ((items[i].value - minValue) / range) * (chartHeight - 5);
    const x2 = x + 18 + (i + 1) * stepX;
    const y2 = y + chartHeight - ((items[i + 1].value - minValue) / range) * (chartHeight - 5);

    doc.line(x1, y1, x2, y2);

    // Data point dot
    doc.setFillColor(r, g, b);
    if (items.length <= 20) {
      doc.circle(x1, y1, 0.8, 'F');
    }
  }

  // Last data point
  if (items.length <= 20) {
    const lastX = x + 18 + (items.length - 1) * stepX;
    const lastY = y + chartHeight - ((items[items.length - 1].value - minValue) / range) * (chartHeight - 5);
    doc.circle(lastX, lastY, 0.8, 'F');
  }

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.setTextColor(0, 0, 0);
};

/**
 * Render schema diagram directly in the PDF
 */
const renderSchemaDiagram = (
  doc: jsPDF,
  schemaInfo: NonNullable<EnhancedPDFExportData['schemaInfo']>,
  x: number, y: number, width: number, height: number
) => {
  const allTables = [
    ...schemaInfo.factTables.map(t => ({ ...t, role: 'fact' as const })),
    ...schemaInfo.dimensionTables.map(t => ({ ...t, role: 'dimension' as const }))
  ];

  if (allTables.length === 0) return;

  const boxWidth = 60;
  const boxHeight = 22;

  // Position fact tables in center, dimensions around them
  const factTables = allTables.filter(t => t.role === 'fact');
  const dimTables = allTables.filter(t => t.role === 'dimension');

  const centerX = x + width / 2;
  const centerY = y + height / 2;

  // Draw fact table(s) centered
  factTables.forEach((ft, i) => {
    const fx = centerX - boxWidth / 2;
    const fy = centerY - boxHeight / 2 + i * (boxHeight + 8);

    // Blue box for fact table
    doc.setFillColor(219, 234, 254);
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.8);
    doc.roundedRect(fx, fy, boxWidth, boxHeight, 3, 3, 'FD');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text('FACT', fx + 2, fy + 5);

    doc.setFontSize(8);
    doc.setTextColor(17, 24, 39);
    const name = ft.name.length > 14 ? ft.name.substring(0, 12) + '..' : ft.name;
    doc.text(name, fx + boxWidth / 2, fy + 12, { align: 'center' });

    doc.setFontSize(6);
    doc.setTextColor(107, 114, 128);
    doc.text(`${ft.rowCount.toLocaleString()} rows`, fx + boxWidth / 2, fy + 18, { align: 'center' });
  });

  // Draw dimension tables arranged around fact tables
  const dimRadius = Math.min(width / 2 - boxWidth, height / 2 - boxHeight) - 10;
  const angleStep = dimTables.length > 0 ? (2 * Math.PI) / dimTables.length : 0;

  dimTables.forEach((dt, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const dx = centerX + dimRadius * Math.cos(angle) - boxWidth / 2;
    const dy = centerY + dimRadius * Math.sin(angle) - boxHeight / 2;

    // Green box for dimension table
    doc.setFillColor(209, 250, 229);
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.6);
    doc.roundedRect(dx, dy, boxWidth, boxHeight, 3, 3, 'FD');

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('DIM', dx + 2, dy + 5);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    const name = dt.name.length > 14 ? dt.name.substring(0, 12) + '..' : dt.name;
    doc.text(name, dx + boxWidth / 2, dy + 12, { align: 'center' });

    doc.setFontSize(6);
    doc.setTextColor(107, 114, 128);
    doc.text(`${dt.rowCount.toLocaleString()} rows`, dx + boxWidth / 2, dy + 18, { align: 'center' });

    // Draw connection line from dimension to fact table center
    doc.setDrawColor(156, 163, 175);
    doc.setLineWidth(0.4);
    const lineStartX = dx + boxWidth / 2;
    const lineStartY = dy + boxHeight / 2;
    const lineEndX = centerX;
    const lineEndY = centerY;
    doc.line(lineStartX, lineStartY, lineEndX, lineEndY);
  });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.2);
};

/**
 * Capture a chart element as an image
 */
const captureChartImage = async (elementId: string): Promise<string | null> => {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`Element with id ${elementId} not found`);
      return null;
    }

    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2, // Higher quality
      logging: false,
      useCORS: true,
      allowTaint: true
    });

    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error capturing chart:', error);
    return null;
  }
};

/**
 * Generate enhanced PDF with visualizations and insights
 * Includes safety checks for large datasets
 */
export const generateEnhancedPDF = async (
  data: EnhancedPDFExportData,
  title: string = 'Data Analysis Report',
  chartElements?: Map<string, HTMLElement>
): Promise<void> => {
  // Safety check: Cancel if dataset is too large
  const totalRows = data.datasets.reduce((sum, ds) => sum + ds.rowCount, 0);
  if (totalRows > 100000) {
    throw new Error(
      `Dataset too large (${totalRows.toLocaleString()} rows). ` +
      `PDF generation is limited to datasets under 100,000 rows for performance. ` +
      `Please filter or sample your data first.`
    );
  }

  const doc = new jsPDF();
  let yPosition = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - (margin * 2);

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, yPosition);
  yPosition += 10;

  // Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, yPosition);
  yPosition += 15;

  // Executive Summary / Interpretation
  if (data.interpretation) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Executive Summary', margin, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const interpretationLines = doc.splitTextToSize(data.interpretation, contentWidth);
    doc.text(interpretationLines, margin, yPosition);
    yPosition += interpretationLines.length * 5 + 10;
    
    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      doc.addPage();
      yPosition = 20;
    }
  }

  // AI Insights Summary
  if (data.aiInsights) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('AI-Powered Insights Summary', margin, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const summaryLines = doc.splitTextToSize(data.aiInsights.executiveSummary, contentWidth);
    doc.text(summaryLines, margin, yPosition);
    yPosition += summaryLines.length * 5 + 10;

    // Key Metrics
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Key Metrics:', margin, yPosition);
    yPosition += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`• Total Insights: ${data.aiInsights.totalInsights}`, margin + 5, yPosition);
    yPosition += 5;
    doc.text(`• Critical Findings: ${data.aiInsights.criticalFindings}`, margin + 5, yPosition);
    yPosition += 5;
    doc.text(`• Data Quality Score: ${data.aiInsights.dataQualityScore}%`, margin + 5, yPosition);
    yPosition += 5;
    doc.text(`• Strong Correlations: ${data.aiInsights.correlations.filter((c: any) => c.strength === 'strong').length}`, margin + 5, yPosition);
    yPosition += 10;

    if (yPosition > pageHeight - 40) {
      doc.addPage();
      yPosition = 20;
    }
  }

  // KPIs
  if (data.kpis && data.kpis.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Key Performance Indicators', margin, yPosition);
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
      margin: { left: margin, right: margin }
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
    
    if (yPosition > pageHeight - 40) {
      doc.addPage();
      yPosition = 20;
    }
  }

  const shouldAttemptChartCapture =
    Boolean(chartElements && chartElements.size > 0) &&
    totalRows <= CHART_CAPTURE_ROW_THRESHOLD;

  // Visualizations with Images and Insights
  if (data.visualizations && data.visualizations.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Data Visualizations & Insights', margin, yPosition);
    yPosition += 15;

    // Limit visualizations to keep generation responsive.
    const vizToInclude = data.visualizations.slice(0, MAX_VISUALIZATIONS_IN_PDF);
    
    for (let i = 0; i < vizToInclude.length; i++) {
      const viz = vizToInclude[i];
      
      // Check if we need a new page
      if (yPosition > pageHeight - 80) {
        doc.addPage();
        yPosition = 20;
      }

      // Visualization Title
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(`${i + 1}. ${viz.title}`, contentWidth);
      doc.text(titleLines, margin, yPosition);
      yPosition += titleLines.length * 5 + 3;

      // Chart Type Badge
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setFillColor(139, 92, 246);
      doc.roundedRect(margin, yPosition - 3, 30, 5, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(viz.type.toUpperCase(), margin + 2, yPosition);
      doc.setTextColor(0, 0, 0);
      yPosition += 8;

      // Try to capture only the first few charts and fall back for the rest.
      let chartImage: string | null = null;
      if (shouldAttemptChartCapture && i < MAX_CAPTURED_VISUALIZATIONS) {
        try {
          const capturePromise = new Promise<string | null>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('Chart capture timeout');
              resolve(null);
            }, CHART_CAPTURE_TIMEOUT_MS);

            (async () => {
              try {
                const possibleSelectors = [
                  `#viz-${viz.id}`,
                  `[data-viz-id="${viz.id}"]`,
                  `#chart-${viz.id}`,
                  `#visualization-${i}`
                ];

                let chartElement: HTMLElement | null = null;

                for (const selector of possibleSelectors) {
                  chartElement = document.querySelector(selector) as HTMLElement;
                  if (chartElement) break;
                }

                if (!chartElement) {
                  const found = Array.from(chartElements.entries()).find(([id]) =>
                    id.includes(viz.id) || id === `viz-${viz.id}`
                  );
                  if (found) {
                    chartElement = found[1];
                  }
                }

                if (chartElement) {
                  // Use retry-enabled capture
                  const result = await captureWithRetry(chartElement, 1);
                  clearTimeout(timeout);
                  resolve(result);
                } else {
                  clearTimeout(timeout);
                  resolve(null);
                }
              } catch (error) {
                clearTimeout(timeout);
                console.warn('Could not capture chart image:', error);
                resolve(null);
              }
            })();
          });

          chartImage = await capturePromise;
        } catch (error) {
          console.warn('Chart capture failed:', error);
          chartImage = null;
        }
      }

      // Add chart image if available
      if (chartImage) {
        const imgWidth = Math.min(contentWidth, 150);
        const imgHeight = (imgWidth / 2);

        if (yPosition + imgHeight > pageHeight - 40) {
          doc.addPage();
          yPosition = 20;
        }

        doc.addImage(chartImage, 'PNG', margin, yPosition, imgWidth, imgHeight);
        yPosition += imgHeight + 8;
      } else {
        // Fallback: Render simplified chart directly in PDF using drawing APIs
        const chartFallbackHeight = 60;
        if (yPosition + chartFallbackHeight > pageHeight - 40) {
          doc.addPage();
          yPosition = 20;
        }

        if (viz.type === 'bar' && Array.isArray(viz.data) && viz.data.length > 0) {
          renderSimplifiedBarChart(doc, viz.data, margin, yPosition, contentWidth, chartFallbackHeight, viz.colors);
          yPosition += chartFallbackHeight + 5;
        } else if (viz.type === 'pie' && Array.isArray(viz.data) && viz.data.length > 0) {
          renderSimplifiedPieChart(doc, viz.data, margin, yPosition, contentWidth, chartFallbackHeight, viz.colors);
          yPosition += chartFallbackHeight + 5;
        } else if ((viz.type === 'line' || viz.type === 'area') && Array.isArray(viz.data) && viz.data.length > 1) {
          renderSimplifiedLineChart(doc, viz.data, margin, yPosition, contentWidth, chartFallbackHeight, viz.colors);
          yPosition += chartFallbackHeight + 5;
        } else {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(128, 128, 128);
          doc.text('Chart visualization (see interactive dashboard)', margin, yPosition);
          doc.setTextColor(0, 0, 0);
          yPosition += 8;
        }
      }

      // Generate and add AI insights
      const dataset = data.datasetsFull?.find(ds => ds.id === viz.datasetId);
      const insight = generateVisualizationInsight(viz, dataset);
      
      if (insight) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(59, 130, 246);
        doc.text('💡 Key Insights:', margin, yPosition);
        yPosition += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        const insightLines = doc.splitTextToSize(insight, contentWidth);
        
        // Check if insights fit on current page
        if (yPosition + (insightLines.length * 4) > pageHeight - 20) {
          doc.addPage();
          yPosition = 20;
        }
        
        doc.text(insightLines, margin, yPosition);
        yPosition += insightLines.length * 4 + 10;
      }

      // Add separator line
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 10;
    }
  }

  // Datasets Summary
  if (data.datasets && data.datasets.length > 0) {
    if (yPosition > pageHeight - 60) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Datasets Summary', margin, yPosition);
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
      margin: { left: margin, right: margin }
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // DAX Calculations
  if (data.daxCalculations && data.daxCalculations.length > 0) {
    if (yPosition > pageHeight - 60) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DAX Calculations', margin, yPosition);
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
      },
      margin: { left: margin, right: margin }
    });

    yPosition = ((doc as any).lastAutoTable?.finalY || yPosition) + 15;
  }

  // Schema Diagram
  if (data.schemaInfo && data.schemaInfo.schemaType !== 'none' && data.schemaInfo.schemaType !== 'flat') {
    doc.addPage();
    yPosition = 20;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Data Schema Diagram', margin, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Schema Type: ${data.schemaInfo.schemaType.toUpperCase()}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Confidence: ${(data.schemaInfo.confidence * 100).toFixed(0)}%`, margin, yPosition);
    yPosition += 8;

    if (data.schemaInfo.explanation) {
      doc.setFontSize(9);
      const explanationLines = doc.splitTextToSize(data.schemaInfo.explanation, contentWidth);
      doc.text(explanationLines, margin, yPosition);
      yPosition += explanationLines.length * 4 + 8;
    }

    // Draw the schema diagram
    const diagramHeight = Math.min(140, pageHeight - yPosition - 30);
    if (diagramHeight > 60) {
      renderSchemaDiagram(doc, data.schemaInfo, margin, yPosition, contentWidth, diagramHeight);
      yPosition += diagramHeight + 10;
    }
  }

  // Relationships
  if (data.relationships && data.relationships.length > 0) {
    if (yPosition > pageHeight - 60) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Data Relationships', margin, yPosition);
    yPosition += 10;

    const relData = data.relationships.map(rel => [
      rel.from,
      rel.to,
      rel.type,
      rel.role || '',
      rel.confidence !== undefined ? `${(rel.confidence * 100).toFixed(0)}%` : 'Manual'
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['From', 'To', 'Type', 'Role', 'Confidence']],
      body: relData,
      theme: 'striped',
      headStyles: { fillColor: [245, 158, 11] },
      margin: { left: margin, right: margin }
    });
  }

  // Save PDF
  doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
};

// Export the original function for backward compatibility
export { generatePDF } from './pdfGenerator';
