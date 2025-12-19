Development plan (phased, production-ready)

This repository’s documents describe a “family finance” backend that:

- Uses Keycloak for identity (login/MFA/social) while storing workspace membership/roles in Postgres.
- Is multi-tenant via a “Workspace” (family) boundary; every record is scoped by `workspaceId`.
- Ingests data from uploads and connected email accounts (Gmail/Microsoft), storing documents in S3/MinIO.
- Runs a background pipeline (Redis/BullMQ workers) to extract text (PDF/OCR), normalize it into transactions, and maintain analytics rollups + subscription detection.

Primary reference documents (by topic)

- Product + architecture overview: `ApplicationDevDocuments/AppDesignSummary.MD`
- Proposed stack + repo layout: `ApplicationDevDocuments/TechStack.MD`
- Tenant/user flows: `ApplicationDevDocuments/UserFlow.MD`
- API surface area: `ApplicationDevDocuments/ApiMapping.MD`
- Data model + queue pipeline notes: `ApplicationDevDocuments/SchemaMVP.MD`
- Keycloak setup + realm export snippets: `ApplicationDevDocuments/KeyCloakSettings.MD`, `ApplicationDevDocuments/KeyCloakRealmExport.MD`
- Testing approach + folder layout: `ApplicationDevDocuments/TESTBlueprint.MD`
- Release/rollback discipline: `ApplicationDevDocuments/ReleaseChecklist.MD`

Non‑negotiable quality gates (from day 1)

Definition of “Done” for any PR

- Unit tests cover domain/business rules.
- Integration tests cover the API + DB + queues + object storage (Testcontainers).
- API contract updated (OpenAPI + shared DTOs/contracts), aligned with `ApplicationDevDocuments/ApiMapping.MD`.
- Prisma migration included for any schema change, plus a “migrations run on empty DB” test.
- Baseline observability present (structured logs, meaningful errors).

CI must enforce (block merges)

- lint + typecheck
- unit tests
- integration tests (Testcontainers)
- minimal e2e smoke tests (critical flows only)
- migration deploy on a clean database

Phase 0 — Repo + environments + CI foundations (Sprint 0)

Goal: “Hello world” API + worker runs locally in Docker with Postgres/Redis/MinIO/Keycloak; CI runs tests reliably.

References

- `ApplicationDevDocuments/TechStack.MD` (repo structure + services)
- `ApplicationDevDocuments/KeyCloakRealmExport.MD` (realm import)
- `ApplicationDevDocuments/TESTBlueprint.MD` (Testcontainers setup)

Deliverables

- Monorepo scaffolding (apps: api, worker; packages: db, contracts, lib).
- Local `docker-compose` stack: Postgres, Redis, MinIO, Keycloak (realm import).
- Prisma package wired to Postgres, with initial migration created from `ApplicationDevDocuments/SchemaMVP.MD`.
- CI pipeline that:
  - installs, lints, typechecks
  - starts Testcontainers infra
  - runs `prisma migrate deploy` against a fresh DB
  - runs unit + integration + smoke e2e

Acceptance tests (minimum)

- `GET /health` returns `{ status: "ok" }` (API up).
- “migrations run on fresh DB” test exists and runs in CI (see `ApplicationDevDocuments/TESTBlueprint.MD`).

Phase 1 — Auth boundary + user bootstrap (Sprint 1)

Goal: API is a Keycloak resource server; every request resolves the caller to a local `User` row.

References

- `ApplicationDevDocuments/KeyCloakSettings.MD` (clients, PKCE, token settings)
- `ApplicationDevDocuments/KeyCloakRealmExport.MD` (JWT verification + role guard patterns)
- `ApplicationDevDocuments/ApiMapping.MD` (Users: `/me`)
- `ApplicationDevDocuments/SchemaMVP.MD` (User model + “don’t model workspace roles in Keycloak” guidance)
- `ApplicationDevDocuments/UserFlow.MD` (Signup/Login flow)

Deliverables

