import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BlogPostLayout from "@/components/BlogPostLayout";
import { loadPostBySlug, type PostData } from "@/lib/loadPosts";
import { getApiUrl } from "@/lib/publicConfig";

const BlogPostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<PostData | null>(null);
  const [backendPostId, setBackendPostId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!slug) return;

        const found = await loadPostBySlug(slug);
        if (mounted) {
          setPost(found);
          setBackendPostId(null);
        }

        if (!found) return;

        try {
          const response = await fetch(
            getApiUrl(`/api/blog/posts/${encodeURIComponent(found.slug)}`)
          );

          let resolvedPostId: string | number | null = null;
          if (response.ok) {
            const payload = await response.json();
            const id = payload?.post?.id;
            if (typeof id === "number") {
              resolvedPostId = id;
            } else if (typeof id === "string" && id.trim()) {
              resolvedPostId = id;
            }
          }

          if (resolvedPostId !== null) {
            if (mounted) setBackendPostId(resolvedPostId);
            return;
          }

          const ensureResponse = await fetch(getApiUrl("/api/blog/posts/ensure"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              slug: found.slug,
              title: found.title,
              excerpt: found.excerpt,
              content: found.content,
              author: found.author,
              category: found.category,
              featured: Boolean(found.featured),
              date: found.date,
              readTime: found.readTime,
            }),
          });

          if (ensureResponse.ok) {
            const ensurePayload = await ensureResponse.json();
            const ensuredId = ensurePayload?.post?.id;

            if (mounted && typeof ensuredId === "number") {
              setBackendPostId(ensuredId);
              return;
            }

            if (mounted && typeof ensuredId === "string" && ensuredId.trim()) {
              setBackendPostId(ensuredId);
              return;
            }
          }

          const syncResponse = await fetch(getApiUrl("/api/blog/sync/markdown"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ slugs: [found.slug] }),
          });

          if (syncResponse.ok) {
            const syncPayload = await syncResponse.json();
            const syncedPost = Array.isArray(syncPayload?.posts)
              ? syncPayload.posts.find((item: any) => item?.slug === found.slug)
              : null;

            if (mounted && typeof syncedPost?.id === "number") {
              setBackendPostId(syncedPost.id);
            } else if (mounted && typeof syncedPost?.id === "string" && syncedPost.id.trim()) {
              setBackendPostId(syncedPost.id);
            }
          }
        } catch (idResolveError) {
          console.warn("Unable to resolve backend post id for comments:", idResolveError);
        }
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
              slug: post.slug,
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
            backendPostId={backendPostId}
          />
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BlogPostPage;
