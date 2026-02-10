// Statistical Description Component - Displays data statistics similar to pandas .describe()
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, TrendingUp, Database, BarChart3 } from 'lucide-react';
import { Dataset } from '@/lib/types';
import { describeDataset, formatNumber, formatLargeNumber, ColumnStatistics } from '@/lib/statisticalDescription';

interface StatisticalDescriptionProps {
  dataset: Dataset | null;
}

const StatisticalDescription: React.FC<StatisticalDescriptionProps> = ({ dataset }) => {
  const statistics = useMemo(() => {
    if (!dataset) return [];
    return describeDataset(dataset);
  }, [dataset]);

  const numericStats = useMemo(() => {
    return statistics.filter(stat => stat.type === 'number');
  }, [statistics]);

  const categoricalStats = useMemo(() => {
    return statistics.filter(stat => stat.type !== 'number');
  }, [statistics]);

  if (!dataset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Statistical Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Database className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p>No dataset selected. Please upload a dataset to view statistics.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Statistical Description
        </CardTitle>
        <div className="text-sm text-gray-500 mt-1">
          Comprehensive statistics for all columns (similar to pandas .describe())
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="all">All Columns</TabsTrigger>
            <TabsTrigger value="numeric">
              Numeric ({numericStats.length})
            </TabsTrigger>
            <TabsTrigger value="categorical">
              Categorical ({categoricalStats.length})
            </TabsTrigger>
          </TabsList>

          {/* All Columns */}
          <TabsContent value="all" className="space-y-4">
            {statistics.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-white z-10 min-w-[150px]">Statistic</TableHead>
                      {statistics.map(stat => (
                        <TableHead key={stat.columnName} className="text-center min-w-[120px]">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold">{stat.columnName}</span>
                            <Badge variant="outline" className="text-xs">
                              {stat.type}
                            </Badge>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Count */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Count</TableCell>
                      {statistics.map(stat => (
                        <TableCell key={`${stat.columnName}-count`} className="text-center">
                          {formatLargeNumber(stat.count)}
                        </TableCell>
                      ))}
                    </TableRow>

                    {/* Non-Null Count */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Non-Null Count</TableCell>
                      {statistics.map(stat => (
                        <TableCell key={`${stat.columnName}-nonnull`} className="text-center">
                          {formatLargeNumber(stat.nonNullCount)}
                        </TableCell>
                      ))}
                    </TableRow>

                    {/* Null Count */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Null Count</TableCell>
                      {statistics.map(stat => (
                        <TableCell key={`${stat.columnName}-null`} className="text-center text-red-600">
                          {formatLargeNumber(stat.nullCount)}
                        </TableCell>
                      ))}
                    </TableRow>

                    {/* Numeric Statistics */}
                    {numericStats.length > 0 && (
                      <>
                        <TableRow className="bg-blue-50">
                          <TableCell colSpan={statistics.length + 1} className="font-bold text-blue-700">
                            Numeric Statistics
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Mean</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-mean`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.mean) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Std Dev</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-std`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.std) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Min</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-min`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.min) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">25% (Q1)</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-q1`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.q1) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">50% (Median)</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-median`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.median) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">75% (Q3)</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-q3`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.q3) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Max</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-max`} className="text-center">
                              {stat.type === 'number' ? formatNumber(stat.max) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      </>
                    )}

                    {/* Categorical Statistics */}
                    {categoricalStats.length > 0 && (
                      <>
                        <TableRow className="bg-green-50">
                          <TableCell colSpan={statistics.length + 1} className="font-bold text-green-700">
                            Categorical Statistics
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Unique</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-unique`} className="text-center">
                              {stat.type !== 'number' ? formatLargeNumber(stat.unique) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Top</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-top`} className="text-center">
                              {stat.type !== 'number' && stat.top !== null 
                                ? String(stat.top).substring(0, 20) + (String(stat.top).length > 20 ? '...' : '')
                                : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium sticky left-0 bg-gray-50">Frequency</TableCell>
                          {statistics.map(stat => (
                            <TableCell key={`${stat.columnName}-freq`} className="text-center">
                              {stat.type !== 'number' ? formatLargeNumber(stat.freq) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No statistics available
              </div>
            )}
          </TabsContent>

          {/* Numeric Columns Only */}
          <TabsContent value="numeric" className="space-y-4">
            {numericStats.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-white z-10">Statistic</TableHead>
                      {numericStats.map(stat => (
                        <TableHead key={stat.columnName} className="text-center">
                          {stat.columnName}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Count</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-count`} className="text-center">
                          {formatLargeNumber(stat.count)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Mean</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-mean`} className="text-center">
                          {formatNumber(stat.mean)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Std Dev</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-std`} className="text-center">
                          {formatNumber(stat.std)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Min</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-min`} className="text-center">
                          {formatNumber(stat.min)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">25%</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-q1`} className="text-center">
                          {formatNumber(stat.q1)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">50%</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-median`} className="text-center">
                          {formatNumber(stat.median)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">75%</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-q3`} className="text-center">
                          {formatNumber(stat.q3)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Max</TableCell>
                      {numericStats.map(stat => (
                        <TableCell key={`${stat.columnName}-max`} className="text-center">
                          {formatNumber(stat.max)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No numeric columns found
              </div>
            )}
          </TabsContent>

          {/* Categorical Columns Only */}
          <TabsContent value="categorical" className="space-y-4">
            {categoricalStats.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-white z-10">Statistic</TableHead>
                      {categoricalStats.map(stat => (
                        <TableHead key={stat.columnName} className="text-center">
                          {stat.columnName}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Count</TableCell>
                      {categoricalStats.map(stat => (
                        <TableCell key={`${stat.columnName}-count`} className="text-center">
                          {formatLargeNumber(stat.count)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Unique</TableCell>
                      {categoricalStats.map(stat => (
                        <TableCell key={`${stat.columnName}-unique`} className="text-center">
                          {formatLargeNumber(stat.unique)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Top</TableCell>
                      {categoricalStats.map(stat => (
                        <TableCell key={`${stat.columnName}-top`} className="text-center">
                          {stat.top !== null 
                            ? String(stat.top).substring(0, 30) + (String(stat.top).length > 30 ? '...' : '')
                            : '-'}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-gray-50">Frequency</TableCell>
                      {categoricalStats.map(stat => (
                        <TableCell key={`${stat.columnName}-freq`} className="text-center">
                          {formatLargeNumber(stat.freq)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No categorical columns found
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default StatisticalDescription;