- JWT validation guard (issuer + JWKS + audience) applied globally; public route escape hatch for `/health`.
- `GET /me`:
  - validates JWT
  - finds/creates `User` by `keycloakSub` (`sub` claim)
  - returns local profile
- `PATCH /me` updates app-local profile fields only.
- Test auth strategy: integration tests do not require a live Keycloak (see test guard approach in `ApplicationDevDocuments/TESTBlueprint.MD`).

Acceptance tests (minimum)

- Integration test that hits `/me` with `x-test-sub` and asserts a `User` is created.

Phase 2 — Workspace multi-tenancy + membership guard (Sprint 2)

Goal: Workspace is the tenant boundary; authorization is DB-based and enforced consistently.

References

- `ApplicationDevDocuments/SchemaMVP.MD` (Workspace, WorkspaceMember, roles)
- `ApplicationDevDocuments/ApiMapping.MD` (Workspaces + Members endpoints)
- `ApplicationDevDocuments/UserFlow.MD` (Create workspace flow + guarantees)
- `ApplicationDevDocuments/TESTBlueprint.MD` (integration tests for workspace flows)

Deliverables

- Workspaces:
  - `POST /workspaces` creates workspace + OWNER membership
  - `GET /workspaces` lists memberships
  - `GET/PATCH/DELETE /workspaces/:workspaceId` (soft delete)
- Membership guard middleware/guard:
  - verifies membership for workspace-scoped routes
  - enforces role-based permissions (OWNER/ADMIN/MEMBER) per endpoint
- Member management:
  - list members
  - change roles (OWNER only)
  - remove member (cannot remove OWNER)

Acceptance tests (minimum)

- Integration: non-member cannot read a workspace (`403`).
- Integration: creating a workspace auto-creates OWNER membership.

Phase 3 — Invites (secure onboarding loop) (Sprint 3)

Goal: Invite lifecycle works end-to-end; tokens are never stored in plaintext.

References

- `ApplicationDevDocuments/SchemaMVP.MD` (WorkspaceInvite: tokenHash, status, expiry)
- `ApplicationDevDocuments/ApiMapping.MD` (Invites endpoints)
- `ApplicationDevDocuments/UserFlow.MD` (Invite flow + token hashing)
- `ApplicationDevDocuments/TESTBlueprint.MD` (token lifecycle tests)

Deliverables

- Invite creation:
  - generates a random token
  - stores only a hash
  - returns `inviteId` (and optionally `tokenForTestOnly` when `NODE_ENV=test`)
  - sends email via a provider abstraction (dev: log sink; prod: real provider later)
- Invite accept:
  - validates token hash + expiry + status
  - creates membership and marks invite accepted (single-use)
- Invite revoke + expiry handling (job or on-read expiry check).

Acceptance tests (minimum)

- Integration: accept succeeds once; second accept fails; expired token fails.

Phase 4 — Documents + object storage (Sprint 4)

Goal: Users can upload and retrieve documents safely; uploads trigger extraction asynchronously.

References

- `ApplicationDevDocuments/ApiMapping.MD` (Documents endpoints)
- `ApplicationDevDocuments/SchemaMVP.MD` (Document model; dedupe fields)
- `ApplicationDevDocuments/TechStack.MD` (MinIO/S3 approach)
- `ApplicationDevDocuments/UserFlow.MD` (manual upload flow)
- `ApplicationDevDocuments/TESTBlueprint.MD` (MinIO integration tests)

Deliverables

- Storage abstraction (S3-compatible):
  - generates presigned upload + download URLs
  - uses deterministic workspace-scoped `storageKey`
  - records `Document` row before upload
- API:
  - `POST /workspaces/:workspaceId/documents/upload-url`
  - `POST /workspaces/:workspaceId/documents/:documentId/complete` verifies object + enqueues extraction
  - list/filter documents + latest extraction state
  - soft-delete document
- Security:
  - enforce membership + document ownership checks (workspace-scoped)
  - do not proxy raw file bytes through the API (presigned URLs only in MVP)

Acceptance tests (minimum)

