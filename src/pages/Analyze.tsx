import React from 'react';
import FunctionalDataUpload from '@/components/FunctionalDataUpload';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

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
        <FunctionalDataUpload />
      </main>
      <Footer />
    </div>
  );
};

export default AnalyzePage;
