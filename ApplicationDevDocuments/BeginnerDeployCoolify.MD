# Beginner deployment guide (Coolify on a single VPS)

This guide is written for deploying **everything on one VPS** running **Coolify** (Contabo in your case):

- Postgres (app DB)
- Postgres (Keycloak DB)
- Redis
- MinIO (S3-compatible storage)
- Keycloak
- famfinance API
- famfinance worker
- famfinance migrate runner (one-off service you run on deploy)

If you later want to split infra to another VPS, you’ll mostly just change env vars (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, Keycloak URLs).

## 0) What you need

- A VPS with Coolify installed and working.
- A GitHub repo containing this project.
- Ability to SSH to the VPS (recommended for first deploy and troubleshooting).
- Optional (recommended): a domain you control.

You said you don’t know your final domain until you deploy. That’s OK — you can deploy using the VPS IP first, then switch to domains later by updating env vars.

## 1) Publish Docker images to GHCR (GitHub Container Registry)

This repo includes a manual workflow that builds and pushes 3 images:

- `ghcr.io/<owner-lowercase>/famfinance-api:<tag>`
- `ghcr.io/<owner-lowercase>/famfinance-worker:<tag>`
- `ghcr.io/<owner-lowercase>/famfinance-migrate:<tag>`

Note: GHCR requires repository names to be lowercase.

### 1.1 Run the publish workflow

In GitHub:

1. Go to **Actions**
2. Select **Publish Images**
3. Click **Run workflow**
4. Set `tag` to something like `staging-001`

Wait for the workflow to complete.

### 1.2 Login to GHCR on the VPS

On your VPS, you need Docker to be able to pull private GHCR images.

1. Create a GitHub token with **read:packages** scope (classic PAT works).
2. SSH to the VPS and run:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

If your packages are public, this might not be required, but it’s safer to assume you need it.

## 2) Create a Coolify “Docker Compose” resource

You will deploy with:

- Compose template: `infra/docker/docker-compose.coolify.example.yml`
- Env template: `infra/docker/env.coolify.example`

### 2.1 Add the Compose file in Coolify

In Coolify:

1. Create a **Project**
2. Add a **Resource** → **Docker Compose**
3. Paste the contents of `infra/docker/docker-compose.coolify.example.yml`
4. Replace `ghcr.io/<org-or-user>/...` with your GHCR path:
   - usually `ghcr.io/<github-username-or-org-lowercase>/famfinance-api:${TAG}`
   - same for `worker` and `migrate`

### 2.2 Add environment variables in Coolify

Copy values from `infra/docker/env.coolify.example` into Coolify’s environment variable UI.

At minimum you must set:

- `TAG` (the same tag you published)
- App DB: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- Keycloak DB: `KC_POSTGRES_USER`, `KC_POSTGRES_PASSWORD`, `KC_POSTGRES_DB`
- MinIO: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET`
- `TOKEN_ENCRYPTION_KEY` (must be 32 bytes base64)

Generate `TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

### 2.3 First deploy (without domains)

You can deploy first with IP-based access, then switch to domains later:

- API will be reachable via Coolify’s proxy once you expose it (next step).
- Keycloak should be exposed too (so you can log in and obtain tokens).
- MinIO must be reachable by your frontend/device to use presigned upload/download URLs.

## 3) Configure public access in Coolify (no domain yet)

You need 2–3 “public” endpoints:

- API (port 4000)
- Keycloak (port 8080)
- MinIO S3 endpoint (port 9000) if you want browser uploads via presigned URLs

In Coolify, add public access (domain or IP routing) for:

- `api` → port `4000`
- `keycloak` → port `8080`
- `minio` → port `9000` (optional but recommended if you’re not proxying uploads through API)

If you don’t have domains yet, you can temporarily use the VPS IP and forwarded ports, but TLS/hostnames will be better once you add domains.

## 4) Set Keycloak issuer + JWKS correctly (important)

Your API validates JWTs using:

- `KEYCLOAK_ISSUER`
- `KEYCLOAK_JWKS_URI`
- `KEYCLOAK_AUDIENCE`

Keycloak tokens contain an `iss` claim. The API will reject tokens if `iss` doesn’t exactly match `KEYCLOAK_ISSUER`.

### 4.1 Temporary (before you know your domain)

If Keycloak is reachable at (example):

- `http://<VPS_IP>:8080`

Set:

- `KEYCLOAK_ISSUER=http://<VPS_IP>:8080/realms/family-finance`

Leave `KEYCLOAK_JWKS_URI` as-is in compose (it points to the internal service URL):

- `http://keycloak:8080/realms/family-finance/protocol/openid-connect/certs`

### 4.2 Later (when you have a domain + TLS)

If your Keycloak domain is:

- `https://auth.yourdomain.com`

Update:

- `KC_HOSTNAME=auth.yourdomain.com`
- `KEYCLOAK_ISSUER=https://auth.yourdomain.com/realms/family-finance`

