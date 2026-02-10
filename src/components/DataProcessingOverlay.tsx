// Data Processing Overlay - Prevents "page not responding" errors
// Shows clear feedback during large file processing

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, Database, FileText, BarChart3, Sparkles, CheckCircle } from 'lucide-react';

interface DataProcessingOverlayProps {
  isVisible: boolean;
  stage: 'uploading' | 'parsing' | 'analyzing' | 'processing' | 'complete';
  progress?: number;
  message?: string;
  fileSize?: number;
  rowCount?: number;
}

const DataProcessingOverlay: React.FC<DataProcessingOverlayProps> = ({
  isVisible,
  stage,
  progress = 0,
  message,
  fileSize,
  rowCount
}) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev.length >= 3) return '';
        return prev + '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible) return null;

  const getStageIcon = () => {
    switch (stage) {
      case 'uploading':
        return <FileText className="h-8 w-8 text-blue-500 animate-pulse" />;
      case 'parsing':
        return <Database className="h-8 w-8 text-purple-500 animate-pulse" />;
      case 'analyzing':
        return <BarChart3 className="h-8 w-8 text-green-500 animate-pulse" />;
      case 'processing':
        return <Sparkles className="h-8 w-8 text-violet-500 animate-pulse" />;
      case 'complete':
        return <CheckCircle className="h-8 w-8 text-green-500" />;
      default:
        return <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />;
    }
  };

  const getStageMessage = () => {
    if (message) return message;
    
    switch (stage) {
      case 'uploading':
        return `Uploading your file${dots}`;
      case 'parsing':
        return `Reading and parsing data${dots}`;
      case 'analyzing':
        return `Analyzing ${rowCount ? `${rowCount.toLocaleString()} ` : ''}rows${dots}`;
      case 'processing':
        return `Processing data and generating insights${dots}`;
      case 'complete':
        return 'Data processing complete!';
      default:
        return `Processing your data${dots}`;
    }
  };

  const getEstimatedTime = () => {
    if (!fileSize) return null;
    
    const sizeMB = fileSize / (1024 * 1024);
    if (sizeMB < 1) return 'Estimated time: < 5 seconds';
    if (sizeMB < 5) return 'Estimated time: 5-15 seconds';
    if (sizeMB < 20) return 'Estimated time: 15-30 seconds';
    if (sizeMB < 50) return 'Estimated time: 30-60 seconds';
    return 'Estimated time: 1-2 minutes';
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-in fade-in duration-200"
      style={{ 
        pointerEvents: 'all'
      }}
    >
      <Card className="w-full max-w-md mx-4 shadow-2xl border-2 border-violet-200">
        <CardContent className="p-8">
          <div className="text-center space-y-6">
            {/* Icon */}
            <div className="flex justify-center">
              {stage === 'complete' ? (
                <div className="relative">
                  {getStageIcon()}
                  <div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping" />
                </div>
              ) : (
                <div className="relative">
                  <Loader2 className="h-12 w-12 text-violet-500 animate-spin" />
                  <div className="absolute inset-0 bg-violet-500/20 rounded-full animate-pulse" />
                </div>
              )}
            </div>

            {/* Main Message */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {stage === 'complete' ? 'Processing Complete!' : 'Please Wait'}
              </h3>
              <p className="text-gray-600 text-lg">
                {getStageMessage()}
              </p>
            </div>

            {/* Progress Bar */}
            {stage !== 'complete' && (
              <div className="space-y-2">
                <Progress 
                  value={progress} 
                  className="h-2"
                />
                <p className="text-xs text-gray-500">
                  {progress > 0 ? `${Math.round(progress)}% complete` : 'Processing...'}
                </p>
              </div>
            )}

            {/* File Info */}
            {fileSize && (
              <div className="text-xs text-gray-500 space-y-1">
                <p>File size: {(fileSize / (1024 * 1024)).toFixed(2)} MB</p>
                {getEstimatedTime() && <p>{getEstimatedTime()}</p>}
              </div>
            )}

            {/* Helpful Message */}
            <div className="pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                {stage === 'complete' 
                  ? 'Your data is ready for analysis!'
                  : 'Please wait while we process your data. Large files may take a moment - do not close this page.'}
              </p>
              {stage !== 'complete' && (
                <p className="text-xs text-gray-400 mt-2">
                  💡 The page is working - this message confirms it's responsive!
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DataProcessingOverlay;
