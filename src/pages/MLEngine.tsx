import { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

const MLEngineDashboard = lazy(() => import('@/components/MLEngineDashboard'));

// Skeleton shown instantly while the dashboard JS chunk downloads
const MLEngineSkeleton = () => (
  <div className="py-8 animate-pulse">
    {/* Header skeleton */}
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-200 to-purple-200" />
      <div className="space-y-2">
        <div className="h-7 w-36 bg-gray-200 rounded" />
        <div className="h-4 w-64 bg-gray-100 rounded" />
      </div>
    </div>
    {/* Badge row skeleton */}
    <div className="flex flex-wrap gap-2 mb-6">
      {[110, 130, 150, 120, 140, 100, 120].map((w, i) => (
        <div key={i} className="h-5 rounded-full bg-gray-100" style={{ width: w }} />
      ))}
    </div>
    {/* Stepper skeleton */}
    <div className="flex items-center gap-2 mb-8">
      {[1, 2, 3, 4, 5, 6].map(n => (
        <div key={n} className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-xs text-gray-400 font-bold">{n}</span>
          </div>
          {n < 6 && <div className="flex-1 h-0.5 w-10 bg-gray-100" />}
        </div>
      ))}
    </div>
    {/* Tab bar skeleton */}
    <div className="flex gap-2 mb-6">
      {[90, 100, 130, 110, 90, 100].map((w, i) => (
        <div key={i} className="h-9 rounded-md bg-gray-100" style={{ width: w }} />
      ))}
    </div>
    {/* Upload zone skeleton */}
    <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-gray-100" />
      <div className="h-5 w-48 bg-gray-100 rounded" />
      <div className="h-4 w-72 bg-gray-100 rounded" />
      <div className="h-8 w-28 bg-gray-100 rounded-md mt-2" />
    </div>
  </div>
);

const MLEnginePage = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="ML Engine | DataAfrik"
        description="Train machine learning models on your data. Automated problem detection, feature engineering, model comparison, and deployment guidance — all in your browser."
        path="/ml-engine"
      />
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <Suspense fallback={<MLEngineSkeleton />}>
            <MLEngineDashboard />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default MLEnginePage;
