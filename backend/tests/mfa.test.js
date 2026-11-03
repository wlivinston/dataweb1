process.env.DATASET_STORAGE_MODE = 'memory';
process.env.SUPABASE_URL = 'https://project.supabase.test';
process.env.SUPABASE_ANON_KEY = 'anon-key';

// The Supabase client: getUser answers from a table of known tokens, the way
// Supabase would after checking the signature.
const mockKnownTokens = new Map();
jest.mock('../config/supabase', () => ({
  supabase: {
    auth: {
      getUser: async (token) => {
        const user = mockKnownTokens.get(token);
        return user ? { data: { user }, error: null } : { data: { user: null }, error: new Error('bad jwt') };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
  supabaseAnon: null,
  hasServiceKey: true,
  hasAnonKey: true,
}));

const express = require('express');
const request = require('supertest');
const mfa = require('../modules/security/mfa');
const audit = require('../modules/audit/audit.service');
const { authenticateToken, optionalAuth, verifyToken } = require('../middleware/auth');

/**
 * Two-factor sign-in: a user who turned it on is not signed in by password
 * alone. Supabase hands out a usable aal1 token after the password, so this
 * API is where that rule has to hold.
 */

const jwt = (claims) =>
  ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

const VERIFIED = { id: 'factor-1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' };
const UNVERIFIED = { id: 'factor-2', factor_type: 'totp', status: 'unverified' };

const withTwoFactor = { id: 'user-2fa', email: 'a@example.com', factors: [VERIFIED] };
const withoutTwoFactor = { id: 'user-plain', email: 'b@example.com', factors: [] };
const enrolmentAbandoned = { id: 'user-half', email: 'c@example.com', factors: [UNVERIFIED] };

const PASSWORD_ONLY = jwt({ sub: 'user-2fa', aal: 'aal1' });
const WITH_CODE = jwt({ sub: 'user-2fa', aal: 'aal2' });
const PLAIN = jwt({ sub: 'user-plain', aal: 'aal1' });
const HALF = jwt({ sub: 'user-half', aal: 'aal1' });
mockKnownTokens.set(PASSWORD_ONLY, withTwoFactor);
mockKnownTokens.set(WITH_CODE, withTwoFactor);
mockKnownTokens.set(PLAIN, withoutTwoFactor);
mockKnownTokens.set(HALF, enrolmentAbandoned);

const app = express();
app.use(express.json());
app.get('/protected', authenticateToken, (req, res) => res.json({ id: req.user.id, aal: req.user.aal }));
app.get('/optional', optionalAuth, (req, res) => res.json({ id: req.user ? req.user.id : null }));
app.use('/api/v1/auth', require('../api/v1/routes/auth'));

let recorded;
beforeEach(() => {
  recorded = jest.spyOn(audit, 'record').mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('assuranceOf', () => {
  test('a user without two-factor is satisfied by a password-only token', () => {
    expect(mfa.assuranceOf(withoutTwoFactor, PLAIN)).toEqual({ required: false, aal: 'aal1', satisfied: true });
  });

  test('a user with two-factor needs an aal2 token', () => {
    expect(mfa.assuranceOf(withTwoFactor, PASSWORD_ONLY).satisfied).toBe(false);
    expect(mfa.assuranceOf(withTwoFactor, WITH_CODE).satisfied).toBe(true);
  });

  test('an enrolment that was never finished protects nothing and locks nobody out', () => {
    expect(mfa.assuranceOf(enrolmentAbandoned, HALF).satisfied).toBe(true);
  });

  test('a token whose claims cannot be read counts as password-only', () => {
    for (const token of ['not-a-jwt', 'a.%%%.c', '', null, jwt({ aal: 'AAL2' })]) {
      expect(mfa.assuranceOf(withTwoFactor, token)).toEqual({ required: true, aal: 'aal1', satisfied: false });
    }
  });
});

describe('the API refuses a password-only session of a two-factor user', () => {
  test('authenticateToken: 401 MFA_REQUIRED, recorded as a denial', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${PASSWORD_ONLY}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect(recorded).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-2fa', action: 'auth.mfa_required', outcome: 'denied' })
    );
  });

  test('the same user with the code entered gets through, marked aal2', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${WITH_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'user-2fa', aal: 'aal2' });
  });

  test('a user without two-factor is unaffected', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${PLAIN}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-plain');
    expect(recorded).not.toHaveBeenCalled();
  });

  test('optionalAuth treats a password-only two-factor session as signed out', async () => {
    const res = await request(app).get('/optional').set('Authorization', `Bearer ${PASSWORD_ONLY}`);
    expect(res.body.id).toBeNull();
    const ok = await request(app).get('/optional').set('Authorization', `Bearer ${WITH_CODE}`);
    expect(ok.body.id).toBe('user-2fa');
  });

  test('verifyToken agrees', async () => {
    expect((await verifyToken(PASSWORD_ONLY)).valid).toBe(false);
    expect((await verifyToken(WITH_CODE)).valid).toBe(true);
    expect((await verifyToken(PLAIN)).valid).toBe(true);
  });
});

