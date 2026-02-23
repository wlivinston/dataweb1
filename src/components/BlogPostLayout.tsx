import React, { Suspense, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Calendar, Clock, User, Share2, Heart, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import RequestReportCTA from "./RequestReportCTA";
import { Input } from "@/components/ui/input";
import { subscribeToNewsletter } from "@/lib/newsletter";
import { getApiUrl } from "@/lib/publicConfig";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const BlogComments = React.lazy(() => import("@/components/BlogComments"));

export interface BlogPostLayoutData {
  slug?: string;
  title: string;
  excerpt?: string;
  content: string;
  author: string;
  date: string;
  readTime: string;
  category: string;
  featured?: boolean;
  qualification?: string;
  authorBio?: string;
  likeCount?: number;
  userLiked?: boolean;
}

interface BlogPostLayoutProps {
  post: BlogPostLayoutData;
  backendPostId?: string | number | null;
}

const DISALLOWED_MARKDOWN_ELEMENTS = [
  "script",
  "style",
  "object",
  "embed",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "select",
] as const;

function isAllowedEmbedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl, "https://www.dataafrik.com");
    const host = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== "https:") return false;

    return (
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "www.youtube-nocookie.com" ||
      host === "youtube-nocookie.com"
    );
  } catch {
    return false;
  }
}

function extractHeadings(markdown: string): { id: string; text: string; level: number }[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { id: string; text: string; level: number }[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    headings.push({ id, text, level });
  }
  return headings;
}

