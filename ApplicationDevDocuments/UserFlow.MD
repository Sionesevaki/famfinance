Below is a clear user-flow diagram (conceptual + step-by-step) covering the core MVP use cases, written so it maps directly to the backend architecture we designed (Keycloak, Prisma, queues, workers).

I’ll give you:

High-level system flow

Detailed user flows per use case

Where backend modules + jobs are involved

What is synchronous vs async

1) High-level system flow (mental model)
User (Web / Mobile / Admin)
        |
        v
Keycloak (Auth, MFA, Social Login)
        |
        v
API (NestJS)
  ├─ Workspace & Membership
  ├─ Documents & Integrations
  ├─ Transactions & Analytics
  └─ Admin / Governance
        |
        v
Postgres (Prisma) + Redis (Queues)
        |
        v
Workers (Email Scan, OCR, Parsing, Analytics)
        |
        v
Storage (MinIO / S3) + Search (Meilisearch)


Rule of thumb

User-facing actions → API

Heavy/slow work → Workers (async)

Auth → Keycloak only

Truth of finance data → Postgres

2) Core user flows (diagrammed)
A) Signup & Login (Email / Google / Microsoft)
User
 └─ clicks "Sign up / Login"
     └─ redirected to Keycloak
         ├─ Email+Password (+MFA)
         ├─ Google
         └─ Microsoft
              |
              v
        Keycloak issues tokens (PKCE)
              |
              v
        Frontend receives access token
              |
              v
        API validates JWT (issuer, aud, jwks)
              |
              v
        API:
          - finds or creates User(keycloakSub)
          - returns user profile


Backend modules

authz (JWT validation)

users

Notes

No passwords stored in your DB

MFA & social handled fully by Keycloak

B) Create family workspace
User (authenticated)
 └─ POST /workspaces
        |
        v
API:
  - create Workspace
  - create WorkspaceMember(role=OWNER)
        |
        v
Response: workspaceId


Backend modules

workspaces

users

Guarantees

Workspace is the tenant boundary

All data from now on is scoped by workspaceId

C) Invite family member
Workspace Owner/Admin
 └─ POST /workspaces/{id}/invites
        |
        v
API:
  - generate random token
  - store hashed token
  - send invite email
        |
        v
Invitee receives email

Invite acceptance
Invitee clicks invite link
 └─ redirected to frontend
     └─ login/signup via Keycloak
          |
          v
     POST /invites/accept
          |
          v
API:
  - validate token hash + expiry
  - create WorkspaceMember(role=MEMBER)
  - mark invite ACCEPTED


Backend modules

workspaces

notifications

Security

Tokens are hashed

Invites are single-use + expiring

D) Connect email account (Gmail / Outlook)
User
 └─ clicks "Connect Email"
     |
     v
Frontend → OAuth redirect (Google/Microsoft)
     |
     v
Provider returns auth code
     |
     v
API:
  - exchange code for tokens
  - encrypt tokens
  - store ConnectedEmailAccount
     |
     v
Queue job: email_sync(accountId)


Backend modules

integrations/email

workers/email_sync

Async

Email scanning never blocks UI

E) Email scanning → receipt/invoice extraction
email_sync job
 └─ fetch new provider messages
     ├─ dedupe via providerMsgId / hash
     └─ store EmailMessage
           |
           v
      enqueue email_parse

email_parse job
 └─ extract attachments
     └─ store Document (S3/MinIO)
           |
           v
     enqueue doc_extract / doc_ocr

doc_extract / doc_ocr
 └─ extract text
     └─ create Extraction
           |
           v
     enqueue normalize

normalize
 └─ identify:
     - merchant
     - date
     - amount
     - currency
           |
           v
     enqueue tx_upsert

tx_upsert
 └─ compute fingerprint
 ├─ dedupe transaction
 └─ insert/update Transaction
           |
           v
     enqueue rollup_monthly


Backend modules

documents

extraction

transactions

analytics

Key properties

Fully idempotent

Safe retries

DLQ on failure

F) Upload bank statement / document manually
User
 └─ uploads file
        |
        v
API:
  - store file in S3/MinIO
  - create Document
        |
        v
enqueue doc_extract / doc_ocr


Same pipeline as email, just different source.

G) View spending dashboard
User
 └─ GET /analytics/summary?month=2025-09
        |
        v
API:
  - fetch AnalyticsMonthlyRollup
  - fallback to live aggregation if missing
        |
        v
Response:
  - total spend
  - by category
  - by merchant
  - subscriptions


Fast

Pre-aggregated

Cached if needed

H) Subscription detection (automatic)
subscription_detect job (scheduled)
 └─ scan transactions
     └─ find recurring patterns
           |
           v
     create/update Subscription


MVP logic

Same merchant

Same amount (± tolerance)

Regular interval

I) User sets goal (savings / purchase)
User
 └─ POST /goals
        |
        v
API:
  - store goal
  - enqueue goal_analysis

goal_analysis
 └─ analyze:
     - current spend
     - subscriptions
     - discretionary categories
           |
           v
     generate suggestions


Future

This evolves into ML/AI

Same pipeline remains valid

J) “Can I afford this?” scenario (future-ready)
User
 └─ enters new desired expense
        |
        v
API:
  - simulate cashflow
  - compare against goals
        |
        v
Response:
  - yes/no
  - suggested cuts
  - alternative providers


Uses

Transactions

Subscriptions

Analytics

Recommendation engine

K) Admin (platform owner)
Admin user
 └─ logs in (Keycloak role: platform_admin)
        |
        v
GET /admin/*
        |
        v
API:
  - platform stats
  - failed jobs (DLQ)
  - requeue jobs


Strict

Role-based access

Separate frontend

3) Sync vs Async summary
Action	Type
Login	Sync
Create workspace	Sync
Invite member	Sync
Accept invite	Sync
Connect email	Sync
Scan emails	Async
OCR / parsing	Async
Create transactions	Async
Analytics rollups	Async
Dashboard read	Sync
Admin DLQ ops	Sync
4) Why this flow scales and stays sane

No blocking UI on heavy work

Everything re-runnable

Clear tenant boundary

Auth decoupled from business logic

Easy to add bank integrations

AI fits naturally later