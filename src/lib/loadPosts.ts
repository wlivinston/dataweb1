// src/lib/loadPosts.ts
import { getApiUrl } from "@/lib/publicConfig";

export interface PostData {
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
  featured?: boolean;
  slug: string;
  content: string;
  author: string;
  qualification?: string;
  coverImage?: string;
  coverImageFit?: "cover" | "contain";
  coverImagePosition?: "center" | "top" | "bottom";
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/%20/g, " ")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDayTimestamp(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const isoDayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDayMatch) {
    const year = Number(isoDayMatch[1]);
    const month = Number(isoDayMatch[2]);
    const day = Number(isoDayMatch[3]);
    const utcDay = Date.UTC(year, month - 1, day);
    return Number.isNaN(utcDay) ? 0 : utcDay;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

function comparePostsByDateAndFeatured(
  a: Pick<PostData, "date" | "featured" | "title" | "slug">,
  b: Pick<PostData, "date" | "featured" | "title" | "slug">
): number {
  const byDateDesc = toDayTimestamp(b.date) - toDayTimestamp(a.date);
  if (byDateDesc !== 0) return byDateDesc;

  const byFeatured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
  if (byFeatured !== 0) return byFeatured;

  const aKey = String(a.title || a.slug || "");
  const bKey = String(b.title || b.slug || "");
  return aKey.localeCompare(bKey);
}

export async function loadPostsFromBackend(): Promise<PostData[]> {
  console.log("LOADING POSTS FROM BACKEND...");

  try {
    const response = await fetch(getApiUrl("/api/blog/posts"));

    if (!response.ok) {
      console.error(
        "Failed to fetch posts from backend:",
        response.status,
        response.statusText
      );
      // Fallback to static posts if backend fails
      return getStaticPosts();
    }

    const data = await response.json();
    console.log("Posts loaded:", data);

    if (data.posts && data.posts.length > 0) {
      return [...data.posts].sort((a: any, b: any) => {
        const byDateDesc =
          toDayTimestamp(b?.published_at ?? b?.date) -
          toDayTimestamp(a?.published_at ?? a?.date);
        if (byDateDesc !== 0) return byDateDesc;

        const byFeatured = Number(Boolean(b?.featured)) - Number(Boolean(a?.featured));
        if (byFeatured !== 0) return byFeatured;

        const aKey = String(a?.title || a?.slug || "");
        const bKey = String(b?.title || b?.slug || "");
        return aKey.localeCompare(bKey);
      });
    }

    console.log("No posts from backend, using static posts");
    return getStaticPosts();
  } catch (error) {
    console.error("Error loading posts from backend:", error);
    return getStaticPosts();
  }
}

// Fallback static posts
function getStaticPosts(): PostData[] {
  return [
    {
      title: "Building Scalable Data Pipelines",
      excerpt:
        "Learn how to design and implement robust data pipelines that can handle large-scale data processing with Apache Airflow and modern cloud technologies.",
      date: "2024-01-15",
      readTime: "8 min read",
      category: "Data Engineering",
      featured: true,
      slug: "building-scalable-data-pipelines",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
    {
      title: "Data Analytics and Visual Storytelling",
      excerpt:
        "Transform raw data into compelling visual narratives that drive business decisions using advanced visualization techniques.",
      date: "2024-01-10",
      readTime: "6 min read",
      category: "Data Visualization",
      featured: true,
      slug: "data-analytics-visual-storytelling",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
    {
      title: "Machine Learning in Production",
      excerpt:
        "Best practices for deploying and maintaining machine learning models in production environments.",
      date: "2024-01-08",
      readTime: "10 min read",
      category: "Machine Learning",
      featured: false,
      slug: "machine-learning-in-production",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
    {
      title: "Real-time Analytics with Apache Kafka",
      excerpt:
        "Build real-time data processing systems using Apache Kafka and stream processing technologies.",
      date: "2024-01-05",
      readTime: "12 min read",
      category: "Real-time Analytics",
      featured: false,
      slug: "real-time-analytics-with-kafka",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
    {
      title: "Statistical Analysis for Beginners",
      excerpt:
        "A comprehensive guide to statistical analysis techniques for data science beginners.",
      date: "2024-01-03",
      readTime: "15 min read",
      category: "Statistics",
      featured: false,
      slug: "statistical-analysis-for-beginners",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
    {
      title: "The Future of Machine Learning",
      excerpt:
        "Exploring emerging trends and technologies that will shape the future of machine learning.",
      date: "2024-01-01",
      readTime: "7 min read",
      category: "Machine Learning",
      featured: false,
      slug: "the-future-of-machine-learning",
      content: "Content will be loaded from markdown file...",
      author: "DataWeb Team",
    },
  ];
}

function calculateReadTime(text: string, wpm = 200): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const minutes = Math.max(1, Math.ceil(words.length / wpm));
  return `${minutes} min read`;
}

function slugFromPath(path: string): string {
  // Handle both Unix (/) and Windows (\) path separators
  const file = path.split(/[\/\\]/).pop() ?? path;
  return file.replace(/\.md$/i, "");
}

function parseFrontmatter(md: string): {
  data: Record<string, any>;
  content: string;
} {
  // Handle UTF-8 BOM + both LF/CRLF line endings so frontmatter is parsed reliably.
  const normalized = md.replace(/^\uFEFF/, "");
  const match = normalized.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/
  );
  if (!match) return { data: {}, content: normalized };

  const raw = match[1];
  const content = match[2];

  const data: Record<string, any> = {};
  raw.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === "true") data[key] = true;
    else if (value === "false") data[key] = false;
    else data[key] = value;
  });

  return { data, content };
}

const markdownModuleMap = import.meta.glob("../blogs/*.md", {
  query: "?raw",
  import: "default",
  eager: false,
});

const markdownEntries = Object.entries(markdownModuleMap) as Array<
  [string, () => Promise<unknown>]
>;

const markdownPathBySlugKey = (() => {
  const index = new Map<string, string>();

  for (const [path] of markdownEntries) {
    const slug = slugFromPath(path);
    const normalizedSlug = normalizeSlug(slug);

    for (const key of [slug, slug.toLowerCase(), normalizedSlug]) {
      if (key && !index.has(key)) {
        index.set(key, path);
      }
    }
  }

  return index;
})();

function toPostData(path: string, rawMd: string): PostData {
  const slug = slugFromPath(path);
  const { data, content } = parseFrontmatter(rawMd);
  const coverImage =
    data.coverImage ??
    data.cover_image ??
    data.image ??
    data.thumbnail ??
    data.heroImage ??
    "";
  const coverImageFitRaw =
    data.coverImageFit ??
    data.cover_image_fit ??
    data.imageFit ??
    data.coverFit ??
    "cover";
  const coverImageFit =
    String(coverImageFitRaw || "")
      .trim()
      .toLowerCase() === "contain"
      ? "contain"
      : "cover";
  const coverImagePositionRaw =
    data.coverImagePosition ??
    data.cover_image_position ??
    data.imagePosition ??
    data.coverPosition ??
    "center";
  const normalizedPosition = String(coverImagePositionRaw || "")
    .trim()
    .toLowerCase();
  const coverImagePosition =
    normalizedPosition === "top"
      ? "top"
      : normalizedPosition === "bottom"
        ? "bottom"
        : "center";

  return {
    title: data.title ?? slug,
    excerpt: data.excerpt ?? "",
    date: data.date ?? "1970-01-01",
    category: data.category ?? "General",
    featured: Boolean(data.featured),
    slug,
    content,
    author: data.author ?? "DataWeb Team",
    qualification: data.qualification,
    coverImage: String(coverImage || "").trim() || undefined,
    coverImageFit,
    coverImagePosition,
    readTime: calculateReadTime(content),
  };
}

// localStorage cache
const LS_KEY = "dataafrik_blog_posts_v2";
const LS_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

interface CacheEntry {
  posts: PostData[];
  ts: number; // epoch ms when cached
}

function readCache(): PostData[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > LS_TTL) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return entry.posts;
  } catch {
    return null;
  }
}

