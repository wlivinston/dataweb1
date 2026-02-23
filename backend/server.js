// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Routes
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const blogRoutes = require('./routes/blog');
const reportRoutes = require('./routes/reports');
const subscriptionsRoutes = require('./routes/subscriptions');

// Supabase-based DB helpers (no localhost:5432)
const { connectDB } = require('./config/database');
// NEW: use the flag exposed by supabase.js
const { hasServiceKey } = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3001;
const parsePositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
};
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const DEFAULT_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 20000, 5000, 120000);
const MAX_CONTENT_LENGTH_BYTES = parsePositiveInt(
  process.env.MAX_CONTENT_LENGTH_BYTES,
  1024 * 1024,
  1024,
  20 * 1024 * 1024
);
const BODY_LIMIT = process.env.BODY_LIMIT || '1mb';

// Ensure req.ip is trustworthy behind load balancers / reverse proxies.
app.set('trust proxy', parsePositiveInt(process.env.TRUST_PROXY_HOPS, 1, 0, 10));
app.disable('x-powered-by');

/* -------------------- Security -------------------- */
app.use(
  helmet({
    hsts: IS_PROD
      ? {
          maxAge: 15552000, // 180 days
          includeSubDomains: true,
          preload: true,
        }
      : false,
    referrerPolicy: {
      policy: 'no-referrer',
    },
    crossOriginEmbedderPolicy: false,
  })
);

/* -------------------- CORS -------------------- */
// normalize a URL string to its origin (scheme + host + port)
const toOrigin = (u) => {
  try { return new URL(u).origin.replace(/\/$/, ''); }
  catch { return (u || '').replace(/\/$/, ''); }
};

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.FRONTEND_URL) {
  configuredOrigins.push(process.env.FRONTEND_URL.trim());

  // Accept both apex and www variants to avoid production-only CORS failures
  // when users switch between https://dataafrik.com and https://www.dataafrik.com.
  try {
    const frontendUrl = new URL(process.env.FRONTEND_URL.trim());
    const host = frontendUrl.hostname || '';
    if (host.startsWith('www.')) {
      configuredOrigins.push(`${frontendUrl.protocol}//${host.slice(4)}`);
    } else if (!['localhost', '127.0.0.1'].includes(host)) {
      configuredOrigins.push(`${frontendUrl.protocol}//www.${host}`);
    }
  } catch (_error) {
    // Ignore invalid FRONTEND_URL here; existing origin checks will handle it.
  }
}

if ((process.env.NODE_ENV || 'development') !== 'production') {
  configuredOrigins.push(
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:4173'
  );
}

const allowedOrigins = new Set(
  configuredOrigins.map(toOrigin)
);

// Allow local-network frontend dev origins (e.g. http://192.168.1.194:8080)
// without requiring constant .env edits as LAN IPs change.
const DEV_LOCAL_ORIGIN_REGEX =
  /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d{1,5})?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d{1,5})?|192\.168\.\d{1,3}\.\d{1,3}(?::\d{1,5})?|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(?::\d{1,5})?)$/i;

const isAllowedOrigin = (origin) => {
  const normalizedOrigin = toOrigin(origin);
  if (allowedOrigins.has(normalizedOrigin)) return true;
  if (!IS_PROD && DEV_LOCAL_ORIGIN_REGEX.test(normalizedOrigin)) return true;
  return false;
};

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server tools and health checks (no Origin header)
      if (!origin) return cb(null, true);
      return cb(null, isAllowedOrigin(origin));
    },
    credentials: true,
  })
);

// Block disallowed browser origins for mutating requests even if a client bypasses CORS checks.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (isAllowedOrigin(origin)) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  return res.status(403).json({ error: 'Origin not allowed' });
});

/* -------------------- Rate limiting -------------------- */
const createLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message,
  });

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const applyLimiterToMethods = (methods, limiter) => (req, res, next) => {
  if (!methods.has(req.method)) return next();
  return limiter(req, res, next);
};

const apiLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_API_WINDOW_MS, 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_API_MAX, 120, 20, 20000),
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', apiLimiter);

const authLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_AUTH_MAX, 30, 5, 1000),
  message: 'Too many authentication attempts. Please try again later.',
});
app.use('/api/auth', authLimiter);

const commentsWriteLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_COMMENTS_WINDOW_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_COMMENTS_WRITE_MAX, 40, 5, 2000),
  message: 'Comment actions are temporarily limited. Please try again shortly.',
});
app.use('/api/comments', applyLimiterToMethods(writeMethods, commentsWriteLimiter));

const blogWriteLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_BLOG_WRITE_WINDOW_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_BLOG_WRITE_MAX, 60, 5, 5000),
  message: 'Blog write actions are temporarily limited. Please try again shortly.',
});
app.use('/api/blog', applyLimiterToMethods(writeMethods, blogWriteLimiter));

const reportRequestLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_REPORTS_WINDOW_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_REPORTS_MAX, 10, 1, 500),
  message: 'Too many report requests. Please try again later.',
});
app.use('/api/reports/request', reportRequestLimiter);

const checkoutLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 15, 1, 500),
  message: 'Checkout attempts are temporarily limited. Please try again shortly.',
});
app.use('/api/subscriptions/pdf-checkout', checkoutLimiter);

const newsletterLimiter = createLimiter({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_NEWSLETTER_WINDOW_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_NEWSLETTER_MAX, 20, 1, 1000),
  message: 'Too many newsletter attempts. Please try again later.',
});
app.use('/api/subscriptions/newsletter', newsletterLimiter);

/* -------------------- Parsers -------------------- */
const isWebhookRequest = (req) =>
  req.path.startsWith('/api/subscriptions/webhooks/stripe') ||
  req.path.startsWith('/api/subscriptions/webhooks/paystack');

app.use((req, res, next) => {
  const contentLength = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  return next();
});

app.use((req, res, next) => {
  if (isWebhookRequest(req)) return next();
  return express.json({ limit: BODY_LIMIT })(req, res, next);
});

app.use((req, res, next) => {
  if (isWebhookRequest(req)) return next();
  return express.urlencoded({ extended: true, limit: BODY_LIMIT, parameterLimit: 1000 })(req, res, next);
});

app.use((req, res, next) => {
  req.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS);
  res.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS, () => {
    if (res.headersSent) return;
    res.status(408).json({ error: 'Request timeout' });
  });
  return next();
});

/* -------------------- Health -------------------- */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    // use the safe flag from supabase.js
    supabase_configured: hasServiceKey,
    message: 'Backend API is running',
  });
});

/* -------------------- API Routes -------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);

/* -------------------- Error handling -------------------- */
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message:
      process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

/* -------------------- 404 -------------------- */
app.use('*', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const checkExistingHealthOnPort = async (port) => {
  const url = `http://127.0.0.1:${port}/health`;
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return { reachable: false, isDataWebBackend: false };

    const payload = await response.json().catch(() => ({}));
    const status = String(payload?.status || '').toUpperCase();
    const message = String(payload?.message || '').toLowerCase();
    const isDataWebBackend = status === 'OK' && message.includes('backend api is running');
    return { reachable: true, isDataWebBackend };
  } catch {
    return { reachable: false, isDataWebBackend: false };
  }
};

/* -------------------- Start Server (then optional DB ping) -------------------- */
const startServer = async () => {
  const server = app.listen(PORT);

  server.on('listening', () => {
    console.log(`[backend] Server running on port ${PORT}`);
    console.log(`[backend] Health check: http://localhost:${PORT}/health`);
    console.log(`[backend] API base URL: http://localhost:${PORT}/api`);

    server.requestTimeout = DEFAULT_REQUEST_TIMEOUT_MS;
    server.headersTimeout = DEFAULT_REQUEST_TIMEOUT_MS + 5000;
    server.keepAliveTimeout = parsePositiveInt(process.env.KEEP_ALIVE_TIMEOUT_MS, 10000, 1000, 30000);
    server.maxRequestsPerSocket = parsePositiveInt(
      process.env.MAX_REQUESTS_PER_SOCKET,
      1000,
      100,
      50000
    );

    // Non-blocking DB connectivity check; never crashes the app
    connectDB().catch((err) => {
      console.log('[backend] DB check failed:', err?.message || err);
      console.log('[backend] Server continues running without DB');
    });
  });

  server.on('error', async (error) => {
    if (error?.code === 'EADDRINUSE') {
      const existing = await checkExistingHealthOnPort(PORT);
      if (existing.reachable && existing.isDataWebBackend) {
        console.error(
          `[backend] Port ${PORT} is already in use by an existing DataWeb backend instance. Stop the duplicate process or change PORT in backend/.env.`
        );
      } else if (existing.reachable) {
        console.error(
          `[backend] Port ${PORT} is already in use by another HTTP service. Stop that service or change PORT in backend/.env.`
        );
      } else {
        console.error(
          `[backend] Port ${PORT} is already in use by another process. Stop it or change PORT in backend/.env.`
        );
      }
    } else {
      console.error('[backend] Failed to start server:', error);
    }

    process.exit(1);
  });
};
if (require.main === module) {
  startServer();
}

module.exports = app;

