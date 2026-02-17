import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BlogPostLayout from "@/components/BlogPostLayout";
import { loadPostBySlug, type PostData } from "@/lib/loadPosts";
import { getApiUrl } from "@/lib/publicConfig";
import SeoMeta from "@/components/SeoMeta";

const isJsonResponse = (response: Response): boolean =>
  (response.headers.get("content-type") || "").toLowerCase().includes("application/json");

async function parseJsonStrict<T>(response: Response, context: string): Promise<T> {
  if (isJsonResponse(response)) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  const preview = text.slice(0, 120).replace(/\s+/g, " ").trim();
  throw new Error(
    `${context}: expected JSON but received ${response.status} ${response.statusText} from ${response.url}. Preview: ${preview}`
  );
}

const normalizeSlug = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/%20/g, " ")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://www.dataafrik.com").replace(/\/+$/, "");

const BlogPostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<PostData | null>(null);
  const [backendPostId, setBackendPostId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);

  const canonicalSlug = post?.slug || slug || "";
  const canonicalPath = canonicalSlug ? `/blog/${encodeURIComponent(canonicalSlug)}` : "/blog";
  const articleJsonLd = post
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: post.title,
        description: post.excerpt,
        author: {
          "@type": "Person",
          name: post.author || "DataAfrik Team",
        },
        publisher: {
          "@type": "Organization",
          name: "DataAfrik",
          url: SITE_URL,
        },
        mainEntityOfPage: `${SITE_URL}${canonicalPath}`,
        datePublished: post.date,
        dateModified: post.date,
      }
    : null;

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

        const normalizedSlug = normalizeSlug(found.slug);

        try {
          const response = await fetch(
            getApiUrl(`/api/blog/posts/${encodeURIComponent(normalizedSlug)}`)
          );

          let resolvedPostId: string | number | null = null;
          if (response.ok) {
            const payload = await parseJsonStrict<{ post?: { id?: string | number } }>(
              response,
              "Resolve backend post id"
            );
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
              slug: normalizedSlug,
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
            const ensurePayload = await parseJsonStrict<{ post?: { id?: string | number } }>(
              ensureResponse,
              "Ensure backend post id"
            );
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
            body: JSON.stringify({ slugs: [normalizedSlug] }),
          });

          if (syncResponse.ok) {
            const syncPayload = await parseJsonStrict<{ posts?: Array<{ id?: string | number; slug?: string }> }>(
              syncResponse,
              "Sync markdown fallback"
            );
            const syncedPost = Array.isArray(syncPayload?.posts)
              ? syncPayload.posts.find((item: any) => normalizeSlug(item?.slug) === normalizedSlug)
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
      <SeoMeta
        title={post ? `${post.title} | DataAfrik Blog` : "Blog Post | DataAfrik"}
        description={post?.excerpt || "Read the latest data and AI insights from DataAfrik."}
        path={canonicalPath}
        type="article"
        noindex={!loading && !post}
        jsonLd={articleJsonLd}
      />
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
