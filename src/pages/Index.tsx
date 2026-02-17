import React from 'react';
import AppLayout from '@/components/AppLayout';
import SeoMeta from '@/components/SeoMeta';

const Index: React.FC = () => {
  return (
    <>
      <SeoMeta
        title="DataAfrik | AI-Powered Data Analytics and Finance Insights"
        description="Analyze data, build finance intelligence, and generate professional reports with DataAfrik."
        path="/"
      />
      <AppLayout />
    </>
  );
};

export default Index;
