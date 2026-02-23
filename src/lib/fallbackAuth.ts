import type { Session, User } from '@supabase/supabase-js'

const FALLBACK_AUTH_STORAGE_KEY = 'dataafrik_fallback_auth_v1'
export const FALLBACK_AUTH_CHANGED_EVENT = 'dataafrik:fallback-auth-changed'

interface FallbackAuthPayload {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_at?: number
  expires_in?: number
  user?: Record<string, unknown> | null
}

interface StoredFallbackAuth extends FallbackAuthPayload {
  saved_at: number
}

const toNumber = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeUser = (rawUser: Record<string, unknown> | null | undefined): User => {
  const user = rawUser && typeof rawUser === 'object' ? rawUser : {}
  const id = typeof user.id === 'string' && user.id.trim() ? user.id.trim() : 'fallback-user'
  const email = typeof user.email === 'string' ? user.email : null
  const app_metadata =
    user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {}
  const user_metadata =
    user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {}

  return {
    id,
    aud: typeof user.aud === 'string' ? user.aud : 'authenticated',
    role: typeof user.role === 'string' ? user.role : 'authenticated',
    email,
    app_metadata,
    user_metadata,
    identities: Array.isArray(user.identities) ? user.identities : [],
    created_at: typeof user.created_at === 'string' ? user.created_at : new Date().toISOString(),
    updated_at: typeof user.updated_at === 'string' ? user.updated_at : new Date().toISOString(),
  } as unknown as User
}

const createSessionFromStored = (stored: StoredFallbackAuth): Session | null => {
  const accessToken = String(stored.access_token || '').trim()
  if (!accessToken) return null

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = toNumber(stored.expires_at) ?? nowSeconds + 3600
  const expiresIn = Math.max(0, (toNumber(stored.expires_in) ?? expiresAt - nowSeconds))

  return {
    access_token: accessToken,
    refresh_token: String(stored.refresh_token || ''),
    token_type: String(stored.token_type || 'bearer'),
    expires_in: expiresIn,
    expires_at: expiresAt,
    user: normalizeUser(stored.user ?? null),
  } as unknown as Session
}

const notifyFallbackAuthChanged = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FALLBACK_AUTH_CHANGED_EVENT))
}

export const saveFallbackAuth = (payload: FallbackAuthPayload) => {
  if (typeof window === 'undefined') return
  try {
    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) return

    const stored: StoredFallbackAuth = {
      access_token: accessToken,
      refresh_token: String(payload.refresh_token || ''),
      token_type: String(payload.token_type || 'bearer'),
      expires_at: toNumber(payload.expires_at) ?? undefined,
      expires_in: toNumber(payload.expires_in) ?? undefined,
      user: payload.user ?? null,
      saved_at: Date.now(),
    }
    window.localStorage.setItem(FALLBACK_AUTH_STORAGE_KEY, JSON.stringify(stored))
    notifyFallbackAuthChanged()
  } catch {
    // ignore localStorage failures
  }
}

export const clearFallbackAuth = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(FALLBACK_AUTH_STORAGE_KEY)
    notifyFallbackAuthChanged()
  } catch {
    // ignore localStorage failures
  }
}

export const readFallbackAuthState = (): { session: Session; user: User } | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(FALLBACK_AUTH_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as StoredFallbackAuth
    const session = createSessionFromStored(parsed)
    if (!session?.access_token) return null

    // If expiry is clearly in the past, drop stale fallback session.
    const expiresAt = toNumber(parsed.expires_at)
    if (expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000)) {
      clearFallbackAuth()
      return null
    }

    return { session, user: session.user as User }
  } catch {
    return null
  }
}
