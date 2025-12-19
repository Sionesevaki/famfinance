Below is an API map that matches the user flows and the modules we designed. It’s MVP-focused, multi-tenant (workspace-scoped), and assumes Keycloak handles auth while your API enforces workspace membership.

I’ll group by domain/module and include request/response shape at a high level.

Conventions

All requests require Authorization: Bearer <access_token> (except GET /health).

Workspace-scoped endpoints use either:

path: /workspaces/:workspaceId/...

or header: X-Workspace-Id: <id> (optional; path is simpler for MVP)

API returns 403 if user is not a member of that workspace.

0) Health
GET /health

Used by load balancer / uptime checks

Returns { status: "ok" }

1) Users
GET /me

Flow: Login bootstrap
Returns: user profile synced with Keycloak

Response:

{ "id":"...", "email":"...", "fullName":"..." }

PATCH /me

Update profile fields (not auth-related)

Body:

{ "fullName":"Jane Doe" }

2) Workspaces (Family)
POST /workspaces

Flow: Create family workspace
Body:

{ "name":"Smith Family", "currency":"EUR" }


Response:

{ "workspaceId":"..." }

GET /workspaces

List workspaces current user belongs to

GET /workspaces/:workspaceId

Workspace details + user role

PATCH /workspaces/:workspaceId

Rename, change currency (OWNER/ADMIN)

DELETE /workspaces/:workspaceId

Soft-delete workspace (OWNER only)

3) Workspace Members
GET /workspaces/:workspaceId/members

List members + roles

PATCH /workspaces/:workspaceId/members/:memberId

Change role (OWNER only)

Body:

{ "role":"ADMIN" }

DELETE /workspaces/:workspaceId/members/:memberId

Remove a member (OWNER/ADMIN; cannot remove OWNER)

4) Invites
POST /workspaces/:workspaceId/invites

Flow: Invite family member
Body:

{ "email":"person@example.com", "role":"MEMBER" }


Response:

{ "inviteId":"...", "expiresAt":"..." }

GET /workspaces/:workspaceId/invites

List invites (OWNER/ADMIN)

POST /invites/accept

Flow: Invite acceptance
Body:

{ "token":"raw_invite_token_from_link" }


Response:

{ "workspaceId":"...", "membershipRole":"MEMBER" }

POST /workspaces/:workspaceId/invites/:inviteId/revoke

Revoke invite (OWNER/ADMIN)

5) Email Integrations (Connect + Manage + Sync)
GET /workspaces/:workspaceId/integrations/email

List connected email accounts

POST /workspaces/:workspaceId/integrations/email/:provider/connect-url

Returns provider auth URL (frontend redirects user there)

Providers: gmail | microsoft

Response:

{ "url":"https://accounts.google.com/o/oauth2/v2/auth?..." }

POST /workspaces/:workspaceId/integrations/email/:provider/callback

Provider redirects here (or frontend calls this with code)

Body:

{ "code":"...", "redirectUri":"..." }


Response:

{ "connectedEmailAccountId":"...", "status":"CONNECTED" }

POST /workspaces/:workspaceId/integrations/email/:connectedId/sync

Flow: “Scan now” button
Enqueues email_sync job.

Response:

{ "jobId":"...", "queued":true }

DELETE /workspaces/:workspaceId/integrations/email/:connectedId

Disconnect (revokes tokens in DB; optionally call provider revoke)

6) Documents (Uploads + Listing + Download)
POST /workspaces/:workspaceId/documents/upload-url

Preferred: pre-signed upload (S3/MinIO)

Body:

{ "filename":"statement.pdf", "mimeType":"application/pdf", "sizeBytes": 12345 }


Response:

{
  "documentId":"...",
  "uploadUrl":"https://minio/...signed...",
  "storageKey":"workspaces/.../statement.pdf"
}

POST /workspaces/:workspaceId/documents/:documentId/complete

Frontend calls after upload finished
API verifies object exists, then enqueues extraction

Response:

{ "queued": true }

