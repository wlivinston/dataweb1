import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const RequestReportCTA: React.FC = () => {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <FileText className="h-6 w-6 text-blue-600" />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h3 className="font-semibold text-gray-900 mb-1">Need a Professional Report?</h3>
          <p className="text-sm text-gray-600">
            Let our data experts analyze your data and write a comprehensive, presentation-ready report for you.
          </p>
        </div>
        <Link to="/request-report" className="flex-shrink-0">
          <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
            Request a Report <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default RequestReportCTA;
