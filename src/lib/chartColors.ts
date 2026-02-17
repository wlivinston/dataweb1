import { ColorScheme } from './types';

export const SHARED_CHART_PALETTE: string[] = [
  '#2563EB',
  '#14B8A6',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#22C55E',
  '#F97316',
];

export const CHART_COLOR_SCHEMES: ColorScheme[] = [
  {
    name: 'professional',
    colors: SHARED_CHART_PALETTE,
  },
  {
    name: 'vibrant',
    colors: ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'],
  },
  {
    name: 'pastel',
    colors: ['#FDBA74', '#F9A8D4', '#86EFAC', '#93C5FD', '#C4B5FD', '#67E8F9'],
  },
  {
    name: 'monochrome',
    colors: ['#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB'],
  },
];

export const POSITIVE_CHART_COLOR = '#22C55E';
export const NEGATIVE_CHART_COLOR = '#EF4444';