GET /workspaces/:workspaceId/documents

Query params:

type=RECEIPT|INVOICE|STATEMENT|...

q=amazon (if Meilisearch enabled)

limit/offset

GET /workspaces/:workspaceId/documents/:documentId

Document metadata + latest extraction status

GET /workspaces/:workspaceId/documents/:documentId/download-url

Returns pre-signed download URL

DELETE /workspaces/:workspaceId/documents/:documentId

Soft-delete doc (also can delete object if you want)

7) Extractions (Status + Rerun)
GET /workspaces/:workspaceId/extractions

Filter:

status=PENDING|FAILED|...

documentId=...

GET /workspaces/:workspaceId/extractions/:extractionId

Returns extracted text (optional) + normalizedJson

POST /workspaces/:workspaceId/documents/:documentId/extract

Force re-run extraction with engine version

Body:

{ "engine":"pipeline-v1" }

8) Transactions (Ledger)
GET /workspaces/:workspaceId/transactions

Query:

from=2025-01-01&to=2025-01-31

categoryId=...

merchantId=...

source=EMAIL|UPLOAD|BANK

limit/offset

POST /workspaces/:workspaceId/transactions

Manual add (MVP optional)

Body:

{
  "occurredAt":"2025-12-17T00:00:00Z",
  "amountCents": 1299,
  "currency":"EUR",
  "description":"Groceries",
  "merchantName":"Albert Heijn",
  "categoryName":"Groceries"
}

PATCH /workspaces/:workspaceId/transactions/:transactionId

Edit category/merchant/description

DELETE /workspaces/:workspaceId/transactions/:transactionId

Soft-delete

9) Merchants + Categories
GET /workspaces/:workspaceId/merchants
GET /workspaces/:workspaceId/categories
POST /workspaces/:workspaceId/categories

Create custom category (optional)

10) Subscriptions
GET /workspaces/:workspaceId/subscriptions
PATCH /workspaces/:workspaceId/subscriptions/:subscriptionId

set active=false

update interval/name/amount if needed

POST /workspaces/:workspaceId/subscriptions/detect

Enqueue subscription_detect job

11) Analytics (Dashboard)
GET /workspaces/:workspaceId/analytics/summary

Query:

month=2025-12 (or from/to)

Response:

{
  "month":"2025-12",
  "currency":"EUR",
  "totalCents": 123456,
  "byCategory": { "Groceries": 45000, "Utilities": 30000 },
  "byMerchant": { "Amazon": 12000 }
}

POST /workspaces/:workspaceId/analytics/rollup

Force rollup job (admin-ish; OWNER/ADMIN)

12) Goals (future-ready but simple MVP)
POST /workspaces/:workspaceId/goals

Body:

{ "type":"SAVINGS", "name":"Vacation", "targetCents":500000, "targetDate":"2026-06-01" }

GET /workspaces/:workspaceId/goals
POST /workspaces/:workspaceId/goals/:goalId/plan

Enqueue goal analysis job → returns suggestions (initially rules-based)

13) “Affordability” Simulation (future-ready endpoint)
POST /workspaces/:workspaceId/simulations/afford

Body:

{ "newExpenseMonthlyCents": 4999, "name":"New subscription" }


Response (MVP rules):

{
  "canAfford": false,
  "shortfallMonthlyCents": 2000,
  "suggestedCuts": [
    { "category":"Dining Out", "reduceByCents": 2000 }
  ]
}

14) Admin (Platform Owner)

Protected by Keycloak realm role platform_admin

GET /admin/workspaces
GET /admin/users
GET /admin/jobs/failed

Returns DLQ-like failures

POST /admin/jobs/:jobId/retry
GET /admin/metrics

Prometheus scrape or summary

Worker-facing / Internal-only endpoints (optional)

If you want workers to call API (instead of direct DB), add internal endpoints behind a network policy or a separate token.

But MVP recommendation:

Workers use Prisma directly (same DB) + consistent domain services in packages/lib to avoid duplicated logic.