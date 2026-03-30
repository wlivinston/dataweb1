import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, Legend, Area,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  calculatePivotLevels, calculateFibonacciPivots,
  generateTradeSignal, assessVolatility, getMarketPosition,
  isWithinTradingWindow, calculateLotSize, validateTrade,
  generateSampleOHLC, formatPivotTable, fetchForexNews,
  DEFAULT_EURUSD_OHLC, DEFAULT_PIVOTS,
  type OHLCData, type PivotLevels, type TradeSignal, type NewsItem,
  type TradingSession, type MarketState,
} from '@/lib/pivotTradingEngine';

// ─── Candlestick custom shape for Recharts ──────────────────
const CandlestickShape = (props: any) => {
  const { x, y, width, payload } = props;
  if (!payload || !payload.open || !payload.close) return null;

  const { open, close, high, low, yScale } = payload;
  if (!yScale) return null;

  const isBullish = close >= open;
  const color = isBullish ? '#22c55e' : '#ef4444';
  const bodyTop = yScale(Math.max(open, close));
  const bodyBottom = yScale(Math.min(open, close));
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
  const wickX = x + width / 2;

  return (
    <g>
      {/* Upper wick */}
      <line
        x1={wickX} y1={yScale(high)}
        x2={wickX} y2={bodyTop}
        stroke={color} strokeWidth={1.5}
      />
      {/* Lower wick */}
      <line
        x1={wickX} y1={bodyBottom}
        x2={wickX} y2={yScale(low)}
        stroke={color} strokeWidth={1.5}
      />
      {/* Body */}
      <rect
        x={x + 1} y={bodyTop}
        width={Math.max(width - 2, 3)} height={bodyHeight}
        fill={isBullish ? color : color}
        stroke={color} strokeWidth={1}
      />
    </g>
  );
};