- Integration: presign → upload to MinIO → complete → extraction job queued.

Phase 5 — Worker/queue platform + extraction state machine (Sprint 5)

Goal: Background processing is reliable (retries/backoff), idempotent, observable, and safe to re-run.

References

- `ApplicationDevDocuments/SchemaMVP.MD` (queues, idempotency rules, retry guidance)
- `ApplicationDevDocuments/UserFlow.MD` (async pipeline stages)
- `ApplicationDevDocuments/TechStack.MD` (BullMQ + Redis, worker separation)
- `ApplicationDevDocuments/TESTBlueprint.MD` (worker integration tests + DLQ tests)

Deliverables

- Worker app that:
  - connects to Redis and consumes named queues
  - updates `Extraction.status` transitions (`PENDING → PROCESSING → SUCCEEDED/FAILED`)
  - persists failure metadata (`errorCode`, `errorMessage`)
- Job conventions:
  - stable `jobId` strategies where needed (e.g., rollups)
  - idempotent upserts matching unique constraints in `ApplicationDevDocuments/SchemaMVP.MD`
- DLQ strategy (BullMQ failed jobs + admin surfacing later in Phase 10).

Acceptance tests (minimum)

- Integration: enqueue extraction job → worker runs → extraction becomes `SUCCEEDED`.
- Integration: forced failure → retries occur → ends in `FAILED` and is queryable.

Phase 6 — Parsing + normalization → transactions + rollups (Sprint 6–7)

Goal: Uploading a PDF results in a normalized `Transaction` and an updated monthly analytics summary.

References

- `ApplicationDevDocuments/SchemaMVP.MD` (Extraction, Transaction fingerprint, AnalyticsMonthlyRollup)
- `ApplicationDevDocuments/ApiMapping.MD` (Transactions + Analytics endpoints)
- `ApplicationDevDocuments/UserFlow.MD` (doc_extract/doc_ocr/normalize/tx_upsert/rollup flow)
- `ApplicationDevDocuments/TechStack.MD` (pdf-parse, Tesseract/Poppler/ImageMagick suggestions)

Deliverables

- Extraction engines:
  - PDF text extraction path (no OCR)
  - OCR path for images/scanned PDFs (in worker)
  - normalized JSON shape (merchant/date/amount/currency + provenance)
- Transaction creation/upsert:
  - deterministic fingerprinting + dedupe (`@@unique([workspaceId, fingerprint])`)
  - merchant normalization + merchant upsert
  - basic categorization rules (MVP)
- Rollups:
  - `AnalyticsMonthlyRollup` updated via `rollup_monthly` job
  - `GET /analytics/summary` reads rollup; falls back to live aggregation if missing

Acceptance tests (minimum)

- Integration: document + extraction → worker pipeline produces a transaction and a rollup summary with correct totals.

Phase 7 — Email integrations (Gmail first, then Microsoft) (Sprint 8–9)

Goal: A connected mailbox can be scanned on-demand, producing documents and feeding the same extraction pipeline.

References

- `ApplicationDevDocuments/UserFlow.MD` (connect + email pipeline)
- `ApplicationDevDocuments/ApiMapping.MD` (connect-url/callback/sync endpoints)
- `ApplicationDevDocuments/SchemaMVP.MD` (ConnectedEmailAccount, EmailMessage + dedupe)
- `ApplicationDevDocuments/TechStack.MD` (gmail API, Microsoft Graph, queues)
- `ApplicationDevDocuments/AppDesignSummary.MD` (email scanning considerations + scaling notes)

Deliverables

- Provider adapter interface (Gmail, then Microsoft) with:
  - token exchange + refresh handling
  - message listing with incremental cursor (gmail historyId / ms delta token)
  - attachment retrieval
- Token storage:
  - encrypt tokens before persistence
  - implement revoke/disconnect behavior
- Sync jobs:
  - `email_sync` fetches messages and writes `EmailMessage` idempotently
  - `email_parse` extracts attachments, writes `Document`, enqueues extraction jobs

Acceptance tests (minimum)