/** A fake of Supabase's MFA REST endpoints. */
const fakeSupabase = ({ correctCode = '123456', challengeStatus = 200, verifyStatus } = {}) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/challenge')) {
      return challengeStatus === 200 ? json(200, { id: 'challenge-9' }) : json(challengeStatus, {});
    }
    if (verifyStatus) return json(verifyStatus, {});
    const body = JSON.parse(init.body);
    if (body.challenge_id === 'challenge-9' && body.code === correctCode) {
      return json(200, {
        access_token: WITH_CODE, refresh_token: 'r2', expires_in: 3600, expires_at: 99, token_type: 'bearer',
        user: withTwoFactor,
      });
    }
    return json(422, { msg: 'Invalid TOTP code entered' });
  };
  return { impl, calls };
};

describe('verifyTotp', () => {
  const args = { token: PASSWORD_ONLY, factorId: 'factor-1', supabaseUrl: 'https://p.supabase.test/', anonKey: 'anon' };

  test('a right code returns the aal2 session, asked for as the user', async () => {
    const fake = fakeSupabase();
    const session = await mfa.verifyTotp({ ...args, code: '123456', fetchImpl: fake.impl });
    expect(mfa.tokenClaims(session.access_token).aal).toBe('aal2');
    expect(fake.calls.map((c) => c.url)).toEqual([
      'https://p.supabase.test/auth/v1/factors/factor-1/challenge',
      'https://p.supabase.test/auth/v1/factors/factor-1/verify',
    ]);
    for (const call of fake.calls) {
      expect(call.init.headers.Authorization).toBe(`Bearer ${PASSWORD_ONLY}`);
      expect(call.init.headers.apikey).toBe('anon');
    }
  });

  test('a wrong code is refused', async () => {
    const fake = fakeSupabase();
    await expect(mfa.verifyTotp({ ...args, code: '654321', fetchImpl: fake.impl }))
      .rejects.toMatchObject({ statusCode: 401, code: 'MFA_INVALID_CODE' });
  });

  test('rate limiting is reported as such', async () => {
    const fake = fakeSupabase({ verifyStatus: 429 });
    await expect(mfa.verifyTotp({ ...args, code: '123456', fetchImpl: fake.impl }))
      .rejects.toMatchObject({ statusCode: 429 });
  });

  test('anything but six digits never reaches Supabase', async () => {
    for (const code of ['12345', '1234567', '12345a', ' 123456', '']) {
      const fake = fakeSupabase();
      await expect(mfa.verifyTotp({ ...args, code, fetchImpl: fake.impl })).rejects.toMatchObject({ statusCode: 400 });
      expect(fake.calls).toHaveLength(0);
    }
  });
});

describe('POST /api/v1/auth/supabase/mfa/verify', () => {
  const post = (token, body) => {
    const req = request(app).post('/api/v1/auth/supabase/mfa/verify');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };

  test('upgrades a password-only session with the right code', async () => {
    const fake = fakeSupabase();
    const spy = jest.spyOn(global, 'fetch').mockImplementation(fake.impl);
    const res = await post(PASSWORD_ONLY, { factorId: 'factor-1', code: '123456' });
    expect(res.status).toBe(200);
    expect(mfa.tokenClaims(res.body.data.access_token).aal).toBe('aal2');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-2fa', action: 'auth.mfa_verify', outcome: 'ok' }));
  });

  test('a wrong code is a recorded denial', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(fakeSupabase().impl);
    const res = await post(PASSWORD_ONLY, { factorId: 'factor-1', code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_INVALID_CODE');
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.mfa_verify', outcome: 'denied' }));
  });

  test('a factor that is not this user\'s verified factor is refused before Supabase is asked', async () => {
    const spy = jest.spyOn(global, 'fetch');
    for (const factorId of ['factor-2', 'someone-elses']) {
      const res = await post(PASSWORD_ONLY, { factorId, code: '123456' });
      expect(res.status).toBe(404);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  test('no token, or one Supabase does not accept, is refused', async () => {
    const spy = jest.spyOn(global, 'fetch');
    expect((await post(null, { factorId: 'factor-1', code: '123456' })).status).toBe(401);
    expect((await post(jwt({ aal: 'aal1' }), { factorId: 'factor-1', code: '123456' })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the sign-in fallback says when a second step is needed', () => {
  test('signInMfaSummary', () => {
    expect(mfa.signInMfaSummary(withTwoFactor)).toEqual({
      required: true,
      factors: [{ id: 'factor-1', friendly_name: 'Phone', factor_type: 'totp' }],
    });
    expect(mfa.signInMfaSummary(enrolmentAbandoned)).toEqual({ required: false, factors: [] });
    expect(mfa.signInMfaSummary(undefined)).toEqual({ required: false, factors: [] });
  });
});
