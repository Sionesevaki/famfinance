Implemented Phase 0 foundation and started Phase 1–2 basics.

Monorepo scaffold: apps/api, apps/worker, packages/db, packages/lib, packages/contracts plus workspace config (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json).
Dev infra: infra/docker/docker-compose.yml (Postgres/Redis/MinIO/Keycloak/API/worker) + Keycloak realm import at infra/docker/keycloak/realm-export.json.
DB: Prisma schema + initial migration in packages/db/prisma/schema.prisma and packages/db/prisma/migrations/....
API: NestJS app with /health, /me, /workspaces in apps/api/src/* + Keycloak JWT guard (testable) and Prisma wiring.
Worker: basic BullMQ worker skeleton in apps/worker/src/main.ts.
Tests + CI: migration test in packages/db/test/migrations.int.spec.ts, API integration/e2e tests in apps/api/test/*, GitHub Actions workflow in .github/workflows/ci.yml.
Verified in-container: typecheck, lint, DB migration test, API integration tests, API smoke e2e all pass.

Phase 0 has to come first because everything else depends on it (repo layout, Docker stack, Prisma, CI, test harness).

After that, I didn’t actually jump to Phase 3 (invites). What I implemented was:

Phase 1 basics: auth boundary scaffolding (apps/api/src/common/auth/*) + /me.
Phase 2 basics: workspace tenancy primitives (apps/api/src/modules/workspaces/*) so the app has a tenant boundary to hang later features off.
The reason I started Phase 1–2 immediately after Phase 0 is that invites/documents/email/transactions all need a real User + Workspace + membership model in place first, otherwise we’d build features without the tenant boundary and have to refactor.

Phase 2 (Workspace tenancy) progress

- Added workspace membership + role enforcement primitives: `apps/api/src/tenancy/workspace-member.guard.ts`, `apps/api/src/tenancy/workspace-role.guard.ts`, `apps/api/src/tenancy/workspace-roles.decorator.ts`.
- Added members endpoints: `apps/api/src/modules/workspaces/workspace-members.controller.ts` and related DTO at `apps/api/src/modules/workspaces/dto/update-member-role.dto.ts`.
- Expanded workspace service to support member listing/role changes/removal: `apps/api/src/modules/workspaces/workspaces.service.ts`.
- Added integration coverage for members/roles: `apps/api/test/integration/members.int.spec.ts`.

Phase 3 (Invites) progress

- Added `WorkspaceInvite.role` to the schema + migration: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20251217195000_invite_role/migration.sql`.
- Added invite lifecycle endpoints and logic:
  - Workspace-scoped: `apps/api/src/modules/invites/workspace-invites.controller.ts` (`POST /workspaces/:id/invites`, `GET /workspaces/:id/invites`, `POST /workspaces/:id/invites/:inviteId/revoke`)
  - Global accept: `apps/api/src/modules/invites/invites.controller.ts` (`POST /invites/accept`)
  - Core logic: `apps/api/src/modules/invites/invites.service.ts` (token generation + SHA-256 hashing, expiry, acceptance creates membership, revoke).
- Added integration coverage: `apps/api/test/integration/invites.int.spec.ts`.

Phase 4 (Documents) progress

- Added S3/MinIO storage wrapper with bucket auto-create + presigned URLs: `apps/api/src/storage/s3.service.ts`.
- Added documents endpoints:
  - `POST /workspaces/:workspaceId/documents/upload-url`
  - `POST /workspaces/:workspaceId/documents/:documentId/complete` (creates Extraction + enqueues `doc_extract`)
  - `GET /workspaces/:workspaceId/documents` + `GET /workspaces/:workspaceId/documents/:documentId`
  - `GET /workspaces/:workspaceId/documents/:documentId/download-url`
  - `DELETE /workspaces/:workspaceId/documents/:documentId` (soft delete)
  in `apps/api/src/modules/documents/documents.controller.ts` + `apps/api/src/modules/documents/documents.service.ts`.
- Added integration coverage for presign→upload→complete→download: `apps/api/test/integration/documents.int.spec.ts`.

Phase 5 (Worker extraction) progress

- Added `doc_extract` worker that:
  - marks Extraction `PROCESSING → SUCCEEDED/FAILED`
  - fetches document object from MinIO/S3
  - extracts text for `text/*` and `application/pdf` (via `pdf-parse`)
  in `apps/worker/src/processors/doc-extract.processor.ts`, `apps/worker/src/workers/doc-extract.worker.ts`, `apps/worker/src/main.ts`.
- Added worker-side MinIO/S3 helper: `apps/worker/src/storage/s3.ts`.
- Wired worker env for MinIO access in dev compose: `infra/docker/docker-compose.yml`.
- Added worker integration coverage: `apps/worker/test/integration/doc-extract.int.spec.ts`.

Phase 6 (Transactions + analytics rollups) progress

- Added pipeline workers:
  - `normalize` populates `Extraction.normalizedJson` from `Extraction.extractedText`: `apps/worker/src/processors/normalize.processor.ts`, `apps/worker/src/workers/normalize.worker.ts`
  - `tx_upsert` creates/dedupes `Transaction` + `Merchant`, then enqueues monthly rollup: `apps/worker/src/processors/tx-upsert.processor.ts`, `apps/worker/src/workers/tx-upsert.worker.ts`
  - `rollup_monthly` writes/updates `AnalyticsMonthlyRollup`: `apps/worker/src/processors/rollup-monthly.processor.ts`, `apps/worker/src/workers/rollup-monthly.worker.ts`
  - Updated worker main to run all queues: `apps/worker/src/main.ts`
- Added API read endpoints:
  - `GET /workspaces/:workspaceId/transactions`: `apps/api/src/modules/transactions/transactions.controller.ts`
  - `GET /workspaces/:workspaceId/analytics/summary?month=YYYY-MM`: `apps/api/src/modules/analytics/analytics.controller.ts`
- Expanded transactions API:
  - `GET /workspaces/:workspaceId/transactions` supports `categoryId`, `merchantId`, `source` filters: `apps/api/src/modules/transactions/dto/list-transactions.query.ts`, `apps/api/src/modules/transactions/transactions.service.ts`
  - `POST /workspaces/:workspaceId/transactions` (manual add), `PATCH /workspaces/:workspaceId/transactions/:transactionId`, `DELETE /workspaces/:workspaceId/transactions/:transactionId`: `apps/api/src/modules/transactions/transactions.controller.ts`, `apps/api/src/modules/transactions/transactions.service.ts`
- Added end-to-end pipeline integration test (doc upload → extraction → normalize → transaction → rollup → analytics): `apps/api/test/integration/pipeline.int.spec.ts`.

Phase 8 (Subscriptions + merchants/categories UX endpoints) progress

- Added `subscription_detect` worker: `apps/worker/src/processors/subscription-detect.processor.ts`, `apps/worker/src/workers/subscription-detect.worker.ts`, wired into `apps/worker/src/main.ts`.
- Added API endpoints:
  - `GET /workspaces/:workspaceId/subscriptions`
  - `POST /workspaces/:workspaceId/subscriptions/detect` (enqueues `subscription_detect`)
  - `PATCH /workspaces/:workspaceId/subscriptions/:subscriptionId`
  in `apps/api/src/modules/subscriptions/subscriptions.controller.ts` + `apps/api/src/modules/subscriptions/subscriptions.service.ts`.
- Added merchants/categories endpoints:
  - `GET /workspaces/:workspaceId/merchants`: `apps/api/src/modules/merchants/merchants.controller.ts`
  - `GET /workspaces/:workspaceId/categories` and `POST /workspaces/:workspaceId/categories`: `apps/api/src/modules/categories/categories.controller.ts`
- Added integration coverage:
  - Worker detection logic: `apps/worker/test/integration/subscription-detect.int.spec.ts`
  - API enqueue + worker creates results: `apps/api/test/integration/subscriptions.int.spec.ts`
  - Transactions CRUD + merchants/categories listing: `apps/api/test/integration/transactions-crud.int.spec.ts`

Phase 7 (Email integrations) progress

- Added token encryption helpers (AES-256-GCM) using `TOKEN_ENCRYPTION_KEY`: `packages/lib/src/crypto.ts` (exported via `packages/lib/src/index.ts`).
- Added email integration API endpoints (list/connect/callback/sync/disconnect): `apps/api/src/modules/integrations/email/email-integrations.controller.ts`, `apps/api/src/modules/integrations/email/email-integrations.service.ts`, wired via `apps/api/src/modules/integrations/email/email-integrations.module.ts`.
- Added worker email ingestion pipeline:
  - `email_sync` (mock-driven for tests) writes `EmailMessage` + enqueues `email_parse`: `apps/worker/src/processors/email-sync.processor.ts`, `apps/worker/src/workers/email-sync.worker.ts`
  - `email_parse` uploads attachments to S3/MinIO as `Document` + creates `Extraction` + enqueues `doc_extract`: `apps/worker/src/processors/email-parse.processor.ts`, `apps/worker/src/workers/email-parse.worker.ts`
  - wired into `apps/worker/src/main.ts`.
- Added integration coverage: `apps/api/test/integration/email-ingestion.int.spec.ts`.

Phase 9 (Admin + ops + security hardening) progress (partial)

- Added Keycloak realm-role guard for platform admin access: `apps/api/src/common/auth/platform-admin.guard.ts`.
- Added admin endpoints:
  - `GET /admin/workspaces`, `GET /admin/users`: `apps/api/src/modules/admin/admin.controller.ts`
  - `GET /admin/jobs/failed?queue=...` and `POST /admin/jobs/:jobId/retry?queue=...`: `apps/api/src/modules/admin/admin.controller.ts`
  - `GET /admin/metrics` (simple JSON counts + queue job counts): `apps/api/src/modules/admin/admin.controller.ts`
  - `GET /admin/metrics/prometheus` (Prometheus text format): `apps/api/src/modules/admin/admin.controller.ts`, `apps/api/src/modules/admin/admin.service.ts`
  - wired via `apps/api/src/modules/admin/admin.module.ts` and `apps/api/src/app.module.ts`
- Added baseline observability:
  - request IDs (`x-request-id`) applied to every response: `apps/api/src/common/http/request-id.interceptor.ts`
  - JSON access logs per request (skipped in tests): `apps/api/src/common/http/http-logging.interceptor.ts`
  - centralized app configuration (CORS + validation) shared by prod + tests: `apps/api/src/app.configure.ts`, `apps/api/src/main.ts`, `apps/api/test/integration/setup/app.ts`
- Added rate limiting (in-memory, per-process) for `POST /invites/accept`: `apps/api/src/common/security/rate-limit.guard.ts`, `apps/api/src/modules/invites/invites.controller.ts`
- Added integration coverage: `apps/api/test/integration/admin.int.spec.ts`.
- Added audit trail support:
  - DB: `AuditLog` model + migration: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20251219120000_audit_log/migration.sql`
  - API: `AuditService` + module: `apps/api/src/modules/audit/audit.service.ts`, `apps/api/src/modules/audit/audit.module.ts`
  - Events recorded for invite revoke, email disconnect, and admin job retry: `apps/api/src/modules/invites/workspace-invites.controller.ts`, `apps/api/src/modules/integrations/email/email-integrations.controller.ts`, `apps/api/src/modules/admin/admin.controller.ts`
  - Integration coverage: `apps/api/test/integration/audit-log.int.spec.ts`
- Hardened OAuth redirect URIs:
  - Enforced `OAUTH_ALLOWED_REDIRECT_URIS` allowlist (required in production) for email connect-url/callback: `apps/api/src/modules/integrations/email/email-integrations.service.ts`
  - Integration coverage: `apps/api/test/integration/email-ingestion.int.spec.ts`

Phase 10 (Production readiness + release process) progress (partial)

- Added a scripted API smoke test covering health, auth, workspace create, and the doc→pipeline→analytics path: `scripts/smoke/api-smoke.sh`
- Documented smoke script usage in the release checklist: `ApplicationDevDocuments/ReleaseChecklist.MD`
- Added deployment/rollback runbooks: `ApplicationDevDocuments/DeploymentRunbook.MD`, `ApplicationDevDocuments/RollbackRunbook.MD`
- Added release scripts and templates:
  - build tagged images: `scripts/release/build-images.sh`
  - run `prisma migrate deploy` against a target DB: `scripts/release/migrate-deploy.sh`
  - VPS-style compose template using tagged images: `infra/docker/docker-compose.deploy.example.yml`
  - manual GH image publish workflow: `.github/workflows/publish-images.yml`
- Added deploy-ready migration runner image:
  - `@famfinance/db` migrate image Dockerfile: `packages/db/Dockerfile`
  - publish includes `famfinance-migrate:<tag>`: `.github/workflows/publish-images.yml`
- Added VPS deployment helper + env template:
  - `scripts/release/deploy-vps.sh`
  - `infra/docker/env.vps.example`
- Added split-VPS deployment templates (infra separate from app):
  - Infra VPS compose/env templates: `infra/docker/docker-compose.infra.example.yml`, `infra/docker/env.infra.example`
- Added Coolify single-VPS deployment templates:
  - Compose/env templates: `infra/docker/docker-compose.coolify.example.yml`, `infra/docker/env.coolify.example`
