const normalizeUrl = (value: string | undefined): string => {
  const trimmed = (value || "").trim();
  return trimmed.replace(/\/+$/, "");
};

export const PUBLIC_CONFIG = {
  brandName: (import.meta.env.VITE_BRAND_NAME || "DataAfrik").trim(),
  logoUrl: (import.meta.env.VITE_LOGO_URL || "").trim(),
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL || "support@example.com").trim(),
  linkedinUrl: (import.meta.env.VITE_LINKEDIN_URL || "").trim(),
  githubUrl: (import.meta.env.VITE_GITHUB_URL || "").trim(),
  phoneGh: (import.meta.env.VITE_PHONE_GH || "").trim(),
  phoneUs: (import.meta.env.VITE_PHONE_US || "").trim(),
  locationText: (import.meta.env.VITE_LOCATION_TEXT || "").trim(),
  backendUrl: normalizeUrl(import.meta.env.VITE_BACKEND_URL),
};

export function getApiUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  if (!PUBLIC_CONFIG.backendUrl) return path;
  return `${PUBLIC_CONFIG.backendUrl}${path}`;
}

export function createSupportMailto(subject: string, body: string): string {
  const safeSubject = encodeURIComponent(subject);
  const safeBody = encodeURIComponent(body);
  return `mailto:${PUBLIC_CONFIG.supportEmail}?subject=${safeSubject}&body=${safeBody}`;
}
