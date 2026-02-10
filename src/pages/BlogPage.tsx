import React from 'react';
import Blog from '@/components/Blog';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const BlogPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="pt-16">
        <Blog />
      </main>
      <Footer />
    </div>
  );
};

export default BlogPage;
