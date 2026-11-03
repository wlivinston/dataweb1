// Two-factor sign-in (TOTP authenticator apps, via Supabase Auth MFA).
//
// Supabase issues a session after the password alone: its token carries
// `aal: "aal1"`. Only after the user enters a code from their authenticator
// app does the token say `aal: "aal2"`. Supabase does not stop an aal1 token
// from being used, so the rule has to live here: **a user who has turned on
// two-factor sign-in is not signed in until the code is entered.** A stolen
// password alone then reaches nothing on this API.
//
// Users without a verified factor are unaffected (aal1 is all they can have).
//
// The token's claims are read only after Supabase has accepted the token
// (`auth.getUser(token)` in the auth middleware), so the `aal` claim read here
// is one Supabase signed.

const { ApiError } = require('../common/apiError');

/** The claims of a JWT, or null when it is not one. Does not verify. */
const tokenClaims = (token) => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
};

/** The user's factors that finished enrolment. An unverified one protects nothing yet. */
const verifiedFactors = (user) =>
  (Array.isArray(user && user.factors) ? user.factors : []).filter((factor) => factor && factor.status === 'verified');

/**
 * Whether this token is enough for this user.
 * `required`: the user turned two-factor on; `aal`: what the token proves.
 */
const assuranceOf = (user, token) => {
  const required = verifiedFactors(user).length > 0;
  const claims = tokenClaims(token);
  const aal = claims && claims.aal === 'aal2' ? 'aal2' : 'aal1';
  return { required, aal, satisfied: !required || aal === 'aal2' };
};

const mfaRequiredError = () =>
  new ApiError(401, 'MFA_REQUIRED', 'Enter the code from your authenticator app to finish signing in.');

const isSixDigitCode = (code) => typeof code === 'string' && /^\d{6}$/.test(code);

/**
 * Challenge and verify a TOTP factor with Supabase's REST API, as the user
 * (their own aal1 token), and return the upgraded aal2 session.
 *
 * Used by the sign-in fallback for networks where the browser cannot reach
 * Supabase directly. Each call is its own request: no shared client holds
 * a session between users.
 */
async function verifyTotp({ token, factorId, code, supabaseUrl, anonKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !anonKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Supabase auth backend is not configured');
  }
  if (!isSixDigitCode(code)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The code is the 6 digits shown in your authenticator app.');
  }
  const base = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/factors/${encodeURIComponent(factorId)}`;
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const post = async (path, body) => {
    const response = await fetchImpl(`${base}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, json };
  };

  const challenge = await post('challenge', {});
  if (!challenge.ok || !challenge.json.id) {
    throw new ApiError(challenge.status === 429 ? 429 : 401, 'MFA_CHALLENGE_FAILED', 'Could not start the code check. Sign in again.');
  }
  const verified = await post('verify', { challenge_id: challenge.json.id, code });
  if (!verified.ok || !verified.json.access_token) {
    if (verified.status === 429) {
      throw new ApiError(429, 'MFA_RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
    }
    throw new ApiError(401, 'MFA_INVALID_CODE', 'That code is not right, or it has expired. Try the current one.');
  }
  const session = verified.json;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  };
}

/** What the sign-in response says about the second step, without secrets. */
const signInMfaSummary = (user) => {
  const factors = verifiedFactors(user)
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({ id: factor.id, friendly_name: factor.friendly_name || null, factor_type: 'totp' }));
  return { required: verifiedFactors(user).length > 0, factors };
};

module.exports = {
  tokenClaims,
  verifiedFactors,
  assuranceOf,
  mfaRequiredError,
  isSixDigitCode,
  verifyTotp,
  signInMfaSummary,
};
