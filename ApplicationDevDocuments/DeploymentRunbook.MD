# Deployment runbook (staging + production)

This repo is Docker-first. The recommended release shape is:

- build two images: `api` and `worker`
- deploy both using the same tagged version
- run `prisma migrate deploy` against the target DB
- run smoke checks (`scripts/smoke/api-smoke.sh`)

## Required environment variables

API (`apps/api`)

- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT` (omit for AWS; include for MinIO)
- `S3_PRESIGN_ENDPOINT` (optional; if set, used for browser-facing presigned URLs)
- `S3_ALLOW_SELF_SIGNED` (optional; set to `true` to allow self-signed TLS certs for S3 endpoints)
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `TOKEN_ENCRYPTION_KEY` (base64 32 bytes for AES-256-GCM)
- `KEYCLOAK_ISSUER`
- `KEYCLOAK_JWKS_URI`
- `KEYCLOAK_AUDIENCE`
- `CORS_ORIGINS` (optional; comma-separated)
- `OAUTH_ALLOWED_REDIRECT_URIS` (required in production; comma-separated absolute URLs)

Worker (`apps/worker`)

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT` (omit for AWS; include for MinIO)
- `S3_ALLOW_SELF_SIGNED` (optional; set to `true` to allow self-signed TLS certs for S3 endpoints)
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `TOKEN_ENCRYPTION_KEY`

## Build images (local)

Build both images with a tag:

```bash
TAG=staging-$(date +%Y%m%d%H%M%S)
IMAGE_PREFIX=ghcr.io/<org-or-user-lowercase>/famfinance
./scripts/release/build-images.sh
```

## Deploy (Docker Compose example)

Use `infra/docker/docker-compose.deploy.example.yml` + `infra/docker/env.vps.example` as a template for a VPS-style deployment.

## Split-VPS topology (recommended)

Two VPSes:

- **Infra VPS**: Postgres, Redis, MinIO, Keycloak
- **App VPS**: `api`, `worker`, and `migrate`

Templates:

- Infra VPS compose: `infra/docker/docker-compose.infra.example.yml`
- Infra VPS env: `infra/docker/env.infra.example`

Security:

- Expose Postgres/Redis/MinIO only to the App VPS (provider private network or firewall/security group rules).
- Keycloak should be reachable by browsers; put it behind TLS (reverse proxy) and set `KEYCLOAK_ISSUER` to the public URL.

## Coolify single-VPS topology (recommended for MVP)

If you already run Coolify on one VPS, the simplest MVP deployment is to run:

- Postgres, Redis, MinIO, Keycloak, API, worker, and the one-off migrate runner

Templates:

- Compose: `infra/docker/docker-compose.coolify.example.yml`
- Env: `infra/docker/env.coolify.example`
- Step-by-step: `ApplicationDevDocuments/BeginnerDeployCoolify.MD`

Coolify notes:

- Expose only `api` (port 4000) and `keycloak` (port 8080) via Coolify domains/TLS.
- Do not publish Postgres/Redis/MinIO ports publicly.
- Run migrations by executing the `migrate` service once per deploy (before starting `api`/`worker`).

Suggested VPS layout

- `/opt/famfinance/docker-compose.yml` (copy from `infra/docker/docker-compose.deploy.example.yml`)
- `/opt/famfinance/.env` (copy from `infra/docker/env.vps.example` and fill values)

Deploy steps (VPS)

1) Publish images to GHCR (workflow)

Run `Publish Images` in GitHub Actions (`.github/workflows/publish-images.yml`) with a tag.

2) Login to GHCR on the VPS (one-time)

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

3) Pull + migrate + start

```bash
cd /opt/famfinance
export TAG=<tag>
docker compose pull
docker compose run --rm migrate
docker compose up -d api worker
```

Or deploy from your machine:

```bash
VPS_HOST=... VPS_USER=... TAG=<tag> ./scripts/release/deploy-vps.sh
```

## Migrations (deploy-time)

Run migrations against the target DB before/with the new release:

```bash
DATABASE_URL=... ./scripts/release/migrate-deploy.sh
```

For VPS deployments (no repo checkout on the server), prefer the `migrate` image:

```bash
cd /opt/famfinance
export TAG=<tag>
docker compose run --rm migrate
```

## Smoke checks

The smoke script supports a minimal check (`/health`) with no auth, and deeper checks if you supply tokens.

```bash
BASE_URL=https://staging-api.example.com ./scripts/smoke/api-smoke.sh
BASE_URL=https://staging-api.example.com OWNER_TOKEN=... ./scripts/smoke/api-smoke.sh
```
