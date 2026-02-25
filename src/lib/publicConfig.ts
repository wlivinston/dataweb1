const normalizeUrl = (value: string | undefined): string => {
  const trimmed = (value || "").trim();
  return trimmed.replace(/\/+$/, "");
};

let hasWarnedMissingBackendUrl = false;
const apiVersionRaw = String(import.meta.env.VITE_API_VERSION || '').trim().toLowerCase();
const apiVersion = apiVersionRaw === 'v1' ? 'v1' : '';

export const PUBLIC_CONFIG = {
  brandName: (import.meta.env.VITE_BRAND_NAME || "DataAfrik").trim(),
  logoUrl: (import.meta.env.VITE_LOGO_URL || "/images/logo.png").trim(),
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL || "senyo@diaspora-n.com").trim(),
  linkedinUrl: (import.meta.env.VITE_LINKEDIN_URL || "").trim(),
  githubUrl: (import.meta.env.VITE_GITHUB_URL || "").trim(),
  phoneGh: (import.meta.env.VITE_PHONE_GH || "").trim(),
  phoneUs: (import.meta.env.VITE_PHONE_US || "").trim(),
  locationText: (import.meta.env.VITE_LOCATION_TEXT || "").trim(),
  backendUrl: normalizeUrl(import.meta.env.VITE_BACKEND_URL),
  apiVersion,
};

const applyApiVersion = (path: string): string => {
  if (!PUBLIC_CONFIG.apiVersion) return path;
  if (path === '/api') return `/api/${PUBLIC_CONFIG.apiVersion}`;
  if (path.startsWith('/api/v1/')) return path;
  if (path.startsWith('/api/')) return `/api/${PUBLIC_CONFIG.apiVersion}${path.slice(4)}`;
  return path;
};

export function getApiUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  const resolvedPath = applyApiVersion(path);
  if (!PUBLIC_CONFIG.backendUrl) {
    if (
      !hasWarnedMissingBackendUrl &&
      typeof window !== "undefined" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      hasWarnedMissingBackendUrl = true;
      console.error(
        "[publicConfig] Missing VITE_BACKEND_URL in frontend env. API calls will hit the frontend origin and may return HTML instead of JSON."
      );
    }
    return resolvedPath;
  }
  return `${PUBLIC_CONFIG.backendUrl}${resolvedPath}`;
}

export function createSupportMailto(subject: string, body: string): string {
  const safeSubject = encodeURIComponent(subject);
  const safeBody = encodeURIComponent(body);
  return `mailto:${PUBLIC_CONFIG.supportEmail}?subject=${safeSubject}&body=${safeBody}`;
}
