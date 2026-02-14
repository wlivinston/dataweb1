import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
//import BlogPostLayout from "@/components/BlogPostLayout"; // adjust path if needed
import BlogPostLayout from "@/components/BlogPost";
import { loadPostBySlug, type PostData } from "@/lib/loadPosts";

const BlogPostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!slug) return;

        const found = await loadPostBySlug(slug);
        if (mounted) setPost(found);
      } catch (e) {
        console.error("Failed to load post:", e);
        if (mounted) setPost(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="pt-16">
        {loading ? (
          <div className="max-w-3xl mx-auto px-4 py-16 text-gray-600">
            Loading post…
          </div>
        ) : !post ? (
          <div className="max-w-3xl mx-auto px-4 py-16 text-gray-600">
            Post not found.
          </div>
        ) : (
          <BlogPostLayout
            post={{
              title: post.title,
              excerpt: post.excerpt,
              content: post.content,
              author: post.author ?? "DataWeb Team",
              date: post.date,
              readTime: post.readTime,
              category: post.category,
              featured: post.featured,
              qualification: post.qualification,
            }}
          />
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BlogPostPage;
