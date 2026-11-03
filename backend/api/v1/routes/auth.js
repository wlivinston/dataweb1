const express = require('express');
const { body } = require('express-validator');
const { authenticateToken } = require('../../../middleware/auth');
const authService = require('../../../modules/auth/auth.service');
const mfa = require('../../../modules/security/mfa');
const audit = require('../../../modules/audit/audit.service');
const { supabase } = require('../../../config/supabase');
const { ApiError } = require('../../../modules/common/apiError');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');

const router = express.Router();

router.post(
  '/supabase/sign-in',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.signInWithSupabase({
        email: req.body?.email,
        password: req.body?.password,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

// The second step of sign-in when the browser cannot reach Supabase directly:
// verify an authenticator code against the user's own password-only (aal1)
// session and return the upgraded (aal2) one. Not behind authenticateToken,
// which refuses exactly the aal1 token this route exists to upgrade.
router.post(
  '/supabase/mfa/verify',
  [body('factorId').isString().trim().notEmpty(), body('code').isString().trim()],
  async (req, res) => {
    let actorId = null;
    try {
      assertValidRequest(req);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) throw ApiError.unauthorized('Access token required');
      if (!supabase) throw new ApiError(500, 'AUTH_BACKEND_ERROR', 'Authentication backend is not configured');

      const { data, error } = await supabase.auth.getUser(token);
      const user = data && data.user;
      if (error || !user) throw ApiError.unauthorized('Invalid token');
      actorId = user.id;

      const factorId = String(req.body.factorId).trim();
      if (!mfa.verifiedFactors(user).some((factor) => factor.id === factorId)) {
        throw new ApiError(404, 'MFA_FACTOR_NOT_FOUND', 'That authenticator is not set up on this account.');
      }

      const session = await mfa.verifyTotp({
        token,
        factorId,
        code: String(req.body.code).trim(),
        supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
        anonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
      });
      await audit.record({ req, actorId, action: 'auth.mfa_verify', outcome: 'ok' });
      return sendSuccess(res, { data: session });
    } catch (error) {
      if (actorId) {
        await audit.record({ req, actorId, action: 'auth.mfa_verify', outcome: audit.outcomeForError(error) });
      }
      return sendError(res, error);
    }
  }
);

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('first_name').trim().isLength({ min: 2 }),
    body('last_name').trim().isLength({ min: 2 }),
    body('company').optional().trim(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.registerUser({
        email: req.body?.email,
        firstName: req.body?.first_name,
        lastName: req.body?.last_name,
        company: req.body?.company,
      });
      return sendSuccess(res, { status: 201, data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/verify/:token', async (req, res) => {
  try {
    const payload = await authService.verifyEmail(req.params.token);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/resend-verification',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.resendVerificationEmail(req.body?.email);
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.forgotPassword(req.body?.email);
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  '/reset-password',
  [body('token').notEmpty()],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.resetPassword({
        token: req.body?.token,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const payload = await authService.getProfile(req.user?.id);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put(
  '/profile',
  authenticateToken,
  [
    body('first_name').optional().trim().isLength({ min: 2 }),
    body('last_name').optional().trim().isLength({ min: 2 }),
    body('company').optional().trim(),
  ],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await authService.updateProfile(req.user?.id, {
        firstName: req.body?.first_name,
        lastName: req.body?.last_name,
        company: req.body?.company,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

module.exports = router;
