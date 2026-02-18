import React, { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';
const FunctionalDataUpload = lazy(() => import('@/components/FunctionalDataUpload'));

const AnalyzePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="Analyze Your Data | DataAfrik"
        description="Upload your data and generate interactive analytics, visualizations, and AI-assisted insights."
        path="/analyze"
      />
      <Navbar />
      <main className="pt-16">
        <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading analyzer...</div>}>
          <FunctionalDataUpload />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default AnalyzePage;
