# famfinance

Backend for a family/workspace finance app (documents + email ingestion → extraction → transactions → analytics).

## Quickstart (Docker-only)

1. Start the full dev stack:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
```

2. Apply migrations and generate Prisma client (runs in a one-off container):

```bash
docker compose -f infra/docker/docker-compose.yml run --rm api pnpm --filter @famfinance/db prisma:generate
docker compose -f infra/docker/docker-compose.yml run --rm api pnpm --filter @famfinance/db migrate:deploy
```

3. API is available at `http://localhost:4000/health`.

Keycloak is available at `http://localhost:8080` (realm import is configured in `infra/docker/keycloak/realm-export.json`).

## Local commands without Node installed

This repo includes a helper to run `pnpm` via a Node Docker image:

```bash
./scripts/pnpm.sh -v
./scripts/pnpm.sh install
./scripts/pnpm.sh -r test
```

