const logger = require('../config/logger')
const { supabase } = require('../config/supabase')
const { sendError } = require('../modules/common/apiResponse')
const { ApiError } = require('../modules/common/apiError')

const safeString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : fallback
}

const buildUserContext = (user, customerData) => {
  const metadata = user?.user_metadata || {}
  const firstName = safeString(customerData?.first_name, safeString(metadata.first_name))
  const lastName = safeString(customerData?.last_name, safeString(metadata.last_name))

  return {
    ...user,
    customer_id: customerData?.id || null,
    first_name: firstName,
    last_name: lastName,
    age: customerData?.age ?? metadata.age ?? null,
    registration_country:
      safeString(customerData?.registration_country, safeString(metadata.registration_country)) || null,
    company: customerData?.company ?? metadata.company ?? null,
    subscription_status: customerData?.subscription_status || 'free',
    is_active: customerData?.is_active ?? true,
  }
}

const fetchCustomerByEmail = async (email) => {
  const normalizedEmail = safeString(email).toLowerCase()
  if (!normalizedEmail) {
    return { customerData: null, customerError: null }
  }

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error) {
    logger.warn({ err: error.message }, 'customer lookup warning')
    return { customerData: null, customerError: error }
  }

  return { customerData: data || null, customerError: null }
}

// Middleware to verify Supabase JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return sendError(res, ApiError.unauthorized('Access token required'))
  }

  try {
    if (!supabase) {
      return sendError(res, new ApiError(500, 'AUTH_BACKEND_ERROR', 'Authentication backend is not configured'))
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return sendError(res, ApiError.unauthorized('Invalid token'))
    }

    // Get additional user data from customers table.
    // If unavailable, continue with Supabase auth metadata so protected endpoints still work.
    const { customerData } = await fetchCustomerByEmail(user.email)

    if (customerData && customerData.is_active === false) {
      return sendError(res, ApiError.unauthorized('Account is deactivated'))
    }

    req.user = buildUserContext(user, customerData)

    next()
  } catch (error) {
    logger.error({ err: error }, 'auth middleware error')
    return sendError(res, new ApiError(500, 'AUTH_ERROR', 'Authentication failed'))
  }
}

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    req.user = null
    return next()
  }

  try {
    if (!supabase) {
      req.user = null
      return next()
    }

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      req.user = null
      return next()
    }

    const { customerData } = await fetchCustomerByEmail(user.email)

    if (customerData && customerData.is_active === false) {
      req.user = null
    } else {
      req.user = buildUserContext(user, customerData)
    }

    next()
  } catch (error) {
    req.user = null
    next()
  }
}

// Admin middleware
const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    return sendError(res, ApiError.unauthorized('Authentication required'))
  }

  if (req.user.subscription_status !== 'admin') {
    return sendError(res, ApiError.forbidden('Admin access required'))
  }

  next()
}

// Verify Supabase JWT token without database lookup
const verifyToken = async (token) => {
  try {
    if (!supabase) {
      return { valid: false, user: null, error: new Error('Supabase client is not configured') }
    }

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return { valid: false, user: null, error }
    }

    return { valid: true, user, error: null }
  } catch (error) {
    return { valid: false, user: null, error }
  }
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  verifyToken
}
