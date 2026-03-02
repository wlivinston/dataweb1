import { getApiUrl } from "./publicConfig";

export class ApiError extends Error {
  public code: string;
  public status: number;
  public details: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Fetch wrapper that handles the v1 API envelope format.
 * Automatically unwraps `{ success: true, data: T }` responses
 * and throws `ApiError` for `{ success: false, error: {...} }` responses.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(getApiUrl(path), options);
  const json = await response.json();

  if (!response.ok || json.success === false) {
    const err = json.error || {};
    throw new ApiError(
      err.code || "UNKNOWN",
      err.message || "Request failed",
      response.status,
      err.details
    );
  }

  // If the response has a data property, return it; otherwise return the whole json
  // (handles edge cases like health checks that may not use the envelope)
  return (json.data !== undefined ? json.data : json) as T;
}
