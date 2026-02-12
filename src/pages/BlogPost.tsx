import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BlogPostLayout, { type BlogPostLayoutData } from "@/components/BlogPost";
import { loadPostBySlug } from "@/lib/loadPosts";

const BlogPostView: React.FC = () => {
  const { slug } = useParams();
  const [post, setPost] = useState<BlogPostLayoutData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const loadPost = async () => {
      if (!slug) return;

      const mdPost = await loadPostBySlug(slug);
      if (mdPost) {
        setPost({
          title: mdPost.title,
          excerpt: mdPost.excerpt,
          content: mdPost.content,
          author: mdPost.author,
          date: mdPost.date,
          readTime: mdPost.readTime,
          category: mdPost.category,
          featured: mdPost.featured,
          qualification: mdPost.qualification,
        });
      } else {
        setNotFound(true);
      }
    };

    loadPost();
  }, [slug]);

  if (notFound) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Post Not Found</h2>
          <p className="text-gray-600">The blog post you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading article...</p>
        </div>
      </div>
    );
  }

  return <BlogPostLayout post={post} />;
};

export default BlogPostView;
