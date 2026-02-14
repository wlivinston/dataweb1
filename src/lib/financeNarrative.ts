import { FinancialReport, LineItem } from './financeTypes';

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

const toTitleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());

const summarizeTopItems = (items: LineItem[], limit: number): string => {
  if (!items.length) return 'No material line items were identified in the uploaded data.';

  return items
    .slice(0, limit)
    .map(item => `${item.label} (${formatCurrency(item.amount)})`)
    .join(', ');
};

const healthNarrative = (healthScore: number): string => {
  if (healthScore >= 70) {
    return 'Overall financial condition appears healthy, with current indicators showing stable operations and acceptable risk.';
  }

  if (healthScore >= 40) {
    return 'Overall financial condition is mixed, with some stable indicators and a few areas that require close monitoring.';
  }

  return 'Overall financial condition is weak based on current indicators, and corrective action should be prioritized.';
};

const liquidityNarrative = (currentRatio: number | null, quickRatio: number | null): string => {
  if (currentRatio == null && quickRatio == null) {
    return 'Liquidity ratios could not be computed from the available data.';
  }

  const currentText = currentRatio == null ? 'N/A' : currentRatio.toFixed(2);
  const quickText = quickRatio == null ? 'N/A' : quickRatio.toFixed(2);

  let interpretation = 'Short-term liquidity is currently adequate.';

  if ((currentRatio ?? 0) < 1 || (quickRatio ?? 1) < 0.8) {
    interpretation = 'Short-term liquidity appears tight and may constrain near-term obligations.';
  } else if ((currentRatio ?? 0) >= 2 && (quickRatio ?? 0) >= 1.2) {
    interpretation = 'Short-term liquidity is strong and provides a useful operating buffer.';
  }

  return `Current ratio is ${currentText} and quick ratio is ${quickText}. ${interpretation}`;
};

const leverageNarrative = (debtToEquity: number | null, debtToAssets: number | null): string => {
  const dte = debtToEquity == null ? 'N/A' : debtToEquity.toFixed(2);
  const dta = debtToAssets == null ? 'N/A' : formatPercent(debtToAssets);

  let interpretation = 'Leverage appears manageable for the current asset and earnings profile.';

  if ((debtToEquity ?? 0) > 2.5 || (debtToAssets ?? 0) > 70) {
    interpretation = 'Leverage appears elevated and may increase pressure on future cash flows.';
  } else if ((debtToEquity ?? 1) < 1 && (debtToAssets ?? 100) < 50) {
    interpretation = 'Leverage is conservative, indicating lower balance sheet risk.';
  }

  return `Debt-to-equity is ${dte} and debt-to-assets is ${dta}. ${interpretation}`;
};

export function generateOnePageFinancialNarrative(report: FinancialReport): string {
  const pnl = report.profitAndLoss;
  const bs = report.balanceSheet;
  const cf = report.cashFlow;
  const ratios = report.ratios;

  const topRevenue = summarizeTopItems(pnl.revenue, 3);
  const topExpenses = summarizeTopItems(
    [...pnl.costOfGoodsSold, ...pnl.operatingExpenses, ...pnl.otherExpenses].sort((a, b) => b.amount - a.amount),
    4
  );

  const headline = `One-Page Financial Report for ${report.companyName}`;
  const periodLine = `Reporting period: ${report.reportPeriod}. Generated on ${report.generatedAt.toLocaleDateString()}.`;

  const performanceParagraph =
    `Revenue totals ${formatCurrency(pnl.totalRevenue)} with gross profit of ${formatCurrency(pnl.grossProfit)} ` +
    `(gross margin ${formatPercent(pnl.grossMargin)}). Operating income stands at ${formatCurrency(pnl.operatingIncome)}, ` +
    `and net income is ${formatCurrency(pnl.netIncome)} (net margin ${formatPercent(pnl.netMargin)}). ` +
    `Primary revenue contributors: ${topRevenue}. Key cost drivers: ${topExpenses}.`;

  const balanceParagraph =
    `Total assets are ${formatCurrency(bs.totalAssets)}, while total liabilities are ${formatCurrency(bs.totalLiabilities)} ` +
    `and total equity is ${formatCurrency(bs.totalEquity)}. ` +
    `${bs.isBalanced ? 'Balance sheet totals are in balance.' : 'Balance sheet totals are not in balance and should be reviewed immediately.'}`;

  const cashFlowParagraph =
    `Net operating cash flow is ${formatCurrency(cf.netOperatingCashFlow)}, net investing cash flow is ${formatCurrency(cf.netInvestingCashFlow)}, ` +
    `and net financing cash flow is ${formatCurrency(cf.netFinancingCashFlow)}. ` +
    `Net cash change for the period is ${formatCurrency(cf.netCashChange)}, moving cash from ${formatCurrency(cf.beginningCash)} ` +
    `to ${formatCurrency(cf.endingCash)}.`;

  const ratioParagraph =
    `${liquidityNarrative(ratios.currentRatio, ratios.quickRatio)} ` +
    `${leverageNarrative(ratios.debtToEquity, ratios.debtToAssets)} ` +
    `Profitability indicators show gross margin ${formatPercent(ratios.grossMargin)}, operating margin ${formatPercent(ratios.operatingMargin)}, ` +
    `and net margin ${formatPercent(ratios.netProfitMargin)}.`;

  const priorities: string[] = [];

  if (pnl.netIncome < 0) {
    priorities.push('Prioritize margin recovery by reducing controllable operating costs and re-pricing low-margin offerings.');
  } else {
    priorities.push('Protect profitability by preserving high-margin revenue streams and monitoring cost escalation.');
  }

  if ((ratios.currentRatio ?? 0) < 1.2 || (cf.netOperatingCashFlow ?? 0) < 0) {
    priorities.push('Tighten working-capital discipline through faster collections and stricter payment scheduling.');
  } else {
    priorities.push('Sustain liquidity by maintaining collection cadence and cash forecasting discipline.');
  }

  if (!bs.isBalanced) {
    priorities.push('Reconcile opening balances, account classifications, and period postings to restore balance sheet integrity.');
  } else {
    priorities.push('Continue monthly close controls to maintain statement reliability and audit readiness.');
  }

  const riskParagraph =
    `Financial health score is ${report.healthScore}/100. ${healthNarrative(report.healthScore)} ` +
    (report.warnings.length
      ? `System warnings detected: ${report.warnings.slice(0, 3).join(' ')}.`
      : 'No critical system warnings were generated during statement construction.');

  const prioritySection = priorities
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');

  const appendix =
    `Prepared from canonical transaction data with normalized debits/credits and import validation controls. ` +
    `Category coverage includes ${new Set(report.transactions.map(tx => toTitleCase(tx.category))).size} accounting classifications.`;

  return [
    headline,
    periodLine,
    performanceParagraph,
    balanceParagraph,
    cashFlowParagraph,
    ratioParagraph,
    riskParagraph,
    'Management Priorities',
    prioritySection,
    appendix,
  ].join('\n\n');
}
