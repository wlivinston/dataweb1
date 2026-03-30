import { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

const PivotTradingDashboard = lazy(() => import('@/components/PivotTradingDashboard'));

const PivotTradingPage = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="EURUSD Pivot Trading | DataAfrik"
        description="EURUSD daily pivot point trading system using Action Forex formula. Buy at S1, sell at R1, with news-driven volatility detection."
        path="/pivot-trading"
      />
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading pivot trading engine...</div>}>
            <PivotTradingDashboard />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PivotTradingPage;
