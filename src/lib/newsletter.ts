import { getApiUrl } from "@/lib/publicConfig";

interface NewsletterPayload {
  email: string;
  first_name?: string;
  last_name?: string;
  source?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function subscribeToNewsletter(payload: NewsletterPayload): Promise<void> {
  const email = normalizeEmail(payload.email);
  if (!email) {
    throw new Error("Email is required.");
  }

  const response = await fetch(getApiUrl("/api/subscriptions/newsletter"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      first_name: payload.first_name?.trim() || undefined,
      last_name: payload.last_name?.trim() || undefined,
      source: payload.source || "website",
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data?.error || data?.message || "Failed to subscribe to newsletter.";
    throw new Error(message);
  }
}

