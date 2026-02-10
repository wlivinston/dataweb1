// Dynamic KPI Generator Component - Power BI-like
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Database, DollarSign, TrendingUp, BarChart2, 
  Percent, Activity, PlusCircle, ArrowUp, ArrowDown, Minus,
  Users, Target, Zap
} from 'lucide-react';
import { Dataset } from '@/lib/types';
import { generateKPIs, renderKPICard, KPIDefinition, KPICard } from '@/lib/kpiFormulaEngine';

interface DynamicKPIGeneratorProps {
  dataset: Dataset | null;
}

const DynamicKPIGenerator: React.FC<DynamicKPIGeneratorProps> = ({ dataset }) => {
  // Icon mapping
  const iconMap = useMemo(() => ({
    'database': <Database className="h-5 w-5" />,
    'dollar-sign': <DollarSign className="h-5 w-5" />,
    'trending-up': <TrendingUp className="h-5 w-5" />,
    'bar-chart-2': <BarChart2 className="h-5 w-5" />,
    'percent': <Percent className="h-5 w-5" />,
    'activity': <Activity className="h-5 w-5" />,
    'plus-circle': <PlusCircle className="h-5 w-5" />,
    'arrow-up': <ArrowUp className="h-5 w-5" />,
    'arrow-down': <ArrowDown className="h-5 w-5" />,
    'minus': <Minus className="h-5 w-5" />,
    'users': <Users className="h-5 w-5" />,
    'target': <Target className="h-5 w-5" />,
    'zap': <Zap className="h-5 w-5" />
  }), []);

  // Generate KPIs dynamically
  const kpiDefinitions = useMemo(() => {
    return generateKPIs(dataset);
  }, [dataset]);

  // Render KPI cards
  const kpiCards = useMemo(() => {
    if (!dataset) return [];
    
    return kpiDefinitions
      .map(def => renderKPICard(def, dataset, iconMap))
      .filter((card): card is KPICard => card !== null);
  }, [dataset, kpiDefinitions, iconMap]);

  if (!dataset || kpiCards.length === 0) {
    return (
      <div className="grid grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="p-4 border-dashed border-gray-300">
            <div className="flex flex-col items-center justify-center h-24 text-center">
              <BarChart2 className="h-6 w-6 text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">KPI {index + 1}</p>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-4">
      {kpiCards.map((kpi, index) => (
        <Card key={kpiDefinitions[index]?.id || `kpi-${index}`} className="p-4 hover:shadow-md transition-shadow">
          <CardContent className="p-0">
            <div className="flex flex-col h-full">
              {/* Header with icon and title */}
              <div className="flex items-start justify-between mb-2">
                <div className={`flex items-center gap-2 ${kpi.color || 'text-gray-500'}`}>
                  {kpi.icon}
                </div>
              </div>
              
              {/* Title */}
              <div className="mb-3 min-h-[2.5rem]">
                <p className="text-xs font-medium text-gray-600 leading-tight line-clamp-2">
                  {kpi.title}
                </p>
              </div>
              
              {/* Value */}
              <div className="flex-1 flex items-end">
                <p className="text-xl font-bold text-gray-900 truncate w-full" title={kpi.formattedValue}>
                  {kpi.formattedValue}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      
      {/* Fill remaining slots if less than 6 KPIs */}
      {kpiCards.length < 6 && Array.from({ length: 6 - kpiCards.length }).map((_, index) => (
        <Card key={`placeholder-${index}`} className="p-4 border-dashed border-gray-200 opacity-50">
          <div className="flex flex-col items-center justify-center h-24 text-center">
            <BarChart2 className="h-6 w-6 text-gray-300 mb-2" />
            <p className="text-xs text-gray-400">No Data</p>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default DynamicKPIGenerator;