// ─── Main Dashboard ─────────────────────────────────────────
const PivotTradingDashboard: React.FC = () => {
  // State
  const [ohlcInput, setOhlcInput] = useState(DEFAULT_EURUSD_OHLC);
  const [pivotFormula, setPivotFormula] = useState<'classic' | 'fibonacci'>('classic');
  const [accountBalance, setAccountBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [session, setSession] = useState<TradingSession>(isWithinTradingWindow());
  const [simulatedPrice, setSimulatedPrice] = useState(DEFAULT_EURUSD_OHLC.close);
  const [isLive, setIsLive] = useState(false);
  const [activeTab, setActiveTab] = useState<'chart' | 'signals' | 'news' | 'settings'>('chart');

  // Calculate pivots from OHLC input
  const pivots = useMemo<PivotLevels>(() => {
    if (pivotFormula === 'fibonacci') {
      return calculateFibonacciPivots(ohlcInput.high, ohlcInput.low, ohlcInput.close);
    }
    return calculatePivotLevels(ohlcInput.high, ohlcInput.low, ohlcInput.close);
  }, [ohlcInput, pivotFormula]);

  // Generate chart data
  const chartData = useMemo(() => {
    const ohlc = generateSampleOHLC(pivots, 72);
    return ohlc.map(candle => ({
      ...candle,
      label: `${candle.date.slice(5)} ${candle.time}`,
      // For the candlestick rendering
      candleOpen: candle.open,
      candleClose: candle.close,
      candleHigh: candle.high,
      candleLow: candle.low,
      // Bar range for visual candlestick
      barBase: Math.min(candle.open, candle.close),
      barTop: Math.max(candle.open, candle.close),
      barHeight: Math.abs(candle.close - candle.open),
      isBullish: candle.close >= candle.open,
    }));
  }, [pivots]);

  // Market state
  const marketState = useMemo<MarketState>(() => {
    const position = getMarketPosition(simulatedPrice, pivots);
    const volatility = assessVolatility(simulatedPrice, pivots, newsItems, chartData);
    return {
      currentPrice: simulatedPrice,
      pivots,
      position,
      volatility,
      spread: 0.00012,
      session,
    };
  }, [simulatedPrice, pivots, newsItems, chartData, session]);

  // Load news on mount
  useEffect(() => {
    fetchForexNews().then(setNewsItems);
  }, []);

  // Update session clock every second
  useEffect(() => {
    const interval = setInterval(() => {
      setSession(isWithinTradingWindow());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live price simulation
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setSimulatedPrice(prev => {
        const noise = (Math.random() - 0.5) * 0.0008;
        const meanRevert = (pivots.pp - prev) * 0.02;
        // Occasionally touch S1 or R1
        if (Math.random() < 0.03) return pivots.s1 + 0.0001;
        if (Math.random() < 0.03) return pivots.r1 - 0.0001;
        return Math.round((prev + noise + meanRevert) * 100000) / 100000;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [isLive, pivots]);

  // Generate signal when price changes
  const generateSignal = useCallback(() => {
    const signal = generateTradeSignal(simulatedPrice, pivots, marketState.volatility, accountBalance, riskPercent);
    setSignals(prev => [signal, ...prev.slice(0, 49)]);
  }, [simulatedPrice, pivots, marketState.volatility, accountBalance, riskPercent]);

  // Auto-generate signals in live mode
  useEffect(() => {
    if (isLive) generateSignal();
  }, [simulatedPrice, isLive, generateSignal]);

  const latestSignal = signals[0] || null;
  const pivotTable = formatPivotTable(pivots);

  // Chart Y domain
  const yMin = pivots.s3 - 0.0010;
  const yMax = pivots.r3 + 0.0010;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            EURUSD Pivot Point Trading
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Action Forex Formula — Buy at S1, Sell at R1 — Trading Window: 2am–4am EST
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SessionBadge session={session} />
          <VolatilityBadge volatility={marketState.volatility} />
          <Button
            size="sm"
            variant={isLive ? 'destructive' : 'default'}
            onClick={() => setIsLive(!isLive)}
            className={!isLive ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {isLive ? 'Stop Simulation' : 'Start Live Simulation'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['chart', 'signals', 'news', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Current Price + Position */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Current Price" value={simulatedPrice.toFixed(5)} highlight />
        <MetricCard label="Position" value={marketState.position.replace(/_/g, ' ')} />
        <MetricCard label="Pivot Point (PP)" value={pivots.pp.toFixed(4)} />
        <MetricCard label="Spread" value={`${(marketState.spread * 10000).toFixed(1)} pips`} />
      </div>

      {activeTab === 'chart' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Main Chart */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">EURUSD H1 Chart with Daily Pivots</CardTitle>
              <p className="text-xs text-gray-500">
                Source: Action Forex (actionforex.com) — {pivotFormula === 'classic' ? 'Classic' : 'Fibonacci'} Formula
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => v.toFixed(4)}
                    width={70}
                  />
                  <Tooltip content={<CandlestickTooltip pivots={pivots} />} />

                  {/* Candlestick bodies as bars */}
                  <Bar dataKey="barTop" barSize={6} shape={(props: any) => {
                    const d = props.payload;
                    if (!d) return null;
                    const isBull = d.close >= d.open;
                    const color = isBull ? '#22c55e' : '#ef4444';
                    const yTop = props.y;
                    const bodyH = Math.max(Math.abs(d.close - d.open) / (yMax - yMin) * 500, 1);
                    return (
                      <g>
                        {/* Wick */}
                        <line
                          x1={props.x + props.width / 2}
                          y1={props.y - (d.high - Math.max(d.open, d.close)) / (yMax - yMin) * 500}
                          x2={props.x + props.width / 2}
                          y2={props.y + bodyH + (Math.min(d.open, d.close) - d.low) / (yMax - yMin) * 500}
                          stroke={color}
                          strokeWidth={1}
                        />
                        {/* Body */}
                        <rect
                          x={props.x}
                          y={yTop}
                          width={props.width}
                          height={bodyH}
                          fill={color}
                          stroke={color}
                        />
                      </g>
                    );
                  }} />

                  {/* Pivot Lines — HIGHLY VISIBLE */}
                  <ReferenceLine y={pivots.r3} stroke="#dc2626" strokeWidth={2} strokeDasharray="4 4"
                    label={{ value: `R3: ${pivots.r3.toFixed(4)}`, position: 'right', fill: '#dc2626', fontSize: 11, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.r2} stroke="#7c3aed" strokeWidth={2} strokeDasharray="4 4"
                    label={{ value: `R2: ${pivots.r2.toFixed(4)}`, position: 'right', fill: '#7c3aed', fontSize: 11, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.r1} stroke="#2563eb" strokeWidth={2.5}
                    label={{ value: `R1: ${pivots.r1.toFixed(4)}`, position: 'right', fill: '#2563eb', fontSize: 12, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.pp} stroke="#6b7280" strokeWidth={3}
                    label={{ value: `PP: ${pivots.pp.toFixed(4)}`, position: 'right', fill: '#6b7280', fontSize: 12, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.s1} stroke="#eab308" strokeWidth={2.5}
                    label={{ value: `S1: ${pivots.s1.toFixed(4)}`, position: 'right', fill: '#eab308', fontSize: 12, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.s2} stroke="#7c3aed" strokeWidth={2} strokeDasharray="4 4"
                    label={{ value: `S2: ${pivots.s2.toFixed(4)}`, position: 'right', fill: '#7c3aed', fontSize: 11, fontWeight: 'bold' }} />
                  <ReferenceLine y={pivots.s3} stroke="#dc2626" strokeWidth={2} strokeDasharray="4 4"
                    label={{ value: `S3: ${pivots.s3.toFixed(4)}`, position: 'right', fill: '#dc2626', fontSize: 11, fontWeight: 'bold' }} />

                  {/* Trade Zone Highlight (S1 to R1) */}
                  <Area
                    dataKey={() => pivots.r1}
                    stroke="none"
                    fill="#22c55e"
                    fillOpacity={0.04}
                    baseValue={pivots.s1}
                  />

                  {/* Current Price Line */}
                  <ReferenceLine y={simulatedPrice} stroke="#f97316" strokeWidth={2} strokeDasharray="8 4"
                    label={{ value: `Price: ${simulatedPrice.toFixed(5)}`, position: 'left', fill: '#f97316', fontSize: 11, fontWeight: 'bold' }} />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Chart Legend */}
              <div className="flex flex-wrap gap-3 mt-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-gray-500 inline-block" style={{ height: 3 }}></span> PP (Grey)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" style={{ height: 3 }}></span> R1 (Blue)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-yellow-500 inline-block" style={{ height: 3 }}></span> S1 (Yellow)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-purple-600 inline-block" style={{ height: 3 }}></span> R2/S2 (Purple)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-red-600 inline-block" style={{ height: 3 }}></span> R3/S3 (Red)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-orange-500 inline-block" style={{ height: 3 }}></span> Current Price</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 inline-block"></span> Bullish</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 inline-block"></span> Bearish</span>
              </div>
            </CardContent>
          </Card>

          {/* Pivot Meter + Signal Panel */}
          <div className="space-y-4">
            {/* Pivot Levels Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pivot Levels</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {pivotTable.map(level => (
                  <div
                    key={level.label}
                    className={`flex justify-between items-center px-2 py-1.5 rounded text-sm ${
                      level.label === 'PP' ? 'bg-gray-100 font-bold' :
                      level.type === 'resistance' ? 'bg-red-50' : 'bg-green-50'
                    }`}
                  >
                    <span style={{ color: level.color }} className="font-semibold">{level.label}</span>
                    <span className="font-mono">{level.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Pivot Meter Visualization */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pivot Meter</CardTitle>
              </CardHeader>
              <CardContent>
                <PivotMeter pivots={pivots} currentPrice={simulatedPrice} />
              </CardContent>
            </Card>

            {/* Latest Signal */}
            {latestSignal && (
              <Card className={`border-2 ${
                latestSignal.type === 'BUY' ? 'border-green-500' :
                latestSignal.type === 'SELL' ? 'border-red-500' :
                latestSignal.type === 'CAUTION' ? 'border-orange-500' :
                'border-gray-300'
              }`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Latest Signal</CardTitle>
                </CardHeader>
                <CardContent>
                  <SignalCard signal={latestSignal} accountBalance={accountBalance} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {activeTab === 'signals' && (
        <Card>
          <CardHeader>
            <CardTitle>Trade Signals History</CardTitle>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={generateSignal} className="bg-green-600 hover:bg-green-700">
                Generate Signal Now
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {signals.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No signals yet. Start the simulation or click "Generate Signal Now".</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {signals.map((sig, i) => (
                  <div key={sig.id} className={`p-3 rounded-lg border ${
                    sig.type === 'BUY' ? 'bg-green-50 border-green-200' :
                    sig.type === 'SELL' ? 'bg-red-50 border-red-200' :
                    sig.type === 'CAUTION' ? 'bg-orange-50 border-orange-200' :
                    'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          sig.type === 'BUY' ? 'default' :
                          sig.type === 'SELL' ? 'destructive' :
                          'secondary'
                        } className={sig.type === 'BUY' ? 'bg-green-600' : sig.type === 'CAUTION' ? 'bg-orange-500' : ''}>
                          {sig.type}
                        </Badge>
                        <span className="text-sm font-mono">{sig.price.toFixed(5)}</span>
                        <span className="text-xs text-gray-500">@ {sig.level}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(sig.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{sig.reason}</p>
                    {sig.lotSize > 0 && (
                      <div className="flex gap-4 mt-1 text-xs">
                        <span>Lot: <strong>{sig.lotSize}</strong></span>
                        <span>SL: <strong>{sig.stopLoss.toFixed(4)}</strong></span>
                        <span>TP: <strong>{sig.takeProfit.toFixed(4)}</strong></span>
                        <span>Risk: <strong>{sig.riskScore}/10</strong></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'news' && (
        <Card>
          <CardHeader>
            <CardTitle>Economic Calendar — EUR/USD Impact</CardTitle>
            <p className="text-xs text-gray-500">Source: Action Forex (actionforex.com)</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {newsItems.map((news, i) => (
                <div key={i} className={`p-3 rounded-lg border flex items-start gap-3 ${
                  news.impact === 'HIGH' ? 'bg-red-50 border-red-200' :
                  news.impact === 'MEDIUM' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <Badge variant={
                    news.impact === 'HIGH' ? 'destructive' :
                    news.impact === 'MEDIUM' ? 'default' : 'secondary'
                  } className={`text-xs shrink-0 ${news.impact === 'MEDIUM' ? 'bg-yellow-500' : ''}`}>
                    {news.impact}
                  </Badge>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{news.title}</span>
                      <Badge variant="outline" className="text-xs">{news.currency}</Badge>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>{news.time}</span>
                      {news.forecast && <span>Forecast: {news.forecast}</span>}
                      {news.previous && <span>Prev: {news.previous}</span>}
                      {news.actual && <span className="font-bold">Actual: {news.actual}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Source: {news.source}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm font-medium text-blue-800">Trading Rule:</p>
              <p className="text-xs text-blue-700 mt-1">
                When HIGH impact news is scheduled for EUR or USD, the market may break above R1 or below S1.
                During such volatility, either <strong>do not trade</strong> or use <strong>very low lot sizes</strong> (0.01–0.02 max).
                Wait for the news to pass and price to return to the S1–R1 range before resuming normal trading.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* OHLC Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Previous Day OHLC (Action Forex)</CardTitle>
              <p className="text-xs text-gray-500">
                Enter yesterday's EURUSD values from actionforex.com to calculate today's pivots
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Open</Label>
                  <Input
                    type="number" step="0.0001"
                    value={ohlcInput.open}
                    onChange={e => setOhlcInput(prev => ({ ...prev, open: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">High</Label>
                  <Input
                    type="number" step="0.0001"
                    value={ohlcInput.high}
                    onChange={e => setOhlcInput(prev => ({ ...prev, high: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Low</Label>
                  <Input
                    type="number" step="0.0001"
                    value={ohlcInput.low}
                    onChange={e => setOhlcInput(prev => ({ ...prev, low: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Close</Label>
                  <Input
                    type="number" step="0.0001"
                    value={ohlcInput.close}
                    onChange={e => setOhlcInput(prev => ({ ...prev, close: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Pivot Formula</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    variant={pivotFormula === 'classic' ? 'default' : 'outline'}
                    onClick={() => setPivotFormula('classic')}
                    className={pivotFormula === 'classic' ? 'bg-green-600' : ''}
                  >
                    Classic (Action Forex)
                  </Button>
                  <Button
                    size="sm"
                    variant={pivotFormula === 'fibonacci' ? 'default' : 'outline'}
                    onClick={() => setPivotFormula('fibonacci')}
                    className={pivotFormula === 'fibonacci' ? 'bg-green-600' : ''}
                  >
                    Fibonacci
                  </Button>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setOhlcInput(DEFAULT_EURUSD_OHLC)}
              >
                Reset to Default (Mar 23 Data)
              </Button>
            </CardContent>
          </Card>

          {/* Risk Management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Risk Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Account Balance (USD)</Label>
                <Input
                  type="number"
                  value={accountBalance}
                  onChange={e => setAccountBalance(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label className="text-xs">Risk per Trade (%)</Label>
                <Input
                  type="number" step="0.1" min="0.1" max="3"
                  value={riskPercent}
                  onChange={e => setRiskPercent(parseFloat(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label className="text-xs">Simulated Price (for testing)</Label>
                <Input
                  type="number" step="0.0001"
                  value={simulatedPrice}
                  onChange={e => setSimulatedPrice(parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* Calculated lot sizes */}
              <div className="bg-gray-50 p-3 rounded-lg text-xs space-y-1">
                <p className="font-semibold text-sm mb-2">Calculated Lot Sizes:</p>
                <p>Low Volatility: <strong>{calculateLotSize(accountBalance, riskPercent, 20, 'LOW').toFixed(2)}</strong></p>
                <p>Medium Volatility: <strong>{calculateLotSize(accountBalance, riskPercent, 20, 'MEDIUM').toFixed(2)}</strong></p>
                <p>High Volatility: <strong>{calculateLotSize(accountBalance, riskPercent, 20, 'HIGH').toFixed(2)}</strong></p>
              </div>
            </CardContent>
          </Card>

          {/* Strategy Rules */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Strategy Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <h3 className="font-semibold text-green-700">Entry Rules</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li><strong>BUY</strong> when price tests S1 (support bounce)</li>
                    <li><strong>SELL</strong> when price tests R1 (resistance rejection)</li>
                    <li>Trade only between <strong>2:00 AM – 4:00 AM EST</strong></li>
                    <li>Use <strong>Action Forex Classic formula</strong> for pivot calculation</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-red-700">Risk Rules</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>Max risk: <strong>1-2% per trade</strong></li>
                    <li>Max lot size: <strong>0.10</strong> (cautious)</li>
                    <li>If price breaks R1/S1 with news → <strong>DO NOT TRADE</strong></li>
                    <li>High volatility → reduce lot to <strong>0.01-0.02</strong></li>
                    <li>Stop Loss at S2 (for buys) or R2 (for sells)</li>
                    <li>Take Profit at PP (middle of range)</li>
                  </ul>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <h3 className="font-semibold text-blue-700">Action Forex Classic Pivot Formula</h3>
                  <div className="bg-blue-50 p-3 rounded-lg font-mono text-xs space-y-1">
                    <p>PP = (High + Low + Close) / 3</p>
                    <p>R1 = (2 × PP) - Low &nbsp;&nbsp;&nbsp; S1 = (2 × PP) - High</p>
                    <p>R2 = PP + (High - Low) &nbsp;&nbsp;&nbsp; S2 = PP - (High - Low)</p>
                    <p>R3 = High + 2 × (PP - Low) &nbsp;&nbsp;&nbsp; S3 = Low - 2 × (PP - High)</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────

const MetricCard: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <Card className={highlight ? 'border-green-500 border-2' : ''}>
    <CardContent className="p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-mono font-bold ${highlight ? 'text-lg text-green-700' : 'text-sm'}`}>{value}</p>
    </CardContent>
  </Card>
);

const SessionBadge: React.FC<{ session: TradingSession }> = ({ session }) => (
  <Badge variant={session.isActive ? 'default' : 'secondary'}
    className={session.isActive ? 'bg-green-600 animate-pulse' : ''}>
    {session.isActive
      ? `LIVE ${session.currentTime} (${session.minutesRemaining}m left)`
      : `${session.currentTime} — Window: 2am–4am EST`
    }
  </Badge>
);

const VolatilityBadge: React.FC<{ volatility: 'HIGH' | 'MEDIUM' | 'LOW' }> = ({ volatility }) => (
  <Badge variant={volatility === 'HIGH' ? 'destructive' : volatility === 'MEDIUM' ? 'default' : 'secondary'}
    className={volatility === 'MEDIUM' ? 'bg-yellow-500' : ''}>
    {volatility} VOL
  </Badge>
);

const SignalCard: React.FC<{ signal: TradeSignal; accountBalance: number }> = ({ signal, accountBalance }) => {
  const validation = validateTrade(signal, accountBalance);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge className={`text-lg px-3 py-1 ${
          signal.type === 'BUY' ? 'bg-green-600' :
          signal.type === 'SELL' ? 'bg-red-600' :
          signal.type === 'CAUTION' ? 'bg-orange-500' :
          'bg-gray-500'
        }`}>
          {signal.type}
        </Badge>
        <span className="text-sm font-mono">{signal.price.toFixed(5)}</span>
      </div>
      <p className="text-xs text-gray-600">{signal.reason}</p>
      {signal.lotSize > 0 && (
        <div className="text-xs space-y-0.5">
          <p>Lot: <strong>{signal.lotSize}</strong></p>
          <p>SL: <strong>{signal.stopLoss.toFixed(4)}</strong> | TP: <strong>{signal.takeProfit.toFixed(4)}</strong></p>
          <p>Risk Score: <strong>{signal.riskScore}/10</strong></p>
        </div>
      )}
      {validation.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs space-y-0.5">
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-yellow-800">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
};

const PivotMeter: React.FC<{ pivots: PivotLevels; currentPrice: number }> = ({ pivots, currentPrice }) => {
  const levels = [pivots.s3, pivots.s2, pivots.s1, pivots.pp, pivots.r1, pivots.r2, pivots.r3];
  const labels = ['S3', 'S2', 'S1', 'PP', 'R1', 'R2', 'R3'];
  const colors = ['#dc2626', '#7c3aed', '#eab308', '#6b7280', '#2563eb', '#7c3aed', '#dc2626'];

  const minLevel = levels[0];
  const maxLevel = levels[levels.length - 1];
  const range = maxLevel - minLevel;
  const pricePosition = Math.max(0, Math.min(100, ((currentPrice - minLevel) / range) * 100));

  return (
    <div className="space-y-2">
      {/* Bar visualization */}
      <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden">
        {levels.map((level, i) => {
          const pos = ((level - minLevel) / range) * 100;
          return (
            <div
              key={labels[i]}
              className="absolute top-0 bottom-0 w-0.5"
              style={{ left: `${pos}%`, backgroundColor: colors[i] }}
            />
          );
        })}
        {/* Price indicator */}
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-orange-500 rounded"
          style={{ left: `${pricePosition}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      {/* Labels */}
      <div className="relative h-4 text-xs">
        {levels.map((level, i) => {
          const pos = ((level - minLevel) / range) * 100;
          return (
            <span
              key={labels[i]}
              className="absolute font-bold"
              style={{
                left: `${pos}%`,
                transform: 'translateX(-50%)',
                color: colors[i],
                fontSize: '9px',
              }}
            >
              {labels[i]}
            </span>
          );
        })}
      </div>
      <p className="text-center text-xs text-gray-500">
        Price at <strong className="text-orange-600">{pricePosition.toFixed(0)}%</strong> of pivot range
      </p>
    </div>
  );
};

const CandlestickTooltip: React.FC<{ active?: boolean; payload?: any[]; label?: string; pivots: PivotLevels }> = ({
  active, payload, label, pivots,
}) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold mb-1">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>Open:</span><span className="font-mono">{d.open?.toFixed(5)}</span>
        <span>High:</span><span className="font-mono">{d.high?.toFixed(5)}</span>
        <span>Low:</span><span className="font-mono">{d.low?.toFixed(5)}</span>
        <span>Close:</span><span className="font-mono">{d.close?.toFixed(5)}</span>
      </div>
      <hr className="my-1" />
      <div className="text-gray-500">
        <p>PP: {pivots.pp.toFixed(4)} | R1: {pivots.r1.toFixed(4)} | S1: {pivots.s1.toFixed(4)}</p>
      </div>
    </div>
  );
};

export default PivotTradingDashboard;