- Integration: mocked adapter returns 2 messages with attachments → `EmailMessage` + `Document` created once (dedupe holds) and extraction jobs queued.

Phase 8 — Subscriptions + categories/merchants UX endpoints (Sprint 10)

Goal: Users can view active subscriptions and refine categorization via API endpoints.

References

- `ApplicationDevDocuments/ApiMapping.MD` (Merchants/Categories/Subscriptions endpoints)
- `ApplicationDevDocuments/SchemaMVP.MD` (Subscription model; Merchant/Category models)
- `ApplicationDevDocuments/UserFlow.MD` (subscription_detect job logic)

Deliverables

- Subscription detection job:
  - rules-based recurrence (same merchant, interval heuristics, amount tolerance)
  - update `Subscription.lastChargedAt` and `nextDueAt` when predictable
- Endpoints:
  - list/update subscriptions (activate/deactivate, interval override)
  - list merchants/categories; create custom categories (optional MVP)
  - edit transaction merchant/category/description

Acceptance tests (minimum)

- Integration: seed repeating transactions → detect → subscription created/updated deterministically.

Phase 9 — Admin + ops + security hardening (Sprint 11)

Goal: Operate safely in production: metrics, rate limits, DLQ visibility, platform admin access control.

References

- `ApplicationDevDocuments/ReleaseChecklist.MD` (operational checks + rollback)
- `ApplicationDevDocuments/KeyCloakRealmExport.MD` (platform_admin role check)
- `ApplicationDevDocuments/ApiMapping.MD` (Admin endpoints)
- `ApplicationDevDocuments/TechStack.MD` (observability + security hardening)

Deliverables

- Admin endpoints protected by Keycloak realm role `platform_admin`:
  - list workspaces/users (minimal)
  - view failed jobs/DLQ + retry
- Observability:
  - structured logging + request ids
  - Prometheus metrics endpoint (HTTP + worker job stats)
  - baseline dashboards/alerts in staging
- Security hardening:
  - rate limiting + abuse protection
  - strict CORS and redirect URI discipline per environment
  - secrets management plan (docker secrets now; vault later)
  - audit log events for sensitive operations (invite revoke, disconnect email, admin retries)

Acceptance tests (minimum)

- Integration: non-admin cannot hit `/admin/*`; admin can.
- Integration: rate limit enforced on a chosen endpoint.

Phase 10 — Production readiness + release process (Sprint 12)

Goal: Staging→production promotion is repeatable with safe migrations, backups, smoke tests, and rollback clarity.

References

- `ApplicationDevDocuments/ReleaseChecklist.MD` (staging/prod steps + rollback)
- `ApplicationDevDocuments/SchemaMVP.MD` (expand/contract guidance + idempotency constraints)
- `ApplicationDevDocuments/AppDesignSummary.MD` (deployment/migrations/scale considerations)

Deliverables

- Environments:
  - staging auto-deploy from `main`
  - production manual promote with a tagged image
- Database migration discipline:
  - `prisma migrate deploy` in deploy pipeline
  - backups/snapshots before migration
  - large backfills done via background jobs (no long locks)
- Smoke test checklist implemented as scripted checks (or documented runbook) matching `ApplicationDevDocuments/ReleaseChecklist.MD`.
- Incident readiness:
  - rollback runbook (old images, snapshot restore criteria)
  - post-incident “add regression test” policy

Optional Phase 11 — Goals + affordability simulation (future-ready endpoints)

Goal: Deliver “planning” endpoints as rules-based MVP, then iterate with more advanced analytics.

References

- `ApplicationDevDocuments/ApiMapping.MD` (Goals + simulations endpoints)
- `ApplicationDevDocuments/UserFlow.MD` (goal_analysis + affordability flow)
- `ApplicationDevDocuments/AppDesignSummary.MD` (recommendation engine concepts)

Deliverables

- Goals CRUD (basic) + background analysis job that produces suggestions from rollups/categories.
- Affordability simulation endpoint (rules-based) that references current spend + goal targets.
