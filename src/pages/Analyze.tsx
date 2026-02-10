import React from 'react';
import FunctionalDataUpload from '@/components/FunctionalDataUpload';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const AnalyzePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="pt-16">
        <FunctionalDataUpload />
      </main>
      <Footer />
    </div>
  );
};

export default AnalyzePage;
