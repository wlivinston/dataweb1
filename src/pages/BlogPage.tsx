import React, { Suspense, lazy } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';
const Blog = lazy(() => import('@/components/Blog'));

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
        <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading blog posts...</div>}>
          <Blog />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default BlogPage;
