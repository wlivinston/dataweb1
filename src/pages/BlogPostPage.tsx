import React from 'react';
import BlogPostView from './BlogPost';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const BlogPostPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="pt-16">
        <BlogPostView />
      </main>
      <Footer />
    </div>
  );
};

export default BlogPostPage;
