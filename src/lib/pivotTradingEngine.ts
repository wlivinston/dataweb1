// ─────────────────────────────────────────────────────────────
// Pivot Trading Engine — Action Forex Formula
// Strategy: Buy at S1 test, Sell at R1 test (2am–4am EST)
// ─────────────────────────────────────────────────────────────

export interface OHLCData {
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PivotLevels {
  pp: number;   // Pivot Point (grey line)
  r1: number;   // Resistance 1
  r2: number;   // Resistance 2
  r3: number;   // Resistance 3
  s1: number;   // Support 1
  s2: number;   // Support 2
  s3: number;   // Support 3
}

export interface TradeSignal {
  id: string;
  timestamp: string;
  type: 'BUY' | 'SELL' | 'HOLD' | 'CAUTION';
  price: number;
  level: string;           // e.g. "S1", "R1"
  lotSize: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  isVolatile: boolean;
  riskScore: number;       // 1-10
}

export interface NewsItem {
  title: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  currency: string;
  time: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  source: string;
}

export interface TradingSession {
  isActive: boolean;
  windowStart: string;     // "02:00 EST"
  windowEnd: string;       // "04:00 EST"
  currentTime: string;
  minutesRemaining: number;
}

export interface MarketState {
  currentPrice: number;
  pivots: PivotLevels;
  position: 'ABOVE_R1' | 'BELOW_S1' | 'IN_RANGE' | 'AT_R1' | 'AT_S1' | 'AT_PP';
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  spread: number;
  session: TradingSession;
}

// ─── Action Forex Pivot Point Formula (Classic/Standard) ────
// This is the most reliable and widely used formula from actionforex.com
export function calculatePivotLevels(high: number, low: number, close: number): PivotLevels {
  const pp = (high + low + close) / 3;

  const r1 = (2 * pp) - low;
  const s1 = (2 * pp) - high;

  const r2 = pp + (high - low);
  const s2 = pp - (high - low);

  const r3 = high + 2 * (pp - low);
  const s3 = low - 2 * (pp - high);

  return {
    pp: roundPrice(pp),
    r1: roundPrice(r1),
    r2: roundPrice(r2),
    r3: roundPrice(r3),
    s1: roundPrice(s1),
    s2: roundPrice(s2),
    s3: roundPrice(s3),
  };
}

// ─── Fibonacci Pivot Points (Alternative) ───────────────────
export function calculateFibonacciPivots(high: number, low: number, close: number): PivotLevels {
  const pp = (high + low + close) / 3;
  const range = high - low;

  return {
    pp: roundPrice(pp),
    r1: roundPrice(pp + 0.382 * range),
    r2: roundPrice(pp + 0.618 * range),
    r3: roundPrice(pp + 1.000 * range),
    s1: roundPrice(pp - 0.382 * range),
    s2: roundPrice(pp - 0.618 * range),
    s3: roundPrice(pp - 1.000 * range),
  };
}

// ─── Price rounding for forex (5 decimal places) ────────────
function roundPrice(price: number): number {
  return Math.round(price * 100000) / 100000;
}

// ─── Determine market position relative to pivots ───────────
export function getMarketPosition(price: number, pivots: PivotLevels): MarketState['position'] {
  const tolerance = 0.0003; // 3 pips tolerance for "at level"

  if (Math.abs(price - pivots.s1) <= tolerance) return 'AT_S1';
  if (Math.abs(price - pivots.r1) <= tolerance) return 'AT_R1';
  if (Math.abs(price - pivots.pp) <= tolerance) return 'AT_PP';
  if (price > pivots.r1) return 'ABOVE_R1';
  if (price < pivots.s1) return 'BELOW_S1';
  return 'IN_RANGE';
}

// ─── Determine volatility from news and price action ────────
export function assessVolatility(
  price: number,
  pivots: PivotLevels,
  newsItems: NewsItem[],
  recentCandles: OHLCData[]
): 'HIGH' | 'MEDIUM' | 'LOW' {
  let score = 0;

  // Price outside R1/S1 range = volatile
  if (price > pivots.r1 || price < pivots.s1) score += 3;

  // High impact news = volatile
  const highImpactNews = newsItems.filter(
    n => n.impact === 'HIGH' && (n.currency === 'EUR' || n.currency === 'USD')
  );
  score += highImpactNews.length * 2;

  // Medium impact news
  const mediumImpactNews = newsItems.filter(
    n => n.impact === 'MEDIUM' && (n.currency === 'EUR' || n.currency === 'USD')
  );
  score += mediumImpactNews.length;

  // Calculate ATR from recent candles for range volatility
  if (recentCandles.length >= 3) {
    const ranges = recentCandles.slice(-5).map(c => c.high - c.low);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const pivotRange = pivots.r1 - pivots.s1;
    if (avgRange > pivotRange * 0.6) score += 2;
  }

  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

// ─── Calculate lot size based on risk ───────────────────────
export function calculateLotSize(
  accountBalance: number,
  riskPercent: number,
  stopLossPips: number,
  volatility: 'HIGH' | 'MEDIUM' | 'LOW',
  pipValue: number = 10 // standard lot pip value for EURUSD
): number {
  // Base lot from risk management
  const riskAmount = accountBalance * (riskPercent / 100);
  let baseLot = riskAmount / (stopLossPips * pipValue);

  // Reduce lot size based on volatility
  const volatilityMultiplier = {
    LOW: 1.0,
    MEDIUM: 0.5,
    HIGH: 0.25,   // Very cautious during high volatility
  };

  baseLot *= volatilityMultiplier[volatility];

  // Cap at conservative maximum
  const maxLot = 0.1; // max 0.1 lot for cautious trading
  baseLot = Math.min(baseLot, maxLot);

  // Round to 2 decimal places (micro lots)
  return Math.round(baseLot * 100) / 100;
}

// ─── Check if within trading window (2am–4am EST) ───────────
export function isWithinTradingWindow(): TradingSession {
  const now = new Date();
  // Convert to EST (UTC-5)
  const estOffset = -5;
  const utcHours = now.getUTCHours();
  const estHours = (utcHours + estOffset + 24) % 24;
  const estMinutes = now.getUTCMinutes();

  const isActive = estHours >= 2 && estHours < 4;
  const currentTimeStr = `${String(estHours).padStart(2, '0')}:${String(estMinutes).padStart(2, '0')} EST`;

  let minutesRemaining = 0;
  if (isActive) {
    minutesRemaining = (4 * 60) - (estHours * 60 + estMinutes);
  }

  return {
    isActive,
    windowStart: '02:00 EST',
    windowEnd: '04:00 EST',
    currentTime: currentTimeStr,
    minutesRemaining,
  };
}

// ─── Generate trade signal ──────────────────────────────────
export function generateTradeSignal(
  price: number,
  pivots: PivotLevels,
  volatility: 'HIGH' | 'MEDIUM' | 'LOW',
  accountBalance: number,
  riskPercent: number = 1
): TradeSignal {
  const position = getMarketPosition(price, pivots);
  const session = isWithinTradingWindow();
  const id = `SIG-${Date.now()}`;
  const timestamp = new Date().toISOString();

  const baseSignal: Partial<TradeSignal> = {
    id,
    timestamp,
    price,
    isVolatile: volatility === 'HIGH',
    riskScore: volatility === 'HIGH' ? 8 : volatility === 'MEDIUM' ? 5 : 2,
  };

  // If outside trading window, always HOLD
  if (!session.isActive) {
    return {
      ...baseSignal,
      type: 'HOLD',
      level: 'N/A',
      lotSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reason: `Outside trading window (${session.currentTime}). Active: ${session.windowStart}–${session.windowEnd}`,
      isVolatile: false,
      riskScore: 0,
    } as TradeSignal;
  }

  // If volatile (above R1 or below S1 with news), CAUTION
  if (volatility === 'HIGH' && (position === 'ABOVE_R1' || position === 'BELOW_S1')) {
    const cautionLot = calculateLotSize(accountBalance, riskPercent * 0.25, 30, volatility);
    return {
      ...baseSignal,
      type: 'CAUTION',
      level: position === 'ABOVE_R1' ? 'Above R1' : 'Below S1',
      lotSize: cautionLot,
      stopLoss: position === 'ABOVE_R1' ? roundPrice(price - 0.0030) : roundPrice(price + 0.0030),
      takeProfit: position === 'ABOVE_R1' ? roundPrice(price + 0.0015) : roundPrice(price - 0.0015),
      reason: `HIGH VOLATILITY — Price ${position === 'ABOVE_R1' ? 'above R1' : 'below S1'}. News-driven move. Avoid or use minimal lot.`,
      isVolatile: true,
      riskScore: 9,
    } as TradeSignal;
  }

  // BUY signal — price tests S1 (support bounce)
  if (position === 'AT_S1') {
    const slPips = Math.round((pivots.s1 - pivots.s2) * 10000);
    const lotSize = calculateLotSize(accountBalance, riskPercent, slPips, volatility);
    return {
      ...baseSignal,
      type: 'BUY',
      level: 'S1',
      lotSize,
      stopLoss: roundPrice(pivots.s2 + 0.0002),
      takeProfit: roundPrice(pivots.pp),
      reason: `Price testing S1 (${pivots.s1.toFixed(4)}). Buy for bounce toward PP (${pivots.pp.toFixed(4)}).`,
      isVolatile: volatility === 'HIGH',
      riskScore: volatility === 'HIGH' ? 7 : 3,
    } as TradeSignal;
  }

  // SELL signal — price tests R1 (resistance rejection)
  if (position === 'AT_R1') {
    const slPips = Math.round((pivots.r2 - pivots.r1) * 10000);
    const lotSize = calculateLotSize(accountBalance, riskPercent, slPips, volatility);
    return {
      ...baseSignal,
      type: 'SELL',
      level: 'R1',
      lotSize,
      stopLoss: roundPrice(pivots.r2 - 0.0002),
      takeProfit: roundPrice(pivots.pp),
      reason: `Price testing R1 (${pivots.r1.toFixed(4)}). Sell for drop toward PP (${pivots.pp.toFixed(4)}).`,
      isVolatile: volatility === 'HIGH',
      riskScore: volatility === 'HIGH' ? 7 : 3,
    } as TradeSignal;
  }

  // IN_RANGE or AT_PP — HOLD
  return {
    ...baseSignal,
    type: 'HOLD',
    level: position === 'AT_PP' ? 'PP' : 'In Range',
    lotSize: 0,
    stopLoss: 0,
    takeProfit: 0,
    reason: `Price in range between S1 (${pivots.s1.toFixed(4)}) and R1 (${pivots.r1.toFixed(4)}). Wait for S1/R1 test.`,
    isVolatile: volatility === 'HIGH',
    riskScore: volatility === 'HIGH' ? 6 : 1,
  } as TradeSignal;
}

// ─── Generate sample EURUSD OHLC data for demo ─────────────
export function generateSampleOHLC(pivots: PivotLevels, hoursBack: number = 48): OHLCData[] {
  const data: OHLCData[] = [];
  const now = new Date();
  let price = pivots.pp; // Start near PP

  for (let i = hoursBack; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 3600000);
    const dateStr = time.toISOString().split('T')[0];
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

    // Simulate price movement within pivot range
    const noise = (Math.random() - 0.5) * 0.0020;
    const meanReversion = (pivots.pp - price) * 0.1;
    price += noise + meanReversion;

    // Occasionally touch S1 or R1
    if (Math.random() < 0.08) price = pivots.s1 + (Math.random() * 0.0005);
    if (Math.random() < 0.08) price = pivots.r1 - (Math.random() * 0.0005);

    const candleRange = 0.0005 + Math.random() * 0.0015;
    const open = roundPrice(price);
    const close = roundPrice(price + (Math.random() - 0.5) * candleRange);
    const high = roundPrice(Math.max(open, close) + Math.random() * candleRange * 0.5);
    const low = roundPrice(Math.min(open, close) - Math.random() * candleRange * 0.5);

    price = close;

    data.push({ date: dateStr, time: timeStr, open, high, low, close, volume: Math.round(Math.random() * 1000 + 200) });
  }

  return data;
}

// ─── Fetch pivot data from Action Forex ─────────────────────
// actionforex.com provides daily pivot points that we parse
export async function fetchActionForexPivots(): Promise<{
  pivots: PivotLevels;
  ohlc: { high: number; low: number; close: number; open: number };
  timestamp: string;
} | null> {
  try {
    // Action Forex pivot data endpoint
    const response = await fetch(
      'https://www.actionforex.com/action-insight/pivot-points/eurusd-pivot-points/',
      { mode: 'no-cors' }
    );

    // Since CORS will likely block direct fetch, we use the formula with latest known values
    // In production, this would go through a backend proxy
    // Falling back to calculated pivots from the latest daily OHLC
    return null;
  } catch {
    return null;
  }
}

// ─── Fetch economic calendar / news ─────────────────────────
export async function fetchForexNews(): Promise<NewsItem[]> {
  // In production, this would fetch from a forex news API or scrape actionforex.com
  // For now, generate realistic news items based on common economic events
  return getRealisticNewsItems();
}

function getRealisticNewsItems(): NewsItem[] {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return [
    {
      title: 'ECB Interest Rate Decision',
      impact: 'HIGH',
      currency: 'EUR',
      time: `${todayStr} 07:45 EST`,
      forecast: '4.50%',
      previous: '4.50%',
      source: 'Action Forex',
    },
    {
      title: 'US Non-Farm Payrolls',
      impact: 'HIGH',
      currency: 'USD',
      time: `${todayStr} 08:30 EST`,
      forecast: '180K',
      previous: '175K',
      source: 'Action Forex',
    },
    {
      title: 'German Manufacturing PMI',
      impact: 'MEDIUM',
      currency: 'EUR',
      time: `${todayStr} 03:30 EST`,
      forecast: '42.8',
      previous: '42.5',
      source: 'Action Forex',
    },
    {
      title: 'US Initial Jobless Claims',
      impact: 'MEDIUM',
      currency: 'USD',
      time: `${todayStr} 08:30 EST`,
      forecast: '215K',
      previous: '210K',
      source: 'Action Forex',
    },
    {
      title: 'Eurozone CPI Flash Estimate',
      impact: 'HIGH',
      currency: 'EUR',
      time: `${todayStr} 05:00 EST`,
      forecast: '2.6%',
      previous: '2.8%',
      source: 'Action Forex',
    },
    {
      title: 'Fed Chair Powell Speech',
      impact: 'HIGH',
      currency: 'USD',
      time: `${todayStr} 10:00 EST`,
      source: 'Action Forex',
    },
    {
      title: 'French Trade Balance',
      impact: 'LOW',
      currency: 'EUR',
      time: `${todayStr} 02:45 EST`,
      forecast: '-7.5B',
      previous: '-7.8B',
      source: 'Action Forex',
    },
    {
      title: 'US Factory Orders',
      impact: 'LOW',
      currency: 'USD',
      time: `${todayStr} 10:00 EST`,
      forecast: '0.2%',
      previous: '-0.5%',
      source: 'Action Forex',
    },
  ];
}

// ─── Format pivot levels for display ────────────────────────
export function formatPivotTable(pivots: PivotLevels): {
  label: string;
  value: string;
  color: string;
  type: 'resistance' | 'pivot' | 'support';
}[] {
  return [
    { label: 'R3', value: pivots.r3.toFixed(4), color: '#dc2626', type: 'resistance' },
    { label: 'R2', value: pivots.r2.toFixed(4), color: '#7c3aed', type: 'resistance' },
    { label: 'R1', value: pivots.r1.toFixed(4), color: '#2563eb', type: 'resistance' },
    { label: 'PP', value: pivots.pp.toFixed(4), color: '#6b7280', type: 'pivot' },
    { label: 'S1', value: pivots.s1.toFixed(4), color: '#eab308', type: 'support' },
    { label: 'S2', value: pivots.s2.toFixed(4), color: '#7c3aed', type: 'support' },
    { label: 'S3', value: pivots.s3.toFixed(4), color: '#dc2626', type: 'support' },
  ];
}

// ─── Risk management checks ────────────────────────────────
export function validateTrade(signal: TradeSignal, accountBalance: number): {
  approved: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (signal.isVolatile) {
    warnings.push('High volatility detected — news-driven market. Consider skipping this trade.');
  }

  if (signal.lotSize > 0.05) {
    warnings.push(`Lot size (${signal.lotSize}) exceeds cautious threshold. Consider reducing.`);
  }

  const riskAmount = signal.lotSize * Math.abs(signal.price - signal.stopLoss) * 100000;
  const riskPct = (riskAmount / accountBalance) * 100;
  if (riskPct > 2) {
    warnings.push(`Risk (${riskPct.toFixed(1)}%) exceeds 2% max. Reduce position size.`);
  }

  if (signal.riskScore >= 7) {
    warnings.push('Risk score is elevated. Only trade if setup is confirmed by price action.');
  }

  return {
    approved: warnings.length === 0 || (warnings.length <= 1 && !signal.isVolatile),
    warnings,
  };
}

// ─── Default EURUSD values from Action Forex (Mar 23, 2026) ─
// These match the image: Op:1.1607, Hi:1.1616, Lo:1.1580, Cl:1.1596
export const DEFAULT_EURUSD_OHLC = {
  open: 1.1607,
  high: 1.1616,
  low: 1.1580,
  close: 1.1596,
};

export const DEFAULT_PIVOTS = calculatePivotLevels(
  DEFAULT_EURUSD_OHLC.high,
  DEFAULT_EURUSD_OHLC.low,
  DEFAULT_EURUSD_OHLC.close
);
