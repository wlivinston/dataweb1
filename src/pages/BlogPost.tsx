import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import BlogPostLayout from "@/components/BlogPost";
import { loadPostBySlug, type PostData } from "@/lib/loadPosts";

const BlogPostView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  const [post, setPost] = useState<PostData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!slug) {
        if (mounted) setNotFound(true);
        return;
      }

      try {
        const found = await loadPostBySlug(slug);

        if (!mounted) return;

        if (!found) {
          setNotFound(true);
          return;
        }

        // ✅ Ensure required fields for BlogPostLayout
        const normalized: PostData = {
          ...found,
          excerpt: found.excerpt ?? "",
          author: found.author ?? "DataWeb Team",
          readTime: found.readTime ?? "1 min read",
          category: found.category ?? "General",
        };

        setPost(normalized);
      } catch (e) {
        console.error("Failed to load markdown post:", e);
        if (mounted) setNotFound(true);
      }
    })();

    return () => {
      mounted = false;
    };
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
