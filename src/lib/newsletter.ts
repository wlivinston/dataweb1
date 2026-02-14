import { getApiUrl } from "@/lib/publicConfig";
import { supabase } from "@/lib/supabase";

interface NewsletterPayload {
  email?: string;
  first_name?: string;
  last_name?: string;
  source?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function subscribeToNewsletter(payload: NewsletterPayload): Promise<void> {
  if (!supabase) {
    throw new Error("Authentication is unavailable right now.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;
  const sessionEmail = normalizeEmail(session?.user?.email || "");
  if (!token || !sessionEmail) {
    throw new Error("Please log in to subscribe to the newsletter.");
  }

  const email = normalizeEmail(payload.email || sessionEmail);
  if (!email) {
    throw new Error("Email is required.");
  }

  const response = await fetch(getApiUrl("/api/subscriptions/newsletter"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: sessionEmail,
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
