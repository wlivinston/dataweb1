import React, { useEffect, useState, useMemo } from "react";
import { loadPostBySlug, loadPosts, type PostData } from "@/lib/loadPosts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const categoryColors: Record<string, string> = {
  "Data Engineering": "from-orange-100 to-amber-100",
  "Data Visualization": "from-blue-100 to-cyan-100",
  "Machine Learning": "from-purple-100 to-pink-100",
  "Real-time Analytics": "from-green-100 to-emerald-100",
  "Statistics": "from-indigo-100 to-blue-100",
  "Data Security": "from-red-100 to-rose-100",
  "Cloud Computing": "from-sky-100 to-blue-100",
  "SQL": "from-yellow-100 to-amber-100",
  "Dashboard Development": "from-teal-100 to-cyan-100",
  "Analytics": "from-blue-100 to-cyan-100",
};

const categoryIcons: Record<string, string> = {
  "Data Engineering": "🔧",
  "Data Visualization": "📊",
  "Machine Learning": "🤖",
  "Real-time Analytics": "⚡",
  "Statistics": "📈",
  "Data Security": "🔒",
  "Cloud Computing": "☁️",
  "SQL": "🗃️",
  "Dashboard Development": "📱",
  "Analytics": "📊",
};

// ─── Skeleton for blog list ─────────────────────────────────────────────────
const BlogSkeleton: React.FC = () => (
  <div className="animate-pulse">
    {/* Category filter bar skeleton */}
    <div className="flex flex-wrap justify-center gap-2 mb-12">
      {[80, 120, 100, 90, 110, 95].map((w, i) => (
        <div key={i} className="h-8 rounded-md bg-gray-200" style={{ width: w }} />
      ))}
    </div>

    {/* Featured posts skeleton (2-col) */}
    <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl shadow-md overflow-hidden bg-white">
          <div className="h-56 bg-gray-200" />
          <div className="p-6 space-y-3">
            <div className="h-4 w-20 bg-gray-200 rounded" />
            <div className="h-6 w-3/4 bg-gray-300 rounded" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-5/6 bg-gray-200 rounded" />
            <div className="flex justify-between mt-4">
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
            </div>
            <div className="h-9 w-full bg-gray-200 rounded-md mt-2" />
          </div>
        </div>
      ))}
    </div>

    {/* Regular posts skeleton (3-col) */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-xl shadow-md overflow-hidden bg-white">
          <div className="h-40 bg-gray-200" />
          <div className="p-5 space-y-3">
            <div className="h-4 w-20 bg-gray-200 rounded" />
            <div className="h-5 w-4/5 bg-gray-300 rounded" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="flex justify-between mt-3">
              <div className="h-3 w-24 bg-gray-200 rounded" />
              <div className="h-3 w-16 bg-gray-200 rounded" />
            </div>
            <div className="h-9 w-full bg-gray-200 rounded-md mt-2" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const Blog: React.FC = () => {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Load posts from markdown (localStorage-cached, then lazy-parsed).
        // Backend sync is intentionally omitted here — it runs only once per
        // session via the server's startup routine, keeping this path fast.
        const mdPosts = await loadPosts();
        if (mounted) setPosts(mdPosts);
      } catch (e) {
        console.error("Failed to load markdown posts:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(posts.map(p => p.category));
    return ["All", ...Array.from(cats)];
  }, [posts]);

  const filteredPosts = useMemo(() => {
    if (selectedCategory === "All") return posts;
    return posts.filter(p => p.category === selectedCategory);
  }, [posts, selectedCategory]);

  const featuredPosts = filteredPosts.filter(p => p.featured);
  const regularPosts = filteredPosts.filter(p => !p.featured);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const prefetchPostResources = (slug: string) => {
    // Warm markdown data and heavy post layout chunk before navigation.
    void loadPostBySlug(slug);
    void import("@/components/BlogPostLayout");
  };

  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Latest Insights
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Stay updated with the latest trends and best practices in data science
          </p>
        </div>

        {loading ? (
          <BlogSkeleton />
        ) : (
          <>
            {/* Category Filters */}
            <div className="flex flex-wrap justify-center gap-2 mb-12">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat)}
                  className={selectedCategory === cat ? "bg-green-600 hover:bg-green-700" : ""}
                >
                  {cat}
                </Button>
              ))}
            </div>

            {/* Featured Posts */}
            {featuredPosts.length > 0 && (
              <div className="mb-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {featuredPosts.map((post, index) => {
                    const gradient = categoryColors[post.category] || "from-gray-100 to-gray-200";
                    const icon = categoryIcons[post.category] || "📝";
                    const coverImage = post.coverImage?.trim();
                    const coverImageFit = post.coverImageFit === "contain" ? "contain" : "cover";
                    const coverImagePositionClass =
                      post.coverImagePosition === "top"
                        ? "object-top"
                        : post.coverImagePosition === "bottom"
                          ? "object-bottom"
                          : "object-center";
                    const coverImageClass =
                      coverImageFit === "contain"
                        ? "absolute inset-0 h-full w-full object-contain p-2 bg-white"
                        : `absolute inset-0 h-full w-full object-cover ${coverImagePositionClass}`;
                    return (
                      <Card key={index} className="hover:shadow-xl transition-all duration-300 border-0 shadow-md overflow-hidden">
                        <div className={`h-56 bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden`}>
                          <div className="text-7xl opacity-30">{icon}</div>
                          {coverImage && (
                            <img
                              src={coverImage}
                              alt={post.title}
                              className={coverImageClass}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                          <Badge className="absolute top-4 right-4 bg-gradient-to-r from-blue-600 to-purple-600">
                            Featured
                          </Badge>
                        </div>
                        <CardHeader>
                          <Badge variant="secondary" className="w-fit text-xs mb-2">
                            {post.category}
                          </Badge>
                          <CardTitle className="text-xl hover:text-blue-600 transition-colors">
                            {post.title}
                          </CardTitle>
                          <CardDescription className="text-gray-600 line-clamp-2">
                            {post.excerpt}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              {formatDate(post.date)}
                            </div>
                            <div className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              {post.readTime}
                            </div>
                          </div>
                          <Link
                            to={`/blog/${post.slug}`}
                            onMouseEnter={() => prefetchPostResources(post.slug)}
                            onFocus={() => prefetchPostResources(post.slug)}
                            onTouchStart={() => prefetchPostResources(post.slug)}
                          >
                            <Button variant="outline" className="w-full group">
                              Read More
                              <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                            </Button>
                          </Link>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regular Posts */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {regularPosts.map((post, index) => {
                const gradient = categoryColors[post.category] || "from-gray-100 to-gray-200";
                const icon = categoryIcons[post.category] || "📝";
                const coverImage = post.coverImage?.trim();
                const coverImageFit = post.coverImageFit === "contain" ? "contain" : "cover";
                const coverImagePositionClass =
                  post.coverImagePosition === "top"
                    ? "object-top"
                    : post.coverImagePosition === "bottom"
                      ? "object-bottom"
                      : "object-center";
                const coverImageClass =
                  coverImageFit === "contain"
                    ? "absolute inset-0 h-full w-full object-contain p-2 bg-white"
                    : `absolute inset-0 h-full w-full object-cover ${coverImagePositionClass}`;
                return (
                  <Card key={index} className="hover:shadow-lg transition-all duration-300 border-0 shadow-md overflow-hidden">
                    <div className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden`}>
                      <div className="text-5xl opacity-30">{icon}</div>
                      {coverImage && (
                        <img
                          src={coverImage}
                          alt={post.title}
                          className={coverImageClass}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    <CardHeader>
                      <Badge variant="secondary" className="w-fit text-xs mb-2">
                        {post.category}
                      </Badge>
                      <CardTitle className="text-lg hover:text-blue-600 transition-colors line-clamp-2">
                        {post.title}
                      </CardTitle>
                      <CardDescription className="text-gray-600 line-clamp-2">
                        {post.excerpt}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 mr-1" />
                          {formatDate(post.date)}
                        </div>
                        <div className="flex items-center">
                          <Clock className="h-4 w-4 mr-1" />
                          {post.readTime}
                        </div>
                      </div>
                      <Link
                        to={`/blog/${post.slug}`}
                        onMouseEnter={() => prefetchPostResources(post.slug)}
                        onFocus={() => prefetchPostResources(post.slug)}
                        onTouchStart={() => prefetchPostResources(post.slug)}
                      >
                        <Button variant="outline" className="w-full group">
                          Read More
                          <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default Blog;
