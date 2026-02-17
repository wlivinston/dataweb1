const { supabase } = require('../config/supabase')

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
    console.warn('Customer lookup warning:', error.message)
    return { customerData: null, customerError: error }
  }

  return { customerData: data || null, customerError: null }
}

// Middleware to verify Supabase JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Authentication backend is not configured' })
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Get additional user data from customers table.
    // If unavailable, continue with Supabase auth metadata so protected endpoints still work.
    const { customerData } = await fetchCustomerByEmail(user.email)

    if (customerData && customerData.is_active === false) {
      return res.status(401).json({ error: 'Account is deactivated' })
    }

    req.user = buildUserContext(user, customerData)

    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return res.status(500).json({ error: 'Authentication failed' })
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

// Admin middleware (for future use)
const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  // Check if user has admin subscription status
  if (req.user.subscription_status !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
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
