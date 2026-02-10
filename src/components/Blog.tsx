import React, { useEffect, useState, useMemo } from "react";
import type { PostData } from "@/lib/loadPosts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

function calculateReadTime(text: string, wpm = 200): string {
  const wordCount = text.split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(wordCount / wpm));
  return `${minutes} min read`;
}

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
};

const Blog: React.FC = () => {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  useEffect(() => {
    const staticPosts: PostData[] = [
      {
        title: "Building Scalable Data Pipelines",
        excerpt: "Learn how to design and implement robust data pipelines that can handle large-scale data processing with Apache Airflow and modern cloud technologies.",
        date: "2024-01-15",
        readTime: "8 min read",
        category: "Data Engineering",
        featured: true,
        slug: "building-scalable-data-pipelines",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Data Analytics and Visual Storytelling",
        excerpt: "Transform raw data into compelling visual narratives that drive business decisions using advanced visualization techniques.",
        date: "2024-01-10",
        readTime: "6 min read",
        category: "Data Visualization",
        featured: true,
        slug: "data-analytics-visual-storytelling",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Machine Learning in Production",
        excerpt: "Best practices for deploying and maintaining machine learning models in production environments.",
        date: "2024-01-08",
        readTime: "10 min read",
        category: "Machine Learning",
        featured: false,
        slug: "machine-learning-in-production",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Real-time Analytics with Apache Kafka",
        excerpt: "Build real-time data processing systems using Apache Kafka and stream processing technologies.",
        date: "2024-01-05",
        readTime: "12 min read",
        category: "Real-time Analytics",
        featured: false,
        slug: "real-time-analytics-with-kafka",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Statistical Analysis for Beginners",
        excerpt: "A comprehensive guide to statistical analysis techniques for data science beginners.",
        date: "2024-01-03",
        readTime: "15 min read",
        category: "Statistics",
        featured: false,
        slug: "statistical-analysis-for-beginners",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "The Future of Machine Learning",
        excerpt: "Exploring emerging trends and technologies that will shape the future of machine learning.",
        date: "2024-01-01",
        readTime: "7 min read",
        category: "Machine Learning",
        featured: false,
        slug: "the-future-of-machine-learning",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Data Privacy and Security in Analytics",
        excerpt: "Best practices for protecting sensitive data while maintaining analytical capabilities in modern data environments.",
        date: "2023-12-28",
        readTime: "9 min read",
        category: "Data Security",
        featured: false,
        slug: "data-privacy-security-analytics",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Cloud Data Warehousing Strategies",
        excerpt: "Comprehensive guide to designing and implementing cloud-based data warehousing solutions for modern businesses.",
        date: "2023-12-25",
        readTime: "11 min read",
        category: "Cloud Computing",
        featured: false,
        slug: "cloud-data-warehousing-strategies",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Advanced SQL Techniques for Data Analysis",
        excerpt: "Master advanced SQL techniques including window functions, CTEs, and complex joins for sophisticated data analysis.",
        date: "2023-12-22",
        readTime: "13 min read",
        category: "SQL",
        featured: false,
        slug: "advanced-sql-techniques-data-analysis",
        content: "",
        author: "DataAfrik Team"
      },
      {
        title: "Building Real-time Dashboards",
        excerpt: "Learn how to create dynamic, real-time dashboards that provide instant insights into your business metrics.",
        date: "2023-12-20",
        readTime: "8 min read",
        category: "Dashboard Development",
        featured: false,
        slug: "building-real-time-dashboards",
        content: "",
        author: "DataAfrik Team"
      }
    ];
    setPosts(staticPosts);
    setLoading(false);
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

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading blog posts...</p>
          </div>
        ) : (
          <>
            {/* Featured Posts */}
            {featuredPosts.length > 0 && (
              <div className="mb-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {featuredPosts.map((post, index) => {
                    const gradient = categoryColors[post.category] || "from-gray-100 to-gray-200";
                    const icon = categoryIcons[post.category] || "📝";
                    return (
                      <Card key={index} className="hover:shadow-xl transition-all duration-300 border-0 shadow-md overflow-hidden">
                        <div className={`h-56 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                          <div className="text-7xl opacity-30">{icon}</div>
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
                          <Link to={`/blog/${post.slug}`}>
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
                return (
                  <Card key={index} className="hover:shadow-lg transition-all duration-300 border-0 shadow-md overflow-hidden">
                    <div className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                      <div className="text-5xl opacity-30">{icon}</div>
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
                      <Link to={`/blog/${post.slug}`}>
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
