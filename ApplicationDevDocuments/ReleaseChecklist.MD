Release checklist (Staging → Production)

Use this every time. Print it into docs/release-checklist.md.

A) Pre-merge checklist (PR-level)

 All CI checks green (unit + integration + migrations + e2e smoke)

 New endpoints documented (OpenAPI updated)

 New DB migration is included and reviewed

 Backwards compatibility considered (expand/contract if needed)

 Feature flag added if risky / partially rolled out

 Runbook references:

 - Deployment: `ApplicationDevDocuments/DeploymentRunbook.MD`
 - Rollback: `ApplicationDevDocuments/RollbackRunbook.MD`

B) Staging deployment checklist

 Deploy to staging automatically from main

 Run migrate deploy on staging DB

 (Optional) build/publish images:

 - local: `TAG=... IMAGE_PREFIX=... ./scripts/release/build-images.sh`
 - GitHub Actions: run workflow `Publish Images` (`.github/workflows/publish-images.yml`)

 VPS deploy artifacts:

 - Compose template: `infra/docker/docker-compose.deploy.example.yml`
 - Env template: `infra/docker/env.vps.example`
 - Deploy helper: `scripts/release/deploy-vps.sh`

 Infra VPS artifacts (split deployment):

 - Compose template: `infra/docker/docker-compose.infra.example.yml`
 - Env template: `infra/docker/env.infra.example`

 Coolify single-VPS artifacts:

 - Compose template: `infra/docker/docker-compose.coolify.example.yml`
 - Env template: `infra/docker/env.coolify.example`
 - Beginner guide: `ApplicationDevDocuments/BeginnerDeployCoolify.MD`

 Smoke test flows:

 Run scripted smoke checks (recommended):

 `BASE_URL=https://staging-api.example.com OWNER_TOKEN=... ./scripts/smoke/api-smoke.sh`

 login bootstrap /me

 create workspace

 invite member + accept

 upload doc + extraction pipeline completes

 analytics summary renders

 Verify worker queues are processing (no stuck jobs)

 Verify DLQ count is stable/zero

 Verify logs show no new error spikes

 Verify CORS + redirect URIs correct for staging frontends

C) Production readiness checklist (gate before promote)

 Confirm staging has run for N hours without error spikes

 Confirm DB backup is available (automatic snapshot)

 Confirm migration is safe:

 runs under transaction (if possible)

 no long table locks (large backfills handled by background job)

 Confirm secrets exist in prod (Keycloak URLs, S3 keys, Redis, DB)

 Confirm dashboards/alerts working (logs, metrics, error tracking)

D) Production deployment steps

 Put system in “safe mode” if needed (optional; only for risky migrations)

 Take/confirm fresh DB snapshot

 Run migrations (prisma migrate deploy)

 Deploy new API + worker images

 Run production smoke tests:

 health endpoint

 login

 one workspace operation

 queue job processes successfully

 (Optional) scripted smoke check if you can supply bearer tokens:

 `BASE_URL=https://api.example.com OWNER_TOKEN=... ./scripts/smoke/api-smoke.sh`

 Monitor for 30–60 minutes:

 error rate

 latency

 worker failures / DLQ

E) Rollback plan (must be prepared)

 Previous Docker image tag available

 If migration is non-reversible, rollback = redeploy old app + hotfix forward

 If reversible:

 run down migration (rare) OR restore snapshot

F) Post-release

 Tag release in git

 Record any incidents + add tests for any bugs found

 Update changelog
