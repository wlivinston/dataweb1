const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabaseAnon, hasAnonKey } = require('../../config/supabase');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../../services/emailService');
const authRepository = require('./auth.repository');

async function signInWithSupabase({ email, password }) {
  if (!hasAnonKey || !supabaseAnon) {
    const error = new Error('Supabase auth backend is not configured');
    error.statusCode = 503;
    throw error;
  }

  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const authError = new Error(error.message || 'Invalid credentials');
    authError.statusCode = Number.isInteger(error.status) ? error.status : 401;
    throw authError;
  }

  if (!data?.session || !data?.user) {
    const authError = new Error('Unable to establish session');
    authError.statusCode = 401;
    throw authError;
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

async function registerUser({ email, password, firstName, lastName, company }) {
  const existingUser = await authRepository.findCustomerByEmail(email);
  if (existingUser) {
    const error = new Error('Email already registered');
    error.statusCode = 400;
    throw error;
  }

  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await authRepository.createCustomer({
    email,
    firstName,
    lastName,
    company,
    passwordHash: hashedPassword,
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

async function loginUser({ email, password }) {
  const user = await authRepository.findCustomerByEmail(email);

  if (!user) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  if (!user.is_active) {
    const error = new Error('Account is deactivated');
    error.statusCode = 401;
    throw error;
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  await authRepository.updateLastLogin(user.id);

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      company: user.company,
      email_verified: user.email_verified,
    },
  };
}

async function verifyEmail(token) {
  const user = await authRepository.findUserByVerificationToken(token);
  if (!user) {
    const error = new Error('Invalid or expired verification token');
    error.statusCode = 400;
    throw error;
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
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  if (user.email_verified) {
    const error = new Error('Email is already verified');
    error.statusCode = 400;
    throw error;
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

async function resetPassword({ token, password }) {
  const user = await authRepository.findUserByResetToken(token);
  if (!user) {
    const error = new Error('Invalid or expired reset token');
    error.statusCode = 400;
    throw error;
  }

  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  await authRepository.updatePassword(user.id, hashedPassword);

  return { message: 'Password reset successfully' };
}

async function getProfile(userId) {
  const user = await authRepository.getProfile(userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
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
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    message: 'Profile updated successfully',
    user,
  };
}

module.exports = {
  signInWithSupabase,
  registerUser,
  loginUser,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
};
