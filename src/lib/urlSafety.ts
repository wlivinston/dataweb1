/**
 * URL safety utilities to prevent open-redirect and javascript: protocol XSS attacks.
 */

const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

const TRUSTED_CHECKOUT_HOSTS = new Set([
  'checkout.stripe.com',
  'checkout.paystack.com',
  'paystack.com',
  'api.paystack.co',
]);

/**
 * Returns true if `url` uses a safe protocol (http/https/mailto).
 * Blocks javascript:, data:, vbscript:, etc.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validates a payment checkout URL from a backend response.
 * Must be HTTPS and on a trusted payment processor domain.
 */
export function isValidCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return TRUSTED_CHECKOUT_HOSTS.has(host) ||
      host.endsWith('.stripe.com') ||
      host.endsWith('.paystack.com');
  } catch {
    return false;
  }
}

/**
 * Sanitizes a user-supplied URL for use in href attributes.
 * Returns the URL if safe, or '#' if potentially dangerous.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (!trimmed) return '#';
  // Allow protocol-relative URLs that are http/https
  if (trimmed.startsWith('//')) return trimmed;
  return isSafeUrl(trimmed) ? trimmed : '#';
}
