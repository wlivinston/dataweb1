import { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

const FinanceDashboard = lazy(() => import('@/components/FinanceDashboard'));

const FinancePage = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="Finance Engine | DataAfrik"
        description="Analyze financial data, generate statements, and produce decision-ready finance insights."
        path="/finance"
      />
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading finance engine...</div>}>
            <FinanceDashboard />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FinancePage;