function normalizeAuthorKey(author: string): string {
  return String(author || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isSenyoAuthor(author: string): boolean {
  return normalizeAuthorKey(author) === "senyoktsedze";
}

const DEFAULT_SENYO_BIO =
  "A data science professional with expertise in analytics, machine learning, and business intelligence. Passionate about turning complex data into actionable insights to help organizations make data-driven decisions.";

const BlogPostLayout: React.FC<BlogPostLayoutProps> = ({ post, backendPostId = null }) => {
  const { user, session } = useAuth();
  const [likes, setLikes] = useState<number>(Number(post.likeCount || 0));
  const [hasLiked, setHasLiked] = useState<boolean>(Boolean(post.userLiked));
  const [isLiking, setIsLiking] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    setNewsletterEmail((currentEmail) => currentEmail || user.email);
  }, [user?.email]);

  useEffect(() => {
    setLikes(Number(post.likeCount || 0));
    setHasLiked(Boolean(post.userLiked));
  }, [post.likeCount, post.userLiked, post.slug]);

  const headings = useMemo(() => extractHeadings(post.content), [post.content]);
  const resolvedAuthorBio = useMemo(() => {
    const explicitBio = String(post.authorBio || "").trim();
    if (explicitBio) return explicitBio;
    if (isSenyoAuthor(post.author)) return DEFAULT_SENYO_BIO;
    return "";
  }, [post.author, post.authorBio]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleLike = async () => {
    if (!session?.access_token) {
      toast.error("Please log in to like this post.");
      return;
    }

    if (hasLiked) {
      return;
    }

    const slug = (post.slug || "").trim();
    if (!slug) {
      toast.error("Unable to like this post right now.");
      return;
    }

    setIsLiking(true);
    try {
      const response = await fetch(getApiUrl(`/api/blog/posts/${encodeURIComponent(slug)}/like`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        liked?: boolean;
        like_count?: number;
      };

      if (!response.ok) {
        toast.error(payload.error || "Failed to like post.");
        return;
      }

      setHasLiked(Boolean(payload.liked ?? true));
      setLikes((current) => {
        if (typeof payload.like_count === "number") return payload.like_count;
        return current + (hasLiked ? 0 : 1);
      });
    } catch (error) {
      toast.error("Failed to like post. Please try again.");
    } finally {
      setIsLiking(false);
    }
  };

  const handleShare = (platform: string) => {
    const url = window.location.href;
    const title = post.title;

    const shareUrls: Record<string, string> = {
      twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    };

    window.open(shareUrls[platform], '_blank');
  };

  const handleNewsletterSubscribe = async () => {
    const emailToUse = (newsletterEmail || user?.email || "").trim();
    if (!emailToUse) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setIsSubscribing(true);
    try {
      const result = await subscribeToNewsletter({
        email: emailToUse,
        source: "blog-sidebar",
      });
      if (result.alreadySubscribed) {
        toast.info(result.message || "This email is already subscribed to the newsletter.");
      } else if (result.emailSent === false) {
        toast.success("Subscribed successfully, but confirmation email could not be sent yet.");
      } else {
        toast.success(result.message || "You are subscribed. Check your inbox for confirmation.");
      }
      setNewsletterEmail(user?.email || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to subscribe.";
      toast.error(message);
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-100 py-16">
        <div className="blog-container">
          <Link to="/blog" className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 mb-6 transition-colors">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Blog
          </Link>
          <div className="blog-header">
            <Badge variant="secondary" className="mb-4">
              {post.category}
            </Badge>
            <h1 className="blog-title">{post.title}</h1>
            {post.excerpt && (
              <p className="blog-subtitle">{post.excerpt}</p>
            )}

            <div className="blog-meta">
              <div className="blog-author">
                <User className="h-4 w-4 inline mr-1" />
                {post.author}
              </div>
              <div className="blog-date">
                <Calendar className="h-4 w-4" />
                {formatDate(post.date)}
              </div>
              <div className="blog-read-time">
                <Clock className="h-4 w-4" />
                {post.readTime}
              </div>
              {post.featured && (
                <Badge className="bg-gradient-to-r from-blue-600 to-purple-600">
                  Featured
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="blog-container py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
          {/* Main Article */}
          <article className="blog-main">
            <div className="markdown-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                disallowedElements={[...DISALLOWED_MARKDOWN_ELEMENTS]}
                unwrapDisallowed
                components={{
                  h2: ({ children, ...props }) => {
                    const text = typeof children === 'string' ? children : String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
                    return <h2 id={id} {...props}>{children}</h2>;
                  },
                  h3: ({ children, ...props }) => {
                    const text = typeof children === 'string' ? children : String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
                    return <h3 id={id} {...props}>{children}</h3>;
                  },
                  pre: ({ children, ...props }) => {
                    const firstChild = React.Children.toArray(children)[0] as
                      | React.ReactElement<{ className?: string }>
                      | undefined;
                    const codeClassName = firstChild?.props?.className ?? "";
                    const isDiagramBlock =
                      codeClassName.includes("language-text") ||
                      codeClassName.includes("language-diagram");

                    return (
                      <pre
                        {...props}
                        className={isDiagramBlock ? "markdown-diagram" : undefined}
                      >
                        {children}
                      </pre>
                    );
                  },
                  iframe: ({ src, title }) => {
                    if (!src || !isAllowedEmbedUrl(src)) return null;
                    return (
                      <div className="my-6 aspect-video w-full overflow-hidden rounded-lg border border-gray-200">
                        <iframe
                          src={src}
                          title={title || "Embedded content"}
                          className="h-full w-full"
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    );
                  },
                  img: ({ src, alt, className }) => {
                    if (!src) return null;
                    return (
                      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={src}
                          alt={alt || "Article image"}
                          className={`cursor-zoom-in ${className || ""}`.trim()}
                          loading="lazy"
                        />
                      </a>
                    );
                  },
                }}
              >
                {post.content}
              </ReactMarkdown>
            </div>

            {/* Article Footer */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              {/* Engagement Section */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLike}
                    disabled={isLiking || hasLiked}
                    className={`flex items-center gap-2 ${hasLiked ? "border-red-300 text-red-600" : ""}`}
                  >
                    <Heart className={`h-4 w-4 ${hasLiked ? "fill-current text-red-500" : ""}`} />
                    {likes} Likes
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleShare('twitter')}>
                    <Share2 className="h-4 w-4 mr-1" /> Twitter
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleShare('linkedin')}>
                    <Share2 className="h-4 w-4 mr-1" /> LinkedIn
                  </Button>
                </div>
              </div>

              {/* Author Bio */}
              <div className="author-bio">
                <h3>About the Author</h3>
                <p>
                  <strong>{post.author}</strong>
                  {post.qualification && <> - {post.qualification}</>}
                  {resolvedAuthorBio ? <>. {resolvedAuthorBio}</> : "."}
                </p>
              </div>
            </div>

            {/* Report CTA */}
            <div className="mt-8">
              <RequestReportCTA />
            </div>

            {/* Comments */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              <Suspense fallback={<div className="text-sm text-gray-500">Loading comments...</div>}>
                <BlogComments
                  postId={backendPostId}
                  postSlug={post.slug || ""}
                  postSeed={{
                    title: post.title,
                    excerpt: post.excerpt,
                    content: post.content,
                    author: post.author,
                    category: post.category,
                    featured: Boolean(post.featured),
                    date: post.date,
                    readTime: post.readTime,
                  }}
                />
              </Suspense>
            </div>
          </article>

          {/* Sidebar */}
          <aside className="blog-sidebar">
            <div className="sticky top-24">
              {/* Dynamic Table of Contents */}
              {headings.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-6 mb-8">
                  <h3 className="font-serif text-lg font-semibold mb-4">Table of Contents</h3>
                  <nav className="space-y-2">
                    {headings.map((heading, i) => (
                      <a
                        key={i}
                        href={`#${heading.id}`}
                        className={`block text-sm text-gray-600 hover:text-blue-600 transition-colors ${
                          heading.level === 3 ? 'pl-4' : ''
                        }`}
                      >
                        {heading.text}
                      </a>
                    ))}
                  </nav>
                </div>
              )}

              {/* Related Articles */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="font-serif text-lg font-semibold mb-4">Related Articles</h3>
                <div className="space-y-4">
                  <Link to="/blog/building-scalable-data-pipelines" className="block border-l-4 border-blue-500 pl-4 hover:bg-gray-100 rounded-r-lg py-1 transition-colors">
                    <h4 className="text-sm font-medium text-gray-900 mb-1">Building Scalable Data Pipelines</h4>
                    <p className="text-xs text-gray-600">Design robust data pipelines at scale...</p>
                  </Link>
                  <Link to="/blog/machine-learning-in-production" className="block border-l-4 border-green-500 pl-4 hover:bg-gray-100 rounded-r-lg py-1 transition-colors">
                    <h4 className="text-sm font-medium text-gray-900 mb-1">Machine Learning in Production</h4>
                    <p className="text-xs text-gray-600">Best practices for deploying ML models...</p>
                  </Link>
                  <Link to="/blog/statistical-analysis-for-beginners" className="block border-l-4 border-purple-500 pl-4 hover:bg-gray-100 rounded-r-lg py-1 transition-colors">
                    <h4 className="text-sm font-medium text-gray-900 mb-1">Statistical Analysis for Beginners</h4>
                    <p className="text-xs text-gray-600">A comprehensive guide to statistics...</p>
                  </Link>
                </div>
              </div>

              {/* Newsletter Signup */}
              <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg p-6 mt-8 text-white">
                <h3 className="font-serif text-lg font-semibold mb-2">Stay Updated</h3>
                <p className="text-sm mb-4 opacity-90">
                  Get the latest insights on data science and analytics delivered to your inbox.
                </p>
                <div className="space-y-2">
                  <Input
                    type="email"
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="bg-white/90 text-gray-900 placeholder:text-gray-600"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleNewsletterSubscribe();
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={isSubscribing || !newsletterEmail.trim()}
                    onClick={handleNewsletterSubscribe}
                  >
                    {isSubscribing ? "Subscribing..." : "Subscribe to Newsletter"}
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default BlogPostLayout;
