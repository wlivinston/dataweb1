# DataAfrik API-First Migration Blueprint

## Goal
Move DataAfrik to an API-first architecture that scales safely without breaking current production flows.

This migration is executed as a **non-breaking phased rollout**:
- Keep current `/api/*` routes alive.
- Introduce versioned `/api/v1/*` routes now.
- Migrate frontend and internal modules domain-by-domain.
- Remove legacy paths only after parity and validation.

## Current State Summary
- Runtime: Node.js + Express backend (`backend/server.js`)
- Existing domains:
  - `auth`
  - `blog`
  - `comments`
  - `reports`
  - `subscriptions` (billing + PDF access + newsletter)
- Frontend currently consumes `/api/*` via `getApiUrl()`
- Finance/reconciliation logic currently runs mainly in frontend components.

## Target Architecture (Phase Model)

### Phase A: Contract and Gateway Baseline (Now)
- Introduce `/api/v1` gateway with domain routers.
- Publish baseline OpenAPI spec (`backend/openapi/v1.yaml`).
- Keep legacy routes for compatibility.
- Add optional frontend API version switch (`VITE_API_VERSION=v1`).

### Phase B: Modular Monolith Domain Boundaries
- Split backend code by domain modules with service/repository boundaries:
  - `auth`
  - `billing`
  - `blog`
  - `comments`
  - `reports`
  - `finance-ingestion`
  - `reconciliation`
- Standardize request validation, error codes, and response envelopes.

### Phase C: Async Processing for Heavy Workloads
- Queue-based workers for:
  - Excel ingestion and profiling
  - Bank reconciliation jobs
  - PDF/report generation
- Introduce job lifecycle endpoints (`queued`, `running`, `failed`, `completed`).
- Status: **baseline implemented** with `/api/v1/finance/*/jobs` and `/api/v1/finance/jobs/:jobId` polling.
- Status update: durable Postgres-backed job store is implemented when `DATABASE_URL` is present; memory fallback remains available for local development.

### Phase D: Frontend API-Only Consumption
- Move finance logic from client-heavy to backend-driven jobs and results.
- UI becomes orchestration + rendering layer.
- Add polling or websocket updates for long-running tasks.
- Status: **partial cutover active behind `VITE_FINANCE_API_JOBS=true`** for ingestion, reconciliation, and report preflight.

### Phase E: Hardening and Scale
- Endpoint-level authz and least-privilege access.
- Idempotency keys for payment/report endpoints.
- Rate limiting by domain and action risk.
- Structured logs, tracing, and SLO dashboards.

### Phase F: Legacy Retirement
- Remove `/api/*` legacy aliases after parity, traffic cutover, and rollback window.

## API Conventions (v1)
- Prefix: `/api/v1`
- Version header: `X-API-Version: v1`
- Contract source: OpenAPI (`backend/openapi/v1.yaml`)
- Error model:
  - consistent machine code + user-safe message
- Pagination:
  - `page`, `limit`, server returns `meta`
- Auth:
  - bearer token for protected routes

## Domain Migration Sequence
1. `blog` + `comments` (low risk, high visibility)
2. `reports` + `newsletter`
3. `subscriptions` / checkout verification
4. `finance-ingestion`
5. `reconciliation`
6. `pdf-generation` async jobs

## Risk Controls
- Compatibility routes remain active during migration.
- Every new v1 endpoint gets:
  - schema validation
  - rate limit
  - auth checks
  - smoke tests
- No frontend cutover until route parity is verified.

## Definition of "Fully Functional API-First"
- All frontend API traffic switched to `/api/v1`.
- Finance flows run through backend APIs (including reconciliation pipeline).
- Payments and PDF access stable in production.
- Legacy endpoints no longer required for normal product flow.
- Observability + rollback controls in place.

## Immediate Work Items (Next)
1. Introduce v1 route map and compatibility wrappers.
2. Add API version switch in frontend config.
3. Add contract tests for high-traffic endpoints.
   - Status: backend smoke baseline added via `backend/scripts/smoke-v1.js` (`npm run test:smoke:v1`).
4. Start extracting finance ingestion + reconciliation server APIs.
5. Wire frontend Finance dashboard to `/api/v1/finance/*/jobs` and poll status/results.
