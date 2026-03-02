const crypto = require('crypto');
const { supabaseAnon, hasAnonKey } = require('../../config/supabase');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../../services/emailService');
const { ApiError } = require('../common/apiError');
const authRepository = require('./auth.repository');

async function signInWithSupabase({ email, password }) {
  if (!hasAnonKey || !supabaseAnon) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Supabase auth backend is not configured');
  }

  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const statusCode = Number.isInteger(error.status) ? error.status : 401;
    throw new ApiError(statusCode, 'AUTH_FAILED', error.message || 'Invalid credentials');
  }

  if (!data?.session || !data?.user) {
    throw ApiError.unauthorized('Unable to establish session');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.user,
  };
}

async function registerUser({ email, firstName, lastName, company }) {
  const existingUser = await authRepository.findCustomerByEmail(email);
  if (existingUser) {
    throw ApiError.conflict('Email already registered');
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await authRepository.createCustomer({
    email,
    firstName,
    lastName,
    company,
    passwordHash: null,
    verificationToken,
    verificationExpires,
  });

  await sendVerificationEmail(user.email, user.first_name, verificationToken);

  return {
    message: 'Registration successful. Please check your email to verify your account.',
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      company: user.company,
    },
  };
}

async function verifyEmail(token) {
  const user = await authRepository.findUserByVerificationToken(token);
  if (!user) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  await authRepository.markEmailVerified(user.id);

  return {
    message: 'Email verified successfully',
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
    },
  };
}

async function resendVerificationEmail(email) {
  const user = await authRepository.findUserForVerificationResend(email);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  if (user.email_verified) {
    throw ApiError.badRequest('Email is already verified');
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await authRepository.setVerificationToken(user.id, verificationToken, verificationExpires);
  await sendVerificationEmail(user.email, user.first_name, verificationToken);

  return { message: 'Verification email sent successfully' };
}

async function forgotPassword(email) {
  const user = await authRepository.findActiveUserByEmail(email);
  if (!user) {
    return { message: 'If the email exists, a password reset link has been sent' };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 1 * 60 * 60 * 1000);

  await authRepository.setResetToken(user.id, resetToken, resetExpires);
  await sendPasswordResetEmail(user.email, user.first_name, resetToken);

  return { message: 'If the email exists, a password reset link has been sent' };
}

async function resetPassword({ token }) {
  const user = await authRepository.findUserByResetToken(token);
  if (!user) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  // Clear the reset token. Actual password change is handled via Supabase auth.
  await authRepository.updatePassword(user.id, null);

  return { message: 'Password reset token verified. Please set your new password.' };
}

async function getProfile(userId) {
  const user = await authRepository.getProfile(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  return { user };
}

async function updateProfile(userId, { firstName, lastName, company }) {
  const user = await authRepository.updateProfile(userId, {
    firstName,
    lastName,
    company,
  });

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  return {
    message: 'Profile updated successfully',
    user,
  };
}

module.exports = {
  signInWithSupabase,
  registerUser,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
};
