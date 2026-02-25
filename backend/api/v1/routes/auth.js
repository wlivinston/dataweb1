const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../../../middleware/auth');
const authService = require('../../../modules/auth/auth.service');
const legacyAuthRoutes = require('../../../routes/auth');

const router = express.Router();

router.post(
  '/supabase/sign-in',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.signInWithSupabase({
        email: req.body?.email,
        password: req.body?.password,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 supabase sign-in error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Authentication fallback failed',
      });
    }
  }
);

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('first_name').trim().isLength({ min: 2 }),
    body('last_name').trim().isLength({ min: 2 }),
    body('company').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.registerUser({
        email: req.body?.email,
        password: req.body?.password,
        firstName: req.body?.first_name,
        lastName: req.body?.last_name,
        company: req.body?.company,
      });

      return res.status(201).json(payload);
    } catch (error) {
      console.error('v1 register error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Registration failed',
      });
    }
  }
);

router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.loginUser({
        email: req.body?.email,
        password: req.body?.password,
      });

      return res.json(payload);
    } catch (error) {
      console.error('v1 login error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Login failed',
      });
    }
  }
);

router.get('/verify/:token', async (req, res) => {
  try {
    const payload = await authService.verifyEmail(req.params.token);
    return res.json(payload);
  } catch (error) {
    console.error('v1 verify email error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Email verification failed',
    });
  }
});

router.post(
  '/resend-verification',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.resendVerificationEmail(req.body?.email);
      return res.json(payload);
    } catch (error) {
      console.error('v1 resend verification error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to send verification email',
      });
    }
  }
);

router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.forgotPassword(req.body?.email);
      return res.json(payload);
    } catch (error) {
      console.error('v1 forgot password error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to process password reset request',
      });
    }
  }
);

router.post(
  '/reset-password',
  [body('token').notEmpty(), body('password').isLength({ min: 6 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.resetPassword({
        token: req.body?.token,
        password: req.body?.password,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 reset password error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Password reset failed',
      });
    }
  }
);

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const payload = await authService.getProfile(req.user?.id);
    return res.json(payload);
  } catch (error) {
    console.error('v1 get profile error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to get profile',
    });
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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await authService.updateProfile(req.user?.id, {
        firstName: req.body?.first_name,
        lastName: req.body?.last_name,
        company: req.body?.company,
      });

      return res.json(payload);
    } catch (error) {
      console.error('v1 update profile error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to update profile',
      });
    }
  }
);

// Compatibility fallback for endpoints not yet migrated in Phase B.
router.use('/', legacyAuthRoutes);

module.exports = router;