Then redeploy the stack.

## 5) Run DB migrations (required on every deploy)

This repo publishes a dedicated `migrate` image that runs:

- `pnpm --filter @famfinance/db migrate:deploy`

In Coolify, run the `migrate` service once after you pull a new tag.

If Coolify doesn’t provide a one-off “run service” button, SSH to the server and run in the resource directory:

```bash
docker compose run --rm migrate
```

Then start/restart `api` and `worker`.

## 6) Smoke test the deployment

Minimal check (no auth required):

```bash
BASE_URL=http://<api-host>:4000 ./scripts/smoke/api-smoke.sh
```

Deeper smoke requires a real Keycloak token:

```bash
BASE_URL=https://api.yourdomain.com OWNER_TOKEN="..." ./scripts/smoke/api-smoke.sh
```

## 7) Common beginner problems (and fixes)

### “Invalid token” from API

- `KEYCLOAK_ISSUER` does not match token `iss`
- Fix: update `KEYCLOAK_ISSUER` to the exact URL users authenticate against and redeploy.

### `Token missing sub` from API

- The API expects OIDC access tokens to include the standard `sub` claim.
- If you see this error:
  - Decode the access token payload and confirm it has `sub`.
  - Ensure you are sending the access token (starts with `eyJ...`), not an opaque token.
  - In Keycloak, avoid protocol mappers that overwrite/remove the `sub` claim.

### Presigned upload URL fails from browser

- Your presigned S3 URL host is not reachable from the browser (common when `S3_ENDPOINT=http://minio:9000`).
- Fix options:
  - Recommended: keep `S3_ENDPOINT=http://minio:9000` (internal) and set `S3_PRESIGN_ENDPOINT` to your public MinIO domain (prefer `https://...`).
  - Alternatively: set `S3_ENDPOINT` itself to a public MinIO domain (works, but routes API/worker traffic through that hostname too).

### `Uploaded object not found in storage` after clicking upload

- The API couldn’t `HEAD` the object after the browser uploaded it.
- Common causes:
  - The browser upload didn’t actually reach MinIO (CORS/DNS/TLS/proxy), even though the frontend proceeded.
  - `S3_ENDPOINT` points to a different MinIO than the one used to generate the presigned URL (`S3_PRESIGN_ENDPOINT`).
  - The MinIO user policy allows `PutObject` but not `HeadObject/GetObject` (server-side check fails).
  - Cloudflare proxy/WAF is in front of your MinIO S3 API domain and returns non-S3 403 responses (AWS SDK reports `Unknown (HTTP 403)`).
- Fix:
  - Confirm the `uploadUrl` host matches your MinIO domain and that the object exists in the bucket.
  - Ensure `S3_ENDPOINT` and `S3_PRESIGN_ENDPOINT` point to the same MinIO (or set only `S3_ENDPOINT`).
  - Ensure the credentials have `s3:GetObject` permission (required for HEAD/GET).
  - If using Cloudflare, set the MinIO S3 API DNS record to **DNS only** (no proxy / grey cloud) or fully bypass WAF/caching for that hostname.

### `self-signed certificate` when calling S3/MinIO

- Your `S3_ENDPOINT` (or `S3_PRESIGN_ENDPOINT`) is `https://...` but uses a self-signed TLS certificate.
- Fix: use a proper TLS cert for MinIO (recommended), or temporarily set `S3_ALLOW_SELF_SIGNED=true` for `api` and `worker`.

### `InvalidAccessKeyId` when calling S3/MinIO

- The `S3_ACCESS_KEY` / `S3_SECRET_KEY` configured for `api`/`worker` do not match the MinIO user you’re connecting to.
- Fix:
  - In MinIO, create/confirm an access key + secret key pair.
  - Set `S3_ACCESS_KEY` + `S3_SECRET_KEY` in Coolify for the API and worker services and redeploy.

### Document extraction never starts (no worker activity)

Symptoms:

- Upload succeeds and `POST /.../documents/:id/complete` returns `200`
- Document extraction stays `PENDING` / never changes
- Worker logs show only the startup line and no `[doc_extract] started job ...`

Most common causes:

- `REDIS_URL` differs between `api` and `worker` in Coolify (each service can have its own env vars)
- `worker` is not running / crashing / restarting
- `worker` points at the wrong `DATABASE_URL` (updates won’t be visible in the app)

Fix / checks:

- Ensure `REDIS_URL` is identical for `api` and `worker`
- Ensure `DATABASE_URL` is identical for `api` and `worker`
- Upload a document again and watch worker logs for `[doc_extract] started job ...`

### Keycloak realm didn’t import

- Ensure `infra/docker/keycloak/realm-export.json` is present in the repo and the compose volume mount points to it.
- Check Keycloak logs in Coolify.

## 8) What is “not production-ready” yet (known limitations)

- Email OAuth is still a placeholder (no real code exchange/refresh in production).
- Rate limiting is in-memory (fine for single instance MVP, not for multi-replica HA).
