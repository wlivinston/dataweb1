import { describe, expect, it } from 'vitest'
import { assuranceOf, isSixDigitCode, normalizeCode, tokenClaims, verifiedTotpFactors } from '../mfa'

// The same rule as backend/modules/security/mfa.js: a user who turned
// two-factor on is not signed in until the token says aal2.

const jwt = (claims: Record<string, unknown>) =>
  ['h', btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 's'].join('.')

const factor = (status: string, factor_type = 'totp') =>
  ({ id: `${factor_type}-${status}`, status, factor_type, created_at: '', updated_at: '' }) as never

const session = (aal: string | undefined, factors: unknown[]) =>
  ({ access_token: jwt(aal ? { aal } : {}), user: { factors } }) as never

describe('assuranceOf', () => {
  it('a user without two-factor is fine at aal1', () => {
    expect(assuranceOf(session('aal1', []))).toEqual({ required: false, aal: 'aal1', satisfied: true })
  })

  it('a user with a verified factor owes a code until aal2', () => {
    expect(assuranceOf(session('aal1', [factor('verified')])).satisfied).toBe(false)
    expect(assuranceOf(session('aal2', [factor('verified')])).satisfied).toBe(true)
  })

  it('an abandoned enrolment requires nothing', () => {
    expect(assuranceOf(session('aal1', [factor('unverified')])).required).toBe(false)
  })

  it('an unreadable token counts as password-only', () => {
    const user = { factors: [factor('verified')] }
    for (const access_token of ['nope', 'a.%%%.c', '']) {
      expect(assuranceOf({ access_token, user } as never).satisfied).toBe(false)
    }
    expect(assuranceOf(session(undefined, [factor('verified')])).satisfied).toBe(false)
  })

  it('no session is not a two-factor user', () => {
    expect(assuranceOf(null).required).toBe(false)
  })
})

describe('helpers', () => {
  it('tokenClaims reads base64url claims', () => {
    expect(tokenClaims(jwt({ aal: 'aal2', sub: 'ü?>' }))).toMatchObject({ aal: 'aal2' })
  })

  it('codes', () => {
    expect(normalizeCode('123 456')).toBe('123456')
    expect(normalizeCode('123-456')).toBe('123456')
    expect(isSixDigitCode('123456')).toBe(true)
    for (const bad of ['12345', '1234567', '12345a', '']) expect(isSixDigitCode(bad)).toBe(false)
  })

  it('verifiedTotpFactors keeps only finished TOTP factors', () => {
    const user = { factors: [factor('verified'), factor('unverified'), factor('verified', 'phone')] }
    expect(verifiedTotpFactors(user as never).map((f) => f.id)).toEqual(['totp-verified'])
  })
})
