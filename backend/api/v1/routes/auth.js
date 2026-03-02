const express = require('express');
const { body } = require('express-validator');
const { authenticateToken } = require('../../../middleware/auth');
const authService = require('../../../modules/auth/auth.service');
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
