// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Routes
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const blogRoutes = require('./routes/blog');
const reportRoutes = require('./routes/reports');

// Supabase-based DB helpers (no localhost:5432)
const { connectDB } = require('./config/database');
// NEW: use the flag exposed by supabase.js
const { hasServiceKey } = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3001;

/* -------------------- Security -------------------- */
app.use(helmet());

/* -------------------- CORS -------------------- */
// normalize a URL string to its origin (scheme + host + port)
const toOrigin = (u) => {
  try { return new URL(u).origin.replace(/\/$/, ''); }
  catch { return (u || '').replace(/\/$/, ''); }
};

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,     // e.g. https://www.dataafrik.com (set in DO)
    'https://dataafrik.com',
    'https://www.dataafrik.com',
    'http://localhost:5173',      // Vite dev
  ].filter(Boolean).map(toOrigin)
);

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server tools and health checks (no Origin header)
      if (!origin) return cb(null, true);
      const o = toOrigin(origin);
      return cb(null, allowedOrigins.has(o));
    },
    credentials: true,
  })
);

/* -------------------- Rate limiting -------------------- */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

/* -------------------- Parsers -------------------- */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* -------------------- Health -------------------- */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
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

/* -------------------- Start Server (then optional DB ping) -------------------- */
const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
    });

    // Non-blocking DB connectivity check; never crashes the app
    connectDB().catch((err) => {
      console.log('⚠️  DB check failed:', err?.message || err);
      console.log('✅ Server continues running without DB');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
