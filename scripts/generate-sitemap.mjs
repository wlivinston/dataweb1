import fs from "node:fs";
import path from "node:path";

const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || "https://www.dataafrik.com").replace(
  /\/+$/,
  ""
);

const ROOT = process.cwd();
const BLOGS_DIR = path.join(ROOT, "src", "blogs");
const SITEMAP_PATH = path.join(ROOT, "public", "sitemap.xml");
const TODAY = new Date().toISOString().slice(0, 10);

const staticRoutes = [
  "/",
  "/analyze",
  "/finance",
  "/blog",
  "/pricing",
  "/request-report",
  "/cookie-policy",
];

const getBlogRoutes = () => {
  if (!fs.existsSync(BLOGS_DIR)) return [];
  return fs
    .readdirSync(BLOGS_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith(".md"))
    .map((fileName) => fileName.replace(/\.md$/i, ""))
    .map((slug) => `/blog/${encodeURIComponent(slug)}`);
};

const priorityForRoute = (route) => {
  if (route === "/") return "1.0";
  if (route === "/blog") return "0.9";
  if (route.startsWith("/blog/")) return "0.8";
  return "0.7";
};

const changeFreqForRoute = (route) => {
  if (route === "/") return "weekly";
  if (route === "/blog") return "daily";
  if (route.startsWith("/blog/")) return "weekly";
  return "monthly";
};

const toUrlTag = (route) => {
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const loc = `${SITE_URL}${normalizedRoute}`;
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    `    <lastmod>${TODAY}</lastmod>`,
    `    <changefreq>${changeFreqForRoute(normalizedRoute)}</changefreq>`,
    `    <priority>${priorityForRoute(normalizedRoute)}</priority>`,
    "  </url>",
  ].join("\n");
};

const routes = Array.from(new Set([...staticRoutes, ...getBlogRoutes()]));

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map(toUrlTag),
  "</urlset>",
  "",
].join("\n");

fs.writeFileSync(SITEMAP_PATH, xml, "utf8");
console.log(`Sitemap generated at ${SITEMAP_PATH} (${routes.length} URLs).`);
