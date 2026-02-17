import { getApiUrl } from "@/lib/publicConfig";
import { supabase } from "@/lib/supabase";

interface NewsletterPayload {
  email?: string;
  first_name?: string;
  last_name?: string;
  source?: string;
}

export interface NewsletterSubscribeResult {
  message: string;
  emailSent: boolean | null;
  alreadySubscribed?: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function subscribeToNewsletter(payload: NewsletterPayload): Promise<NewsletterSubscribeResult> {
  const {
    data: { session },
  } = supabase ? await supabase.auth.getSession() : { data: { session: null } };

  const token = session?.access_token || null;
  const sessionEmail = normalizeEmail(session?.user?.email || "");

  const email = normalizeEmail(payload.email || sessionEmail);
  if (!email) {
    throw new Error("Email is required.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(getApiUrl("/api/subscriptions/newsletter"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      first_name: payload.first_name?.trim() || undefined,
      last_name: payload.last_name?.trim() || undefined,
      source: payload.source || "website",
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const validationMessage =
      Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors
            .map((entry: { msg?: string }) => entry?.msg)
            .filter(Boolean)
            .join(" ")
        : null;
    const message = validationMessage || data?.error || data?.message || "Failed to subscribe to newsletter.";
    const alreadySubscribed =
      Boolean(data?.already_subscribed) ||
      /already subscribed/i.test(String(message || ""));
    if (alreadySubscribed) {
      return {
        message,
        emailSent: false,
        alreadySubscribed: true,
      };
    }
    throw new Error(message);
  }

  const data = await response.json().catch(() => null);
  return {
    message: data?.message || "Newsletter subscription successful.",
    emailSent: typeof data?.email_sent === "boolean" ? data.email_sent : null,
    alreadySubscribed: Boolean(data?.already_subscribed),
  };
}
