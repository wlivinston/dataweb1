import React, { useState, useMemo } from "react";
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
import { toast } from "sonner";
import BlogComments from "@/components/BlogComments";
import { useAuth } from "@/hooks/useAuth";

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
}

interface BlogPostLayoutProps {
  post: BlogPostLayoutData;
  backendPostId?: string | number | null;
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

const BlogPostLayout: React.FC<BlogPostLayoutProps> = ({ post, backendPostId = null }) => {
  const { user } = useAuth();
  const [likes, setLikes] = useState(0);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [isSubscribing, setIsSubscribing] = useState(false);

  const headings = useMemo(() => extractHeadings(post.content), [post.content]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleLike = () => {
    setLikes(prev => prev + 1);
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
    if (!user) {
      toast.error("Please create an account or log in to subscribe to the newsletter.");
      return;
    }

    const emailToUse = user.email || "";
    if (!emailToUse) {
      toast.error("Unable to determine your account email.");
      return;
    }

    setIsSubscribing(true);
    try {
      const result = await subscribeToNewsletter({
        email: emailToUse,
        source: "blog-sidebar",
      });
      if (result.emailSent === false) {
        toast.success("Subscribed successfully, but confirmation email could not be sent yet.");
      } else {
        toast.success(result.message || "You are subscribed. Check your inbox for confirmation.");
      }
      setNewsletterEmail("");
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
                  img: ({ node, src, alt, ...props }) => {
                    if (!src) return null;
                    return (
                      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={src}
                          alt={alt || "Article image"}
                          {...props}
                          className={`cursor-zoom-in ${props.className || ""}`.trim()}
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
                    className="flex items-center gap-2"
                  >
                    <Heart className="h-4 w-4" />
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
                  {post.qualification && <> &mdash; {post.qualification}</>}.{' '}
                  A data science professional with expertise in analytics,
                  machine learning, and business intelligence. Passionate about turning complex data into
                  actionable insights to help organizations make data-driven decisions.
                </p>
              </div>
            </div>

            {/* Report CTA */}
            <div className="mt-8">
              <RequestReportCTA />
            </div>

            {/* Comments */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              {backendPostId !== null && String(backendPostId).trim() !== "" ? (
                <BlogComments postId={backendPostId} postSlug={post.slug || ""} />
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Comments are unavailable for this article until it is synced in the backend `blog_posts` table.
                </div>
              )}
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
                    value={user?.email ?? newsletterEmail}
                    onChange={(e) => {
                      if (!user) setNewsletterEmail(e.target.value);
                    }}
                    placeholder={user ? "Logged in account email" : "Log in to subscribe"}
                    className="bg-white/90 text-gray-900 placeholder:text-gray-600"
                    disabled={!user}
                    readOnly={Boolean(user)}
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
                    disabled={isSubscribing || !user}
                    onClick={handleNewsletterSubscribe}
                  >
                    {isSubscribing
                      ? "Subscribing..."
                      : user
                      ? "Subscribe to Newsletter"
                      : "Login to Subscribe"}
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
