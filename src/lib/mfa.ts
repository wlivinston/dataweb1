// Two-factor sign-in (TOTP authenticator apps, through Supabase Auth MFA).
//
// After the password, Supabase issues a session whose token says
// `aal: "aal1"`. Entering a code from the authenticator app upgrades it to
// `aal2`. A user who turned two-factor on is **not signed in** until then: the
// backend refuses an aal1 token for them (backend/modules/security/mfa.js,
// which applies the same rule as `assuranceOf` below), and the app shows the
// code prompt (TwoFactorGate) instead of the page.
//
// The browser cannot always reach Supabase directly (Login.tsx has a backend
// sign-in fallback for that), so verifying a code falls back the same way.

import type { Factor, Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getApiUrl } from './publicConfig'
import { saveFallbackAuth } from './fallbackAuth'

export interface Assurance {
  /** The user turned two-factor sign-in on. */
  required: boolean
  /** What the current token proves. */
  aal: 'aal1' | 'aal2'
  /** The session is enough to use the app. */
  satisfied: boolean
}

/** The claims of a JWT, or null when it is not one. Does not verify. */
export const tokenClaims = (token: unknown): Record<string, unknown> | null => {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

/** Factors that finished enrolment. An abandoned enrolment protects nothing. */
export const verifiedFactors = (user: Pick<User, 'factors'> | null | undefined): Factor[] =>
  (Array.isArray(user?.factors) ? user!.factors! : []).filter((factor) => factor?.status === 'verified')

export const verifiedTotpFactors = (user: Pick<User, 'factors'> | null | undefined): Factor[] =>
  verifiedFactors(user).filter((factor) => factor.factor_type === 'totp')

/** Whether this session is enough for its user. Mirrors the backend rule. */
export const assuranceOf = (session: Pick<Session, 'access_token' | 'user'> | null | undefined): Assurance => {
  const required = verifiedFactors(session?.user).length > 0
  const aal = tokenClaims(session?.access_token)?.aal === 'aal2' ? 'aal2' : 'aal1'
  return { required, aal, satisfied: !required || aal === 'aal2' }
}

export const isSixDigitCode = (code: string): boolean => /^\d{6}$/.test(code)

/** Strip what people paste with a code: spaces, dashes. */
export const normalizeCode = (raw: string): string => raw.replace(/[\s-]/g, '')

const DIRECT_TIMEOUT_MS = 10000

const withTimeout = async <T,>(operation: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MFA_TIMEOUT')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const isUnreachable = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message === 'MFA_TIMEOUT' || /fetch|network/i.test(message)
}

const friendlyVerifyError = (message: string): string => {
  if (/invalid|expired|code/i.test(message)) return 'That code is not right, or it has expired. Try the current one.'
  if (/rate|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.'
  return message || 'The code could not be checked. Try again.'
}

/** Verify through the backend, for when the browser cannot reach Supabase. */
const verifyViaBackend = async (accessToken: string, factorId: string, code: string): Promise<void> => {
  const response = await fetch(getApiUrl('/api/v1/auth/supabase/mfa/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ factorId, code }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json?.error?.message || 'The code could not be checked. Try again.')
  const upgraded = json?.data || {}
  if (typeof upgraded.access_token !== 'string' || typeof upgraded.refresh_token !== 'string') {
    throw new Error('The code was accepted but no session came back. Sign in again.')
  }
  try {
    const { error } = await withTimeout(
      supabase!.auth.setSession({ access_token: upgraded.access_token, refresh_token: upgraded.refresh_token }),
      8000
    )
    if (!error) return
  } catch {
    // Same as the sign-in fallback: keep the session locally instead.
  }
  saveFallbackAuth(upgraded)
}

/**
 * Check a code for the current session's factor and upgrade it to aal2.
 * Resolves when the session has been replaced; throws a user-facing message.
 */
export const verifySignInCode = async (session: Session, factorId: string, rawCode: string): Promise<void> => {
  const code = normalizeCode(rawCode)
  if (!isSixDigitCode(code)) throw new Error('Enter the 6 digits shown in your authenticator app.')
  if (!supabase) throw new Error('Sign-in is not available right now.')

  try {
    const { error } = await withTimeout(supabase.auth.mfa.challengeAndVerify({ factorId, code }), DIRECT_TIMEOUT_MS)
    if (!error) return
    if (!isUnreachable(error)) throw new Error(friendlyVerifyError(error.message))
  } catch (error) {
    if (!isUnreachable(error)) throw error instanceof Error ? error : new Error(String(error))
  }
  await verifyViaBackend(session.access_token, factorId, code)
}

/* ------------------------------ Enrolment ------------------------------ */

export interface PendingEnrollment {
  factorId: string
  /** An SVG data URI of the QR code. */
  qrCode: string
  /** The same secret as text, for typing into an app by hand. */
  secret: string
}

const requireClient = () => {
  if (!supabase) throw new Error('Sign-in is not available right now.')
  return supabase
}

/** The user's verified authenticator apps. */
export const listAuthenticators = async (): Promise<Factor[]> => {
  const { data, error } = await requireClient().auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  return (data?.totp ?? []).filter((factor) => factor.status === 'verified')
}

/**
 * Start adding an authenticator app. An earlier enrolment that was never
 * finished is removed first: Supabase refuses a second one under the same name.
 */
export const startEnrollment = async (): Promise<PendingEnrollment> => {
  const client = requireClient()
  const { data: listed } = await client.auth.mfa.listFactors()
  for (const factor of listed?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      await client.auth.mfa.unenroll({ factorId: factor.id })
    }
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  })
  if (error || !data) throw new Error(error?.message || 'Could not start setting up the authenticator.')
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Finish adding it: the first code proves the app holds the secret. */
export const finishEnrollment = async (factorId: string, rawCode: string): Promise<void> => {
  const code = normalizeCode(rawCode)
  if (!isSixDigitCode(code)) throw new Error('Enter the 6 digits shown in your authenticator app.')
  const { error } = await requireClient().auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw new Error(friendlyVerifyError(error.message))
}

/** Remove an authenticator. Supabase allows this only from an aal2 session. */
export const removeAuthenticator = async (factorId: string): Promise<void> => {
  const client = requireClient()
  const { error } = await client.auth.mfa.unenroll({ factorId })
  if (error) throw new Error(error.message)
  // The session's user still lists the factor until it is refreshed.
  await client.auth.refreshSession()
}
