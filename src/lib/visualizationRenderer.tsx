// Shared visualization renderer component
import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, ScatterChart, Scatter, ZAxis } from 'recharts';
import { Visualization } from './types';
import { Table } from '@/components/ui/table';
import { optimizeVisualizationData, RENDERING_LIMITS } from './dataOptimization';
import PaginatedTable from '@/components/PaginatedTable';

export const renderVisualization = (viz: Visualization) => {
  if (viz.type === 'table') {
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
  const chartData = optimizeVisualizationData(rawData, viz.type);
  
  // Show warning if data was sampled
  const wasSampled = rawData.length > chartData.length;
  
  if (viz.type === 'bar') {
    return (
      <div className="space-y-2 h-full">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {rawData.length.toLocaleString()} data points for performance
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
            <Bar dataKey="value" fill={viz.colors[0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (viz.type === 'pie') {
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
              fill="#8884d8"
              dataKey="value"
              nameKey="category"
              paddingAngle={isSingleCategory ? 0 : 3}
              minAngle={isSingleCategory ? 0 : 2}
              isAnimationActive={true}
              activeShape={renderActiveShape}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={viz.colors[index % viz.colors.length]} />
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

  if (viz.type === 'line') {
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {rawData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke={viz.colors[0]} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (viz.type === 'area') {
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {chartData.length.toLocaleString()} of {rawData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="value" stroke={viz.colors[0]} fill={viz.colors[0]} fillOpacity={0.6} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }
  
  if (viz.type === 'scatter') {
    const scatterData = Array.isArray(viz.data) ? viz.data : [];
    return (
      <div className="space-y-2">
        {wasSampled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ Large dataset: Showing {scatterData.length.toLocaleString()} of {rawData.length.toLocaleString()} data points for performance
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" name="X" tick={{ fontSize: 10 }} type="number" />
            <YAxis dataKey="y" name="Y" tick={{ fontSize: 10 }} type="number" />
            <ZAxis range={[40, 200]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={scatterData} fill={viz.colors[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Placeholder for other chart types
  return (
    <div className="flex items-center justify-center h-full text-gray-400">
      <p className="text-xs">{viz.type} chart</p>
    </div>
  );
};


