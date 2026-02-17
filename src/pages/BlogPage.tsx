import React from 'react';
import Blog from '@/components/Blog';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SeoMeta from '@/components/SeoMeta';

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
        <Blog />
      </main>
      <Footer />
    </div>
  );
};

export default BlogPage;
