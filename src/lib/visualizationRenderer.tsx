// Shared visualization renderer component
import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Treemap as RechartsTreemap,
  FunnelChart, Funnel, LabelList,
  ComposedChart,
  RadialBarChart, RadialBar,
} from 'recharts';
import { Visualization } from './types';
import { Table } from '@/components/ui/table';
import { optimizeVisualizationData, RENDERING_LIMITS } from './dataOptimization';
import PaginatedTable from '@/components/PaginatedTable';
import { SHARED_CHART_PALETTE } from './chartColors';

export type SupportedVisualizationType =
  | 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'table'
  | 'radar' | 'treemap' | 'histogram' | 'boxplot' | 'heatmap'
  | 'funnel' | 'composed' | 'radialbar' | 'waterfall' | 'stacked_bar' | 'donut'
  | 'pareto' | 'pct_stacked_bar' | 'bubble' | 'dual_axis';

const getFirstNumericValue = (entry: Record<string, any>): number => {
  const numericKey = Object.keys(entry).find(key => typeof entry[key] === 'number' && Number.isFinite(entry[key]));
  if (!numericKey) return 0;
  return Number(entry[numericKey]) || 0;
};

const toCategoryValueData = (data: any[]): { category: string; value: number }[] => {
  return data.map((entry, index) => {
    if (entry && typeof entry === 'object') {
      const categoryRaw = entry.category ?? entry.name ?? entry.label ?? entry.x ?? entry.date ?? entry.month ?? `Item ${index + 1}`;
      const valueRaw = entry.value ?? entry.y ?? entry.amount ?? entry.total ?? entry.count ?? getFirstNumericValue(entry);
      const normalizedEntry: Record<string, any> = {
        category: String(categoryRaw),
        value: Number(valueRaw) || 0,
      };

      // Preserve extra numeric series so line/area charts can use full palettes.
      Object.entries(entry).forEach(([key, value]) => {
        if (key === 'category') return;
        if (typeof value === 'number' && Number.isFinite(value) && !(key in normalizedEntry)) {
          normalizedEntry[key] = Number(value) || 0;
        }
      });

      return normalizedEntry as { category: string; value: number };
    }
    return {
      category: `Item ${index + 1}`,
      value: Number(entry) || 0,
    };
  });
};

const toScatterData = (data: any[]): { x: number; y: number; name?: string }[] => {
  return data
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      if (typeof entry.x === 'number' && typeof entry.y === 'number') {
        return {
          x: entry.x,
          y: entry.y,
          name: String(entry.name ?? entry.category ?? `Point ${index + 1}`),
        };
      }

      const numericKeys = Object.keys(entry).filter(key => typeof entry[key] === 'number' && Number.isFinite(entry[key]));
      if (numericKeys.length >= 2) {
        return {
          x: Number(entry[numericKeys[0]]) || 0,
          y: Number(entry[numericKeys[1]]) || 0,
          name: String(entry.name ?? entry.category ?? `Point ${index + 1}`),
        };
      }

      return null;
    })
    .filter((point): point is { x: number; y: number; name: string } => point !== null);
};

const getPalette = (viz: Visualization): string[] => {
  if (Array.isArray(viz.colors) && viz.colors.length > 0) {
    return viz.colors;
  }
  return SHARED_CHART_PALETTE;
};

