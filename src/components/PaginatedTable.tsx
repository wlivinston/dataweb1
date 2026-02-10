// Paginated Table Component - Handles large datasets efficiently
import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { getPaginatedData } from '@/lib/dataOptimization';

interface PaginatedTableProps {
  data: any[];
  columns: string[];
  pageSize?: number;
  maxRows?: number;
}

const PaginatedTable: React.FC<PaginatedTableProps> = ({
  data,
  columns,
  pageSize = 100,
  maxRows = 1000
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);

  // Limit data to maxRows for safety
  const limitedData = useMemo(() => {
    return data.slice(0, maxRows);
  }, [data, maxRows]);

  const { data: paginatedData, totalPages, totalRows } = useMemo(() => {
    return getPaginatedData(limitedData, currentPage, rowsPerPage);
  }, [limitedData, currentPage, rowsPerPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  className="border border-gray-200 px-4 py-2 text-left font-medium text-gray-700"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, index) => (
              <tr
                key={index}
                className="hover:bg-gray-50 border-b border-gray-100"
              >
                {columns.map(col => (
                  <td
                    key={col}
                    className="border border-gray-200 px-4 py-2 text-gray-600"
                  >
                    {typeof row[col] === 'number'
                      ? row[col].toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : String(row[col] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            Showing {((currentPage - 1) * rowsPerPage) + 1} to{' '}
            {Math.min(currentPage * rowsPerPage, totalRows)} of {totalRows.toLocaleString()} rows
            {data.length > maxRows && (
              <span className="text-orange-600 ml-2">
                (Limited to {maxRows.toLocaleString()} for performance)
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={rowsPerPage.toString()}
            onValueChange={(value) => {
              setRowsPerPage(Number(value));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 rows</SelectItem>
              <SelectItem value="100">100 rows</SelectItem>
              <SelectItem value="250">250 rows</SelectItem>
              <SelectItem value="500">500 rows</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <span className="px-3 py-1 text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaginatedTable;
