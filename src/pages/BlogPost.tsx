import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BlogPostLayout, { type BlogPostLayoutData } from "@/components/BlogPost";
import { loadPostBySlug } from "@/lib/loadPosts";
import { getApiUrl } from "@/lib/publicConfig";

const BlogPostView: React.FC = () => {
  const { slug } = useParams();
  const [post, setPost] = useState<BlogPostLayoutData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [backendPostId, setBackendPostId] = useState<number | null>(null);

  useEffect(() => {
    const loadPost = async () => {
      if (!slug) return;

      setNotFound(false);
      setBackendPostId(null);

      const mdPost = await loadPostBySlug(slug);
      if (mdPost) {
        setPost({
          slug: mdPost.slug,
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

        try {
          const response = await fetch(
            getApiUrl(`/api/blog/posts/${encodeURIComponent(mdPost.slug)}`)
          );

          let resolvedPostId: number | null = null;
          if (response.ok) {
            const payload = await response.json();
            const id = payload?.post?.id;
            if (typeof id === "number") {
              resolvedPostId = id;
            }
          }

          if (resolvedPostId !== null) {
            setBackendPostId(resolvedPostId);
            return;
          }

          if (!response.ok || resolvedPostId === null) {
            const syncResponse = await fetch(getApiUrl("/api/blog/sync/markdown"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ slugs: [mdPost.slug] }),
            });

            if (syncResponse.ok) {
              const syncPayload = await syncResponse.json();
              const syncedPost = Array.isArray(syncPayload?.posts)
                ? syncPayload.posts.find((item: any) => item?.slug === mdPost.slug)
                : null;

              if (typeof syncedPost?.id === "number") {
                setBackendPostId(syncedPost.id);
              }
            }
          }
        } catch (error) {
          // Non-fatal: article still renders, comments stay disabled.
          console.warn("Unable to resolve backend post id for comments:", error);
        }
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

  return <BlogPostLayout post={post} backendPostId={backendPostId} />;
};

export default BlogPostView;