const getStableColorStart = (viz: Visualization, paletteLength: number): number => {
  if (paletteLength <= 0) return 0;
  const seed = `${viz.id}-${viz.title}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) % paletteLength;
};

const getSeriesKeys = (data: Record<string, any>[]): string[] => {
  if (!Array.isArray(data) || data.length === 0) return ['value'];

  const excluded = new Set(['category', 'name', 'label', 'x', 'y']);
  const keys = Object.keys(data[0]).filter((key) => {
    if (excluded.has(key)) return false;
    return data.some((row) => typeof row[key] === 'number' && Number.isFinite(row[key]));
  });

  if (keys.length === 0) return ['value'];

  keys.sort((a, b) => {
    if (a === 'value') return -1;
    if (b === 'value') return 1;
    return a.localeCompare(b);
  });

  return keys;
};

export const renderVisualization = (viz: Visualization, overrideType?: SupportedVisualizationType) => {
  const mappedType: SupportedVisualizationType =
    viz.type === 'gauge' ? 'bar' : (viz.type as SupportedVisualizationType);
  const effectiveType: SupportedVisualizationType = overrideType ?? mappedType;

  if (effectiveType === 'table') {
    const data = viz.data as any[];
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    
    // Use paginated table for large datasets
    if (data.length > 100) {
      return (
        <PaginatedTable
          data={data}
          columns={columns}
          pageSize={100}
          maxRows={RENDERING_LIMITS.MAX_TABLE_ROWS}
        />
      );
    }
    
    // For small datasets, show simple table
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead>
            <tr className="bg-gray-50">
              {columns.map(col => (
                <th key={col} className="border border-gray-300 px-2 py-1 text-left font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 100).map((row, index) => (
              <tr key={index} className="hover:bg-gray-50">
                {columns.map(col => (
                  <td key={col} className="border border-gray-300 px-2 py-1">
                    {typeof row[col] === 'number'
                      ? row[col].toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : String(row[col] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 100 && (
          <p className="text-xs text-gray-500 mt-1">
            Showing 100 of {data.length.toLocaleString()} rows. Use pagination for full dataset.
          </p>
        )}
      </div>
    );
  }
  
  // Optimize chart data to prevent rendering crashes
  const rawData = Array.isArray(viz.data) ? viz.data : [];
  // Types that pass data through as-is (complex data shapes)
  const passthroughTypes = new Set<SupportedVisualizationType>([
    'heatmap', 'boxplot', 'waterfall', 'radar', 'stacked_bar', 'composed',
    'pareto', 'pct_stacked_bar', 'dual_axis',
  ]);
  const normalizedData = effectiveType === 'scatter'
    ? toScatterData(rawData)
    : effectiveType === 'bubble'
      ? rawData
      : passthroughTypes.has(effectiveType)
        ? rawData
        : toCategoryValueData(rawData);
  const chartData = optimizeVisualizationData(
    normalizedData,
    effectiveType === 'scatter' ? 'scatter' : effectiveType
  );
  const palette = getPalette(viz);
  const baseColorIndex = getStableColorStart(viz, palette.length);
  const getColor = (offset: number): string =>
    palette[(baseColorIndex + offset) % palette.length];
  
  // Show warning if data was sampled
  const wasSampled = normalizedData.length > chartData.length;
  
  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <p className="text-xs">No chart data available</p>
      </div>
    );
  }
  
  if (effectiveType === 'bar') {
    return (
      <div className="space-y-2 h-full">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="category" 
              tick={{ fontSize: 10 }} 
              angle={chartData.length > 20 ? -45 : 0}
              textAnchor={chartData.length > 20 ? 'end' : 'middle'}
              height={chartData.length > 20 ? 80 : 30}
            />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value">
              {chartData.map((_, index) => (
                <Cell key={`bar-cell-${index}`} fill={getColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (effectiveType === 'pie') {
    // Calculate total for percentage calculations - ensure we're using actual numeric values
    const total = chartData.reduce((sum, entry) => {
      const val = typeof entry.value === 'number' ? entry.value : Number(entry.value) || 0;
      return sum + val;
    }, 0);
    
    // Check if all values are the same (single category with 100%)
    const isSingleCategory = chartData.length === 1;
    const allSameValue = chartData.length > 1 && 
      chartData.every(entry => {
        const val = typeof entry.value === 'number' ? entry.value : Number(entry.value) || 0;
        return val === (typeof chartData[0].value === 'number' ? chartData[0].value : Number(chartData[0].value) || 0);
      });
    
    // Enhanced label renderer that uses labelLines for small slices to prevent overlap
    const renderCustomLabel = (props: any) => {
      if (total === 0) return '';
      
      const entry = props.payload || props;
      const val = typeof entry.value === 'number' ? entry.value : Number(entry.value) || 0;
      const percent = (val / total) * 100;
      
      // Always show percentage, but position labels intelligently
      const category = String(entry.category || entry.name || '');
      const shortCategory = category.length > 12 ? category.substring(0, 10) + '...' : category;
      
      // For single category or 100% values, always show the label
      if (isSingleCategory || percent >= 99.9) {
        return `${shortCategory}\n100%`;
      }
      
      // For very small slices (< 3%), don't show labels on the pie itself
      if (percent < 3) {
        return ''; // Will rely on legend and tooltip
      }
      
      // For medium slices (3-8%), show just percentage
      if (percent < 8) {
        return `${percent.toFixed(1)}%`;
      }
      
      // For larger slices (>= 8%), show category and percentage
      return `${shortCategory}\n${percent.toFixed(1)}%`;
    };

    // Custom active shape for better label positioning
    const renderActiveShape = (props: any) => {
      const {
        cx, cy, innerRadius, outerRadius, startAngle, endAngle,
        fill, payload, percent
      } = props;
      
      const val = typeof payload.value === 'number' ? payload.value : Number(payload.value) || 0;
      const actualPercent = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
      
      return (
        <g>
          <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} fontSize={12} fontWeight="bold">
            {actualPercent}%
          </text>
          <text x={cx} y={cy} dy={-8} textAnchor="middle" fill="#666" fontSize={10}>
            {String(payload.category || payload.name || '').substring(0, 15)}
          </text>
        </g>
      );
    };

    // Determine if we need a separate legend section (many categories)
    const hasManyCats = chartData.length > 6;

    return (
      <div className="space-y-1">
        {(isSingleCategory || allSameValue) && (
          <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
            All records have the same value: <strong>{chartData[0]?.category || chartData[0]?.name || 'N/A'}</strong> ({total.toLocaleString()} records, 100%)
          </div>
        )}
        <ResponsiveContainer width="100%" height={hasManyCats ? 280 : 220}>
          <PieChart margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <Pie
              data={chartData}
              cx="50%"
              cy={hasManyCats ? '40%' : '45%'}
              labelLine={chartData.length <= 8}
              label={chartData.length <= 8 ? renderCustomLabel : false}
              outerRadius={typeof window !== 'undefined' && window.innerWidth > 768 ? 70 : 55}
              innerRadius={0}
              fill={getColor(0)}
              dataKey="value"
              nameKey="category"
              paddingAngle={isSingleCategory ? 0 : 3}
              minAngle={isSingleCategory ? 0 : 2}
              isAnimationActive={true}
              activeShape={renderActiveShape}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColor(index)} />
              ))}
            </Pie>
          <Tooltip
            formatter={(value: any, name: any, props: any) => {
              const val = typeof value === 'number' ? value : Number(value) || 0;
              const percent = total > 0 ? ((val / total) * 100).toFixed(2) : '0.00';
              const category = props.payload?.category || props.payload?.name || 'Category';
              return [
                `${typeof value === 'number' ? value.toLocaleString() : value} (${percent}%)`,
                category
              ];
            }}
            contentStyle={{
              fontSize: '11px',
              padding: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={hasManyCats ? 60 : 40}
            iconType="circle"
            iconSize={8}
            formatter={(value: any, entry: any) => {
              // value comes from nameKey="category"
              const displayVal = String(value || '');
              const payload = entry?.payload;
              const val = payload ? (typeof payload.value === 'number' ? payload.value : Number(payload.value) || 0) : 0;
              const percent = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              const displayName = displayVal.length > 18
                ? displayVal.substring(0, 16) + '...'
                : displayVal;
              return `${displayName} (${percent}%)`;
            }}
            wrapperStyle={{
              fontSize: '9px',
              paddingTop: '4px',
              lineHeight: '14px',
              maxWidth: '100%',
              overflow: 'hidden'
            }}
            layout="horizontal"
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
    );
  }

  if (effectiveType === 'line') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]).slice(0, Math.max(1, palette.length));

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            {seriesKeys.map((seriesKey, index) => (
              <Line
                key={`line-${seriesKey}`}
                type="monotone"
                dataKey={seriesKey}
                stroke={getColor(index)}
                strokeWidth={2}
                dot={false}
                name={seriesKey}
                strokeDasharray={index === 0 ? undefined : '6 4'}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (effectiveType === 'area') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]).slice(0, Math.max(1, palette.length));

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            {seriesKeys.map((seriesKey, index) => (
              <Area
                key={`area-${seriesKey}`}
                type="monotone"
                dataKey={seriesKey}
                stroke={getColor(index)}
                fill={getColor(index)}
                fillOpacity={Math.max(0.18, 0.45 - index * 0.06)}
                name={seriesKey}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (effectiveType === 'scatter') {
    const scatterData = chartData;
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {scatterData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" name="X" tick={{ fontSize: 10 }} type="number" />
            <YAxis dataKey="y" name="Y" tick={{ fontSize: 10 }} type="number" />
            <ZAxis range={[40, 200]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={scatterData}>
              {scatterData.map((_, index) => (
                <Cell key={`scatter-cell-${index}`} fill={getColor(index)} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Donut chart (pie with inner radius) ──
  if (effectiveType === 'donut') {
    const total = chartData.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
    return (
      <div className="space-y-1">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              outerRadius={typeof window !== 'undefined' && window.innerWidth > 768 ? 80 : 65}
              innerRadius={typeof window !== 'undefined' && window.innerWidth > 768 ? 45 : 35}
              fill={getColor(0)}
              dataKey="value"
              nameKey="category"
              paddingAngle={2}
              label={(props: any) => {
                const val = Number(props.payload?.value) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                return pct === '0' || Number(pct) < 3 ? '' : `${pct}%`;
              }}
              labelLine={true}
            >
              {chartData.map((_, index) => (
                <Cell key={`donut-${index}`} fill={getColor(index)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: any) => {
                const val = Number(value) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                return [`${val.toLocaleString()} (${pct}%)`, ''];
              }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '9px', lineHeight: '14px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Radar chart ──
  if (effectiveType === 'radar') {
    const radarData = chartData.map((entry: any) => ({
      subject: String(entry.category || entry.subject || entry.name || ''),
      value: Number(entry.value) || 0,
      fullMark: Number(entry.fullMark || entry.max || entry.value) || 100,
    }));

    // Detect multi-series radar data
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]);

    return (
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid strokeDasharray="3 3" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
          <PolarRadiusAxis tick={{ fontSize: 9 }} />
          {seriesKeys.map((key, idx) => (
            <Radar
              key={`radar-${key}`}
              name={key}
              dataKey={key}
              stroke={getColor(idx)}
              fill={getColor(idx)}
              fillOpacity={0.25}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: '10px' }} />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  // ── Treemap ──
  if (effectiveType === 'treemap') {
    const treemapData = chartData.map((entry: any, idx: number) => ({
      name: String(entry.category || entry.name || `Item ${idx + 1}`),
      size: Math.abs(Number(entry.value || entry.size) || 0),
      fill: getColor(idx),
    }));

    const CustomTreemapContent = (props: any) => {
      const { x, y, width, height, name, fill } = props;
      if (width < 30 || height < 20) return null;
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={3} />
          <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(11, width / 6)} fill="#fff" fontWeight="500">
            {String(name).length > width / 7 ? String(name).substring(0, Math.floor(width / 7)) + '…' : name}
          </text>
        </g>
      );
    };

    return (
      <ResponsiveContainer width="100%" height={260}>
        <RechartsTreemap
          data={treemapData}
          dataKey="size"
          nameKey="name"
          stroke="#fff"
          content={<CustomTreemapContent />}
        >
          <Tooltip
            formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}`, name]}
          />
        </RechartsTreemap>
      </ResponsiveContainer>
    );
  }

  // ── Histogram (bar chart with no gaps) ──
  if (effectiveType === 'histogram') {
    return (
      <div className="space-y-2 h-full">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} bins
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={0} barCategoryGap={0} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: 'Frequency', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
            <Tooltip />
            <Bar dataKey="value" name="Count">
              {chartData.map((_, index) => (
                <Cell key={`hist-${index}`} fill={getColor(0)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Box Plot (using ComposedChart) ──
  if (effectiveType === 'boxplot') {
    // Expected data: { category, min, q1, median, q3, max }
    const boxData = chartData.map((entry: any) => ({
      category: String(entry.category || entry.name || ''),
      min: Number(entry.min) || 0,
      q1: Number(entry.q1) || 0,
      median: Number(entry.median) || 0,
      q3: Number(entry.q3) || 0,
      max: Number(entry.max) || 0,
      // invisible base for stacking
      _base: Number(entry.q1) || 0,
      _iqr: (Number(entry.q3) || 0) - (Number(entry.q1) || 0),
    }));

    return (
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={boxData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(_val: any, name: string, props: any) => {
              const d = props.payload;
              return [
                `Min: ${d.min} | Q1: ${d.q1} | Med: ${d.median} | Q3: ${d.q3} | Max: ${d.max}`,
                d.category,
              ];
            }}
          />
          {/* Invisible base bar */}
          <Bar dataKey="_base" stackId="box" fill="transparent" />
          {/* IQR box */}
          <Bar dataKey="_iqr" stackId="box" fill={getColor(0)} fillOpacity={0.6} stroke={getColor(0)} strokeWidth={1} />
          {/* Median line */}
          <Line type="monotone" dataKey="median" stroke="#e11d48" strokeWidth={2} dot={{ r: 4, fill: '#e11d48' }} name="Median" />
          {/* Min/Max as scatter */}
          <Scatter dataKey="min" fill="#6b7280" name="Min" />
          <Scatter dataKey="max" fill="#374151" name="Max" />
          <Legend wrapperStyle={{ fontSize: '10px' }} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // ── Heatmap (HTML-based grid) ──
  if (effectiveType === 'heatmap') {
    // Expected data: { x, y, value } or { category, [col]: value }
    const heatData = chartData as any[];

    // Try to detect if it's correlation-style data (rows with multiple numeric columns)
    const sampleRow = heatData[0] || {};
    const numericCols = Object.keys(sampleRow).filter(
      k => k !== 'category' && k !== 'name' && typeof sampleRow[k] === 'number'
    );

    if (numericCols.length > 1) {
      // Matrix-style: rows are categories, columns are numeric
      const rowLabels = heatData.map((r: any) => String(r.category || r.name || ''));
      const allValues = heatData.flatMap((r: any) => numericCols.map(c => Number(r[c]) || 0));
      const minVal = Math.min(...allValues);
      const maxVal = Math.max(...allValues);
      const range = maxVal - minVal || 1;

      const getCellColor = (val: number) => {
        const normalized = (val - minVal) / range;
        if (val < 0) {
          const intensity = Math.min(1, Math.abs(val) / (Math.abs(minVal) || 1));
          return `rgba(59, 130, 246, ${0.15 + intensity * 0.7})`;
        }
        const intensity = normalized;
        return `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`;
      };

      return (
        <div className="overflow-x-auto max-h-[300px]">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-10 bg-white border border-gray-200 px-2 py-1 text-left font-medium"></th>
                {numericCols.map(col => (
                  <th key={col} className="sticky top-0 bg-white border border-gray-200 px-2 py-1 text-center font-medium" style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {col.length > 10 ? col.substring(0, 8) + '…' : col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatData.map((row: any, ri: number) => (
                <tr key={ri}>
                  <td className="sticky left-0 bg-white border border-gray-200 px-2 py-1 font-medium" style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rowLabels[ri]?.length > 12 ? rowLabels[ri].substring(0, 10) + '…' : rowLabels[ri]}
                  </td>
                  {numericCols.map(col => {
                    const val = Number(row[col]) || 0;
                    return (
                      <td key={col} className="border border-gray-200 px-2 py-1 text-center" style={{ backgroundColor: getCellColor(val) }} title={`${rowLabels[ri]} × ${col}: ${val.toFixed(2)}`}>
                        {val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <p className="text-xs">Heatmap requires matrix data</p>
      </div>
    );
  }

  // ── Funnel chart ──
  if (effectiveType === 'funnel') {
    const funnelData = chartData.map((entry: any, idx: number) => ({
      name: String(entry.category || entry.name || `Stage ${idx + 1}`),
      value: Math.abs(Number(entry.value) || 0),
      fill: getColor(idx),
    }));

    return (
      <ResponsiveContainer width="100%" height={260}>
        <FunnelChart margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <Tooltip formatter={(value: any) => [Number(value).toLocaleString(), '']} />
          <Funnel dataKey="value" data={funnelData} isAnimationActive>
            {funnelData.map((entry, index) => (
              <Cell key={`funnel-${index}`} fill={entry.fill} />
            ))}
            <LabelList position="right" fill="#333" fontSize={10} dataKey="name" />
            <LabelList position="center" fill="#fff" fontSize={11} fontWeight="bold" dataKey="value" formatter={(v: number) => v.toLocaleString()} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  // ── Composed chart (bar + line overlay) ──
  if (effectiveType === 'composed') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]);
    const barKey = seriesKeys[0] || 'value';
    const lineKeys = seriesKeys.slice(1, 4);

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar dataKey={barKey} fill={getColor(0)} fillOpacity={0.7} name={barKey} />
            {lineKeys.map((key, idx) => (
              <Line
                key={`composed-line-${key}`}
                type="monotone"
                dataKey={key}
                stroke={getColor(idx + 1)}
                strokeWidth={2}
                dot={{ r: 2 }}
                name={key}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Radial Bar chart ──
  if (effectiveType === 'radialbar') {
    const radialData = chartData.slice(0, 8).map((entry: any, idx: number) => ({
      name: String(entry.category || entry.name || `Item ${idx + 1}`),
      value: Number(entry.value) || 0,
      fill: getColor(idx),
    }));

    return (
      <ResponsiveContainer width="100%" height={280}>
        <RadialBarChart
          innerRadius="20%"
          outerRadius="90%"
          data={radialData}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar
            label={{ position: 'insideStart', fill: '#fff', fontSize: 10 }}
            background
            dataKey="value"
          />
          <Legend
            iconSize={8}
            layout="vertical"
            verticalAlign="middle"
            align="right"
            wrapperStyle={{ fontSize: '9px', lineHeight: '16px' }}
          />
          <Tooltip />
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  // ── Waterfall chart ──
  if (effectiveType === 'waterfall') {
    // Build waterfall bars: invisible base + visible delta
    let running = 0;
    const waterfallData = chartData.map((entry: any) => {
      const val = Number(entry.value) || 0;
      const isTotal = entry.isTotal === true;
      const base = isTotal ? 0 : (val >= 0 ? running : running + val);
      const barVal = isTotal ? val : Math.abs(val);
      if (!isTotal) running += val;
      return {
        category: String(entry.category || entry.name || ''),
        _base: base,
        _delta: barVal,
        _isPositive: val >= 0,
        _isTotal: isTotal,
        value: val,
      };
    });

    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={waterfallData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(_: any, __: any, props: any) => {
              const d = props.payload;
              return [`${d.value >= 0 ? '+' : ''}${d.value.toLocaleString()}`, d.category];
            }}
          />
          <Bar dataKey="_base" stackId="waterfall" fill="transparent" />
          <Bar dataKey="_delta" stackId="waterfall">
            {waterfallData.map((entry, index) => (
              <Cell
                key={`wf-${index}`}
                fill={entry._isTotal ? '#6366f1' : entry._isPositive ? '#10b981' : '#ef4444'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // ── Stacked Bar ──
  if (effectiveType === 'stacked_bar') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]);

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            {seriesKeys.map((key, idx) => (
              <Bar key={`stacked-${key}`} dataKey={key} stackId="stack" fill={getColor(idx)} name={key} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Pareto chart ──
  if (effectiveType === 'pareto') {
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} angle={chartData.length > 10 ? -45 : 0} textAnchor={chartData.length > 10 ? 'end' : 'middle'} height={chartData.length > 10 ? 60 : 30} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip formatter={(value: any, name: string) => name === 'cumulative' ? `${Number(value).toFixed(1)}%` : value} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar yAxisId="left" dataKey="value" fill={getColor(0)} name="Value" />
            <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke={getColor(1)} strokeWidth={2} dot={false} name="Cumulative %" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Percentage stacked bar ──
  if (effectiveType === 'pct_stacked_bar') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]);

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} stackOffset="expand" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip formatter={(value: any) => `${(Number(value) * 100).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            {seriesKeys.map((key, idx) => (
              <Bar key={`pct-${key}`} dataKey={key} stackId="pctstack" fill={getColor(idx)} name={key} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Bubble chart ──
  if (effectiveType === 'bubble') {
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <ScatterChart margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" tick={{ fontSize: 10 }} name="X" />
            <YAxis dataKey="y" tick={{ fontSize: 10 }} name="Y" />
            <ZAxis dataKey="z" range={[20, 400]} name="Size" />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={chartData} fill={getColor(0)} fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Dual-axis composed ──
  if (effectiveType === 'dual_axis') {
    const seriesKeys = getSeriesKeys(chartData as Record<string, any>[]);
    const leftKey = seriesKeys[0] || 'value';
    const rightKey = seriesKeys[1] || seriesKeys[0] || 'value';

    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            Showing {chartData.length.toLocaleString()} of {normalizedData.length.toLocaleString()} data points
          </div>
        )}
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar yAxisId="left" dataKey={leftKey} fill={getColor(0)} name={leftKey} />
            <Line yAxisId="right" type="monotone" dataKey={rightKey} stroke={getColor(1)} strokeWidth={2} name={rightKey} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Fallback for unsupported chart types
  return (
    <div className="flex items-center justify-center h-full text-gray-400">
      <p className="text-xs">{effectiveType} chart</p>
    </div>
  );
};
