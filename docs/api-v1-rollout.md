# API v1 Rollout Guide

## Current Compatibility Mode
- Legacy routes remain active at `/api/*`.
- Versioned routes are now available at `/api/v1/*`.
- During Phase B, v1 is progressively switching to modular handlers:
  - `auth`: `/supabase/sign-in`, `/register`, `/login`, `/verify/:token`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/profile` now served by `backend/modules/auth/*`
  - `blog`: `/posts`, `/posts/:slug`, `/posts/:slug/like`, `/posts/ensure`, `/sync/markdown`, `/categories`, `/tags`, `/featured`, `/recent`, `/popular`, `/search`, `/analytics`, `/import` now served by `backend/modules/blog/*`
  - `comments`: `/post/:postId`, `/`, `/:commentId`, `/:commentId/like`, `/stats/:postId`, `/admin/pending`, `/admin/:commentId/moderate` now served by `backend/modules/comments/*`
  - `reports`: `/request` now served by `backend/modules/reports/*`
  - `subscriptions`: `/plans`, `/pdf-pricing`, `/newsletter`, `/newsletter/unsubscribe`, `/pdf-access`, `/pdf-checkout`, `/pdf-verify`, `/webhooks/stripe`, `/webhooks/paystack`, `/subscribe`, `/current`, `/cancel`, `/reactivate`, `/history`, `/admin/all`, `/admin/:subscriptionId/status` now served by `backend/modules/subscriptions/*`
  - `finance` (Phase C baseline): `/ingestion/jobs`, `/reconciliation/jobs`, `/reports/jobs`, `/jobs`, `/jobs/:jobId` now served by `backend/modules/finance/*` + `backend/modules/jobs/*`
- All other v1 endpoints currently fall back to legacy route handlers.

## Finance Jobs Caveat (Current Baseline)
- `finance` jobs now support durable Postgres-backed storage when `DATABASE_URL` is configured.
- Queue mode is auto-selected:
- `JOB_STORAGE_MODE=auto` -> database when available, otherwise in-memory fallback.
- `JOB_STORAGE_MODE=database` -> strict durable mode (startup fails if storage init fails).
- `JOB_STORAGE_MODE=memory` -> force in-memory (development only).
- Canonical endpoint: `GET /api/v1/finance/jobs/storage-mode` (authenticated).
- Temporary compatibility alias: `GET /api/v1/finance/storage-mode` (authenticated).

## Frontend Opt-In
Set in frontend environment:

```bash
VITE_API_VERSION=v1
VITE_FINANCE_API_JOBS=true
```

When set, `getApiUrl()` rewrites:
- `/api/auth/...` -> `/api/v1/auth/...`
- `/api/blog/...` -> `/api/v1/blog/...`
- `/api/comments/...` -> `/api/v1/comments/...`
- `/api/reports/...` -> `/api/v1/reports/...`
- `/api/subscriptions/...` -> `/api/v1/subscriptions/...`

Non-API routes like `/health` remain unchanged.

When `VITE_FINANCE_API_JOBS=true`, Finance dashboard uses job endpoints for:
- GL ingestion preview (`/api/v1/finance/ingestion/jobs`)
- Bank reconciliation (`/api/v1/finance/reconciliation/jobs`)
- Report preflight caveats (`/api/v1/finance/reports/jobs`)
- Job polling (`/api/v1/finance/jobs/:jobId`)

## Phase 1 Legacy Controls (Now Available)
Backend now supports safe legacy deprecation and kill-switch controls:

```bash
API_LEGACY_ENABLED=true
API_LEGACY_DEPRECATION_ENABLED=true
API_LEGACY_SUNSET=2026-12-31T23:59:59Z
API_LEGACY_DOC_URL=/api/v1/system/openapi
API_LEGACY_TELEMETRY_ENABLED=true
API_LEGACY_TELEMETRY_FLUSH_MS=300000
API_LEGACY_TELEMETRY_TOP_N=25
```

Behavior:
- Legacy endpoints (`/api/*`, excluding `/api/v1/*`) emit deprecation headers:
  - `Deprecation: true`
  - `Sunset: <http-date>`
  - `X-API-Legacy: true`
  - `Link: </api/v1/system/openapi>; rel="successor-version"`
- Legacy usage telemetry is logged with endpoint + origin + hit counts.
- Set `API_LEGACY_ENABLED=false` to hard-disable legacy routes (HTTP `410 Gone` with migration hint).

## Smoke Test Checklist
Automated local smoke runner:

```bash
cd backend
npm run test:smoke:v1
```

1. `GET /api/v1/system/health`
2. `GET /api/v1/blog/posts`
3. `GET /api/v1/subscriptions/plans`
4. `POST /api/v1/subscriptions/newsletter`
5. `POST /api/v1/subscriptions/pdf-checkout` (authenticated)
6. `GET /api/v1/comments/post/:postId`
7. `POST /api/v1/finance/ingestion/jobs` (authenticated, poll via `/api/v1/finance/jobs/:jobId`)
8. `POST /api/v1/finance/reconciliation/jobs` (authenticated)
9. `POST /api/v1/finance/reports/jobs` (authenticated)

## OpenAPI Contract
- Baseline contract file: `backend/openapi/v1.yaml`
- Endpoint: `GET /api/v1/system/openapi`

## Rollback
- If any v1 issue appears, remove `VITE_API_VERSION=v1` to immediately return frontend traffic to legacy `/api/*`.