function writeCache(posts: PostData[]): void {
  try {
    const entry: CacheEntry = { posts, ts: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable - silently skip
  }
}

// In-memory cache (survives within a single page session)
let memCached: PostData[] | null = null;

// PRIMARY loader - Markdown is source of truth (path relative to this file: src/lib -> src/blogs)
export async function loadPosts(): Promise<PostData[]> {
  // 1. Return in-memory cache immediately (fastest - no parsing, no I/O)
  if (memCached && !import.meta.env.DEV) return memCached;

  // 2. Return localStorage cache (survives page refresh, still instant)
  if (!import.meta.env.DEV) {
    const lsCached = readCache();
    if (lsCached) {
      memCached = lsCached;
      return lsCached;
    }
  }

  // 3. Parse markdown files lazily so they are NOT bundled into the main chunk
  // Load all modules in parallel for speed.
  const entries = await Promise.all(
    markdownEntries.map(async ([path, loader]) => {
      const rawMd = (await loader()) as string;
      return { path, rawMd };
    })
  );

  const posts: PostData[] = entries
    .filter(({ path }) => path.includes("blogs") && path.endsWith(".md"))
    .map(({ path, rawMd }) => toPostData(path, rawMd));

  posts.sort(comparePostsByDateAndFeatured);

  // Store in both caches
  memCached = posts;
  writeCache(posts);

  return posts;
}

// Single post helper (used by /blog/:slug)
export async function loadPostBySlug(slug: string): Promise<PostData | null> {
  const rawSlug = decodeURIComponent(slug);
  const normalizedParamSlug = normalizeSlug(rawSlug);

  const matchedPath =
    markdownPathBySlugKey.get(rawSlug) ??
    markdownPathBySlugKey.get(rawSlug.toLowerCase()) ??
    markdownPathBySlugKey.get(normalizedParamSlug) ??
    null;

  if (matchedPath) {
    const loader = markdownModuleMap[matchedPath];
    if (loader) {
      try {
        const rawMd = (await loader()) as string;
        return toPostData(matchedPath, rawMd);
      } catch (error) {
        console.error(`Failed loading post markdown for slug "${slug}"`, error);
      }
    }
  }

  // Safe fallback if slug map misses (e.g., unusual filename edge-case)
  const posts = await loadPosts();

  return (
    posts.find((p) => p.slug === rawSlug) ??
    posts.find((p) => p.slug.toLowerCase() === rawSlug.toLowerCase()) ??
    posts.find((p) => normalizeSlug(p.slug) === normalizedParamSlug) ??
    null
  );
}
