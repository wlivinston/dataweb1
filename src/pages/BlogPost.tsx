import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { STATIC_BLOG_POSTS } from "@/lib/staticBlogData";
import BlogPostLayout, { type BlogPostLayoutData } from "@/components/BlogPost";

const BlogPostView: React.FC = () => {
  const { slug } = useParams();
  const [post, setPost] = useState<BlogPostLayoutData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const loadPost = async () => {
      if (!slug) return;

      // Try Supabase first
      try {
        const { data, error } = await supabase
          .from('blog_posts')
          .select('*')
          .eq('slug', slug)
          .eq('published', true)
          .single();

        if (data && !error) {
          setPost({
            title: data.title,
            excerpt: data.excerpt || undefined,
            content: data.content,
            author: data.author,
            date: data.published_at || data.created_at,
            readTime: data.read_time || '5 min read',
            category: data.category || 'General',
            featured: data.featured,
          });
          return;
        }
      } catch {
        // Supabase unavailable, fall through to static
      }

      // Fall back to static blog data
      const staticPost = STATIC_BLOG_POSTS[slug];
      if (staticPost) {
        setPost({
          title: staticPost.title,
          excerpt: staticPost.excerpt,
          content: staticPost.content,
          author: staticPost.author || 'DataAfrik Team',
          date: staticPost.date,
          readTime: staticPost.readTime,
          category: staticPost.category,
          featured: staticPost.featured,
          qualification: staticPost.qualification,
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
