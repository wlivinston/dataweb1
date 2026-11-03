import { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

const TaxEstimator = lazy(() => import('@/components/TaxEstimator'));

const TaxPage = () => (
  <div className="min-h-screen bg-white">
    <SeoMeta
      title="Federal Tax Estimate | DataAfrik"
      description="Estimate your federal income tax refund or balance due from your W-2s."
      path="/tax"
    />
    <Navbar />
    <main className="pt-20 pb-16">
      <div className="container mx-auto px-4 max-w-7xl">
        <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading tax estimate...</div>}>
          <TaxEstimator />
        </Suspense>
      </div>
    </main>
    <Footer />
  </div>
);

export default TaxPage;
