import React, { Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { loadPostBySlug, type PostData } from "@/lib/loadPosts";
import { getApiUrl } from "@/lib/publicConfig";
import SeoMeta from "@/components/SeoMeta";
import { useAuth } from "@/hooks/useAuth";

const BlogPostLayout = React.lazy(() => import("@/components/BlogPostLayout"));

const BlogPostSkeleton: React.FC = () => (
  <div className="max-w-3xl mx-auto px-4 py-12 animate-pulse">
    {/* Back link */}
    <div className="h-4 w-28 bg-gray-200 rounded mb-8" />
    {/* Category badge */}
    <div className="h-5 w-24 bg-gray-200 rounded-full mb-4" />
    {/* Title */}
    <div className="h-9 w-full bg-gray-300 rounded mb-2" />
    <div className="h-9 w-4/5 bg-gray-300 rounded mb-6" />
    {/* Meta row */}
    <div className="flex gap-6 mb-8">
      <div className="h-4 w-32 bg-gray-200 rounded" />
      <div className="h-4 w-24 bg-gray-200 rounded" />
      <div className="h-4 w-20 bg-gray-200 rounded" />
    </div>
    {/* Excerpt */}
    <div className="h-5 w-full bg-gray-200 rounded mb-2" />
    <div className="h-5 w-3/4 bg-gray-200 rounded mb-10" />
    {/* Content lines */}
    {[100, 90, 95, 80, 100, 85, 70, 100, 88, 60].map((w, i) => (
      <div key={i} className="h-4 bg-gray-100 rounded mb-3" style={{ width: `${w}%` }} />
    ))}
  </div>
);

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

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const buildSlugCandidates = (...values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    const decoded = safeDecode(raw);
    push(raw);
    push(decoded);
    push(raw.toLowerCase());
    push(decoded.toLowerCase());
    push(normalizeSlug(raw));
    push(normalizeSlug(decoded));
  }

  return ordered;
};

const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://www.dataafrik.com").replace(/\/+$/, "");

const BlogPostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { session } = useAuth();
  const [post, setPost] = useState<PostData | null>(null);
  const [backendPostId, setBackendPostId] = useState<string | number | null>(null);
  const [postLikeState, setPostLikeState] = useState<{ count: number; liked: boolean }>({
    count: 0,
    liked: false,
  });
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
        if (!slug) {
          if (mounted) {
            setPost(null);
            setBackendPostId(null);
            setLoading(false);
          }
          return;
        }

        const found = await loadPostBySlug(slug);
        if (mounted) {
          setPost(found);
          setBackendPostId(null);
          setPostLikeState({ count: 0, liked: false });
          setLoading(false);
        }

        if (!found) return;

        const slugCandidates = buildSlugCandidates(found.slug, slug);
        const normalizedSlugCandidates = slugCandidates
          .map((candidate) => normalizeSlug(candidate))
          .filter(Boolean);
        const canonicalSlug = normalizedSlugCandidates[0] || normalizeSlug(found.slug);
        const normalizedCandidateSet = new Set(normalizedSlugCandidates);

        // Resolve backend post id asynchronously so article rendering is not blocked.
        void (async () => {
          try {
            for (const slugCandidate of slugCandidates) {
              const response = await fetch(
                getApiUrl(`/api/blog/posts/${encodeURIComponent(slugCandidate)}`),
                {
                  headers: session?.access_token
                    ? {
                        Authorization: `Bearer ${session.access_token}`,
                      }
                    : undefined,
                }
              );

              let resolvedPostId: string | number | null = null;
              if (response.ok) {
                const payload = await parseJsonStrict<{
                  post?: { id?: string | number; like_count?: number; user_liked?: boolean };
                }>(
                  response,
                  "Resolve backend post id"
                );
                const id = payload?.post?.id;
                const likeCount = Number(payload?.post?.like_count || 0);
                const userLiked = Boolean(payload?.post?.user_liked);
                if (typeof id === "number") {
                  resolvedPostId = id;
                } else if (typeof id === "string" && id.trim()) {
                  resolvedPostId = id;
                }

                if (mounted) {
                  setPostLikeState({ count: likeCount, liked: userLiked });
                }
              }

              if (resolvedPostId !== null) {
                if (mounted) setBackendPostId(resolvedPostId);
                return;
              }
            }

            const ensureResponse = await fetch(getApiUrl("/api/blog/posts/ensure"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(session?.access_token
                  ? {
                      Authorization: `Bearer ${session.access_token}`,
                    }
                  : {}),
              },
              body: JSON.stringify({
                slug: canonicalSlug,
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
                ...(session?.access_token
                  ? {
                      Authorization: `Bearer ${session.access_token}`,
                    }
                  : {}),
              },
              body: JSON.stringify({ slugs: slugCandidates }),
            });

            if (syncResponse.ok) {
              const syncPayload = await parseJsonStrict<{ posts?: Array<{ id?: string | number; slug?: string }> }>(
                syncResponse,
                "Sync markdown fallback"
              );
              const syncedPost = Array.isArray(syncPayload?.posts)
                ? syncPayload.posts.find((item: any) =>
                    normalizedCandidateSet.has(normalizeSlug(item?.slug))
                  )
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
        })();
      } catch (e) {
        console.error("Failed to load post:", e);
        if (mounted) {
          setPost(null);
          setBackendPostId(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [slug, session?.access_token]);

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
          <BlogPostSkeleton />
        ) : !post ? (
          <div className="max-w-3xl mx-auto px-4 py-16 text-gray-600">
            Post not found.
          </div>
        ) : (
          <Suspense fallback={<BlogPostSkeleton />}>
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
                likeCount: postLikeState.count,
                userLiked: postLikeState.liked,
              }}
              backendPostId={backendPostId}
            />
          </Suspense>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BlogPostPage;
