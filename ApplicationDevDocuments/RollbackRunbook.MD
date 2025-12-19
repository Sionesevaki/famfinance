# Rollback runbook

Goal: restore service quickly while protecting data integrity.

## Inputs you must have before deploying

- Previous API image tag available (known-good).
- Previous worker image tag available (known-good).
- A recent DB snapshot/backup (automated is fine).
- A clear decision rule for when to rollback (e.g., error rate spike, job failure spike, auth failures).

## Rollback decision guide

Rollback is appropriate when:

- the API fails readiness/health checks or has sustained elevated 5xx
- workers are failing jobs at a higher-than-baseline rate and retries do not recover
- auth misconfiguration blocks access (Keycloak issuer/JWKS/audience)

Do not rollback blindly if the release included non-reversible schema changes.

## Rollback procedure (Docker images)

1. Put the system in a safe mode (optional)
   - stop new ingestion triggers (pause cron/email sync)
   - keep workers running only if they are still safe

2. Redeploy previous images
   - set API image tag to the previous version
   - set worker image tag to the previous version
   - restart services

3. Validate
   - `GET /health`
   - `GET /me`
   - enqueue/observe one job path (doc upload → extraction)

## Database rollback options

Option A (preferred when schema changes are incompatible): restore snapshot

- restore the DB snapshot taken immediately before the release
- redeploy the previous API/worker images

Option B: forward-fix (preferred when data must be preserved and snapshot restore is too costly)

- redeploy previous images if needed to stabilize
- implement a hotfix that is compatible with the new schema (expand/contract discipline)
- deploy hotfix as a new tag

## Post-incident

- record the incident (what changed, failure mode, how it was detected)
- add regression tests (integration) for the failure mode
- add a release checklist item if a missed step caused it

