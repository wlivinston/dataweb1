import { useEffect } from "react";

const SITE_NAME = "DataAfrik";
const DEFAULT_SITE_URL = "https://www.dataafrik.com";
const DEFAULT_TITLE = "DataAfrik | AI-Powered Data Analytics and Finance Insights";
const DEFAULT_DESCRIPTION =
  "DataAfrik provides AI-powered data analytics, finance intelligence, and professional reporting tools for teams and individuals.";
const DEFAULT_IMAGE_PATH = "/images/logo.png";

type SeoMetaProps = {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | null;
};

function normalizeBaseUrl(value?: string): string {
  if (!value) return DEFAULT_SITE_URL;
  return value.replace(/\/+$/, "");
}

function toAbsoluteUrl(baseUrl: string, value: string): string {
  if (!value) return `${baseUrl}/`;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return `${baseUrl}${normalized}`;
}

function withBrand(title?: string): string {
  if (!title || !title.trim()) return DEFAULT_TITLE;
  if (title.toLowerCase().includes("dataafrik")) return title;
  return `${title} | DataAfrik`;
}

function upsertMetaTag(attrName: "name" | "property", attrValue: string, content: string): void {
  let element = document.head.querySelector(`meta[${attrName}="${attrValue}"]`) as
    | HTMLMetaElement
    | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attrName, attrValue);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertCanonical(url: string): void {
  let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", url);
}

function upsertJsonLd(payload: Record<string, unknown> | null | undefined): void {
  const existing = document.getElementById("seo-jsonld");
  if (!payload) {
    if (existing) existing.remove();
    return;
  }

  let script = existing as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = "seo-jsonld";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.text = JSON.stringify(payload);
}

export default function SeoMeta({
  title,
  description,
  path,
  image,
  type = "website",
  noindex = false,
  jsonLd,
}: SeoMetaProps) {
  useEffect(() => {
    const siteUrl = normalizeBaseUrl(import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL);
    const resolvedTitle = withBrand(title);
    const resolvedDescription = description?.trim() || DEFAULT_DESCRIPTION;
    const resolvedPath = path || window.location.pathname || "/";
    const canonicalUrl = toAbsoluteUrl(siteUrl, resolvedPath);
    const imageUrl = toAbsoluteUrl(siteUrl, image || DEFAULT_IMAGE_PATH);
    const robotsContent = noindex ? "noindex, nofollow" : "index, follow";

    document.title = resolvedTitle;

    upsertMetaTag("name", "description", resolvedDescription);
    upsertMetaTag("name", "robots", robotsContent);
    upsertMetaTag("name", "googlebot", robotsContent);

    upsertMetaTag("property", "og:site_name", SITE_NAME);
    upsertMetaTag("property", "og:title", resolvedTitle);
    upsertMetaTag("property", "og:description", resolvedDescription);
    upsertMetaTag("property", "og:type", type);
    upsertMetaTag("property", "og:url", canonicalUrl);
    upsertMetaTag("property", "og:image", imageUrl);

    upsertMetaTag("name", "twitter:card", "summary_large_image");
    upsertMetaTag("name", "twitter:title", resolvedTitle);
    upsertMetaTag("name", "twitter:description", resolvedDescription);
    upsertMetaTag("name", "twitter:image", imageUrl);

    upsertCanonical(canonicalUrl);
    upsertJsonLd(jsonLd);
  }, [description, image, jsonLd, noindex, path, title, type]);

  return null;
}
