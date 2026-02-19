import React, { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';
const Blog = lazy(() => import('@/components/Blog'));

// Shown instantly while the Blog JS chunk downloads
const BlogPageSkeleton: React.FC = () => (
  <section className="py-20 bg-gray-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 animate-pulse">
      {/* Section header */}
      <div className="text-center mb-12">
        <div className="h-9 w-56 bg-gray-300 rounded mx-auto mb-4" />
        <div className="h-5 w-96 bg-gray-200 rounded mx-auto" />
      </div>
      {/* Category filter bar */}
      <div className="flex flex-wrap justify-center gap-2 mb-12">
        {[80, 120, 100, 90, 110, 95].map((w, i) => (
          <div key={i} className="h-8 rounded-md bg-gray-200" style={{ width: w }} />
        ))}
      </div>
      {/* Featured posts skeleton (2-col) */}
      <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl shadow-md overflow-hidden bg-white">
            <div className="h-56 bg-gray-200" />
            <div className="p-6 space-y-3">
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-6 w-3/4 bg-gray-300 rounded" />
              <div className="h-4 w-full bg-gray-200 rounded" />
              <div className="h-4 w-5/6 bg-gray-200 rounded" />
              <div className="flex justify-between mt-4">
                <div className="h-4 w-28 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
              <div className="h-9 w-full bg-gray-200 rounded-md mt-2" />
            </div>
          </div>
        ))}
      </div>
      {/* Regular posts skeleton (3-col) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl shadow-md overflow-hidden bg-white">
            <div className="h-40 bg-gray-200" />
            <div className="p-5 space-y-3">
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-5 w-4/5 bg-gray-300 rounded" />
              <div className="h-4 w-full bg-gray-200 rounded" />
              <div className="flex justify-between mt-3">
                <div className="h-3 w-24 bg-gray-200 rounded" />
                <div className="h-3 w-16 bg-gray-200 rounded" />
              </div>
              <div className="h-9 w-full bg-gray-200 rounded-md mt-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const BlogPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="DataAfrik Blog | Data Science, AI, and Analytics Insights"
        description="Read the latest DataAfrik insights on data science, machine learning, analytics, and finance intelligence."
        path="/blog"
      />
      <Navbar />
      <main className="pt-16">
        <Suspense fallback={<BlogPageSkeleton />}>
          <Blog />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default BlogPage;
