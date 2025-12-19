Recommended tech stack (Docker-first, Node.js)
Core backend

Framework: NestJS (TypeScript)

Modular architecture out of the box (great for long-term maintainability).

API style: REST + OpenAPI/Swagger (Nest Swagger)

Database: PostgreSQL

ORM + migrations: Prisma

Prisma migrations are predictable + versioned (avoid “accidental schema drift”).

Auth (OSS, don’t build from scratch): Keycloak

Email/password, social login (Google/Microsoft), MFA, sessions, roles.

Your API becomes a resource server validating JWTs (standard, clean).

Async jobs / queues: BullMQ + Redis

For email scans, document parsing, recurring sync jobs.

File storage: S3-compatible object storage

MinIO (OSS) in dev/staging; AWS S3 / similar in prod.

Email integrations:

Gmail API (googleapis) + Microsoft Graph (official SDK)

Optional fallback for generic providers later: IMAP (node-imap) + mailparser

Document parsing (OSS):

PDF text extraction: pdf-parse (or pdfjs)

OCR: run Tesseract in a worker container (best results via system binary, not JS)

Image/PDF pre-processing: ImageMagick / Poppler (pdftoppm)

Search (optional but valuable, OSS): Meilisearch

Full-text search over extracted invoice/receipt text.

Observability (OSS):

Logging: pino

Metrics: prom-client + Prometheus/Grafana

Tracing: OpenTelemetry

Security hardening:

helmet, rate limiting (nestjs/throttler), CSRF (if cookies), strict CORS

Secrets via env + docker secrets (later: Vault)

Testing

Unit/Integration: Jest

API tests: supertest

Real infra in tests: testcontainers (spins up Postgres/Redis/MinIO in CI)

Contract schemas: Zod (shared DTO validation) + OpenAPI as source of truth

Repo structure (monorepo, clean modularity)

Use pnpm workspaces (or npm workspaces) + turborepo for fast builds/tests.

repo/
  apps/
    api/                      # NestJS HTTP API (web/app/admin clients)
      src/
        main.ts
        app.module.ts
        config/
        common/               # guards, interceptors, filters, pipes
        modules/
          authz/              # Keycloak JWT validation, RBAC helpers
          workspaces/         # workspace + invites + membership
          users/              # user profile (app-side), preferences
          integrations/
            email/
              gmail/
              microsoft/
              imap/           # optional later
          documents/          # upload, metadata, access control
          extraction/         # normalized extraction records
          transactions/       # ledger-like store of spend items
          subscriptions/      # recurring detection (MVP rules-based)
          analytics/          # spend summaries, category rollups
          notifications/      # email/app notifications (later)
        db/                   # Prisma client wiring only (no schema here)
      test/

    worker/                   # NestJS/BullMQ workers (no HTTP)
      src/
        processors/
          email-scan.processor.ts
          document-ocr.processor.ts
          pdf-extract.processor.ts
          categorize.processor.ts
        jobs/
        db/
      test/

    admin-api/                # optional (if you want stricter admin separation)
      src/

  packages/
    db/                       # Prisma schema + migrations (single source of truth)
      prisma/
        schema.prisma
        migrations/
      src/
        client.ts
      seed/

    contracts/                # shared DTOs + Zod schemas + OpenAPI types
      src/
        workspace.ts
        transaction.ts
        document.ts

    lib/                      # shared utilities (logging, config, crypto, etc.)
      src/
        env.ts
        logger.ts
        crypto.ts
        s3.ts

  infra/
    docker/
      docker-compose.yml      # local dev stack (postgres, redis, minio, keycloak, meili)
      keycloak/
        realm-export.json
    k8s/                      # later (helm charts/manifests)

  scripts/
    migrate.sh
    seed.sh
    test-e2e.sh

  .github/workflows/
    ci.yml                    # lint + unit + integration (testcontainers) + build images

  README.md
  pnpm-workspace.yaml
  turbo.json

Why this structure works

apps/api stays purely request/response + orchestration.

apps/worker owns all heavy tasks (OCR, scanning, parsing, categorization).

packages/db guarantees one migration pipeline (no duplicate schemas).

packages/contracts prevents frontend/backend drift (types + validation shared).

Open-source components you’ll “plug in” instead of building

Authentication + MFA + social login:

✅ Keycloak (drop-in, proven, Docker-friendly)

Searchable document text:

✅ Meilisearch (simple, fast)

OCR + PDF tooling:

✅ Tesseract + Poppler (battle-tested)

Async processing:

✅ BullMQ + Redis (simple ops, scalable enough for MVP)

S3 storage (dev + prod parity):

✅ MinIO locally, switch to S3 later with same API

Minimal Docker Compose services (dev)

postgres

redis

minio

keycloak

meilisearch (optional)

api

worker