Prisma schema (MVP-ready)

Create this in packages/db/prisma/schema.prisma.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
}

enum InviteStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}

enum ProviderType {
  GMAIL
  MICROSOFT
  IMAP
}

enum DocumentType {
  RECEIPT
  INVOICE
  STATEMENT
  SUBSCRIPTION
  OTHER
}

enum ExtractionStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
}

enum TransactionSource {
  EMAIL
  UPLOAD
  BANK
  MANUAL
}

enum SubscriptionInterval {
  WEEKLY
  MONTHLY
  YEARLY
  UNKNOWN
}

model User {
  id           String   @id @default(cuid())
  keycloakSub  String   @unique // Keycloak user "sub"
  email        String   @unique
  fullName     String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships  WorkspaceMember[]
  invitesSent  WorkspaceInvite[] @relation("InvitesSent")
  uploads      Document[]        @relation("UploadedBy")
}

model Workspace {
  id          String   @id @default(cuid())
  name        String
  currency    String   @default("EUR")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  members     WorkspaceMember[]
  invites     WorkspaceInvite[]
  documents   Document[]
  merchants   Merchant[]
  txns        Transaction[]
  subs        Subscription[]
}

model WorkspaceMember {
  id          String        @id @default(cuid())
  workspaceId String
  userId      String
  role        WorkspaceRole @default(MEMBER)
  createdAt   DateTime      @default(now())

  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  user        User      @relation(fields: [userId], references: [id])

  @@unique([workspaceId, userId])
  @@index([userId])
}

model WorkspaceInvite {
  id            String       @id @default(cuid())
  workspaceId   String
  invitedEmail  String
  tokenHash     String       @unique // store hashed token, never raw
  status        InviteStatus @default(PENDING)
  expiresAt     DateTime
  createdAt     DateTime     @default(now())
  acceptedAt    DateTime?
  revokedAt     DateTime?

  invitedById   String
  invitedBy     User         @relation("InvitesSent", fields: [invitedById], references: [id])
  workspace     Workspace    @relation(fields: [workspaceId], references: [id])

  @@index([workspaceId])
  @@index([invitedEmail])
}

model ConnectedEmailAccount {
  id            String       @id @default(cuid())
  workspaceId   String
  userId        String
  provider      ProviderType
  providerEmail String
  status        String       @default("CONNECTED") // CONNECTED / ERROR / REVOKED
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  // OAuth tokens should be encrypted before storage (app-layer)
  accessTokenEnc  String?
  refreshTokenEnc String?
  tokenExpiresAt  DateTime?

  // idempotency cursor
  lastSyncAt    DateTime?
  lastHistoryId String? // gmail historyId, or ms delta token etc.

  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  user          User      @relation(fields: [userId], references: [id])

  emailMessages EmailMessage[]
  @@index([workspaceId])
  @@index([userId])
  @@unique([provider, providerEmail, workspaceId])
}

model EmailMessage {
  id              String   @id @default(cuid())
  workspaceId     String
  connectedId     String
  providerMsgId   String   // Gmail messageId / MS messageId
  subject         String?
  fromEmail       String?
  sentAt          DateTime?
  snippet         String?
  createdAt       DateTime @default(now())

  // used for dedupe
  sha256          String?  @unique

  connected       ConnectedEmailAccount @relation(fields: [connectedId], references: [id])
  workspace       Workspace             @relation(fields: [workspaceId], references: [id])

  documents       Document[]

  @@unique([connectedId, providerMsgId])
  @@index([workspaceId])
}

model Document {
  id            String       @id @default(cuid())
  workspaceId   String
  type          DocumentType @default(OTHER)
  filename      String
  mimeType      String
  sizeBytes     Int
  storageKey    String       @unique // S3 key
  checksumSha256 String?     // file dedupe
  uploadedAt    DateTime     @default(now())
  deletedAt     DateTime?

  uploadedById  String?
  uploadedBy    User?        @relation("UploadedBy", fields: [uploadedById], references: [id])

  emailMessageId String?
  emailMessage   EmailMessage? @relation(fields: [emailMessageId], references: [id])

  workspace     Workspace @relation(fields: [workspaceId], references: [id])

  extractions   Extraction[]
  txns          Transaction[]

  @@index([workspaceId])
  @@index([emailMessageId])
}

model Extraction {
  id            String           @id @default(cuid())
  workspaceId   String
  documentId    String
  status        ExtractionStatus @default(PENDING)
  engine        String           @default("pipeline-v1") // evolve versions safely
  startedAt     DateTime?
  finishedAt    DateTime?
  errorCode     String?
  errorMessage  String?

  // store extracted text (or pointer) + normalized JSON
  extractedText   String?
  normalizedJson  Json?

  document      Document  @relation(fields: [documentId], references: [id])
  workspace     Workspace @relation(fields: [workspaceId], references: [id])

  @@index([workspaceId, status])
  @@unique([documentId, engine])
}

model Merchant {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  normalized  String   // e.g. "amazon"
  createdAt   DateTime @default(now())

  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  txns        Transaction[]
  subs        Subscription[]

  @@unique([workspaceId, normalized])
  @@index([workspaceId])
}

model Category {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  createdAt   DateTime @default(now())

  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  txns        Transaction[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model Transaction {
  id            String            @id @default(cuid())
  workspaceId   String
  source        TransactionSource @default(EMAIL)
  occurredAt    DateTime
  amountCents   Int
  currency      String            @default("EUR")
  description   String?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  deletedAt     DateTime?

  merchantId    String?
  categoryId    String?
  documentId    String?
  extractionId  String?

  // dedupe: same merchant+amount+date+workspace
  fingerprint   String?

  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  merchant      Merchant? @relation(fields: [merchantId], references: [id])
  category      Category? @relation(fields: [categoryId], references: [id])
  document      Document? @relation(fields: [documentId], references: [id])
  extraction    Extraction? @relation(fields: [extractionId], references: [id])

  @@index([workspaceId, occurredAt])
  @@index([workspaceId, merchantId])
  @@index([workspaceId, categoryId])
  @@unique([workspaceId, fingerprint])
}

model Subscription {
  id            String               @id @default(cuid())
  workspaceId   String
  merchantId    String?
  name          String
  interval      SubscriptionInterval @default(UNKNOWN)
  amountCents   Int?
  currency      String              @default("EUR")
  lastChargedAt DateTime?
  nextDueAt     DateTime?
  active        Boolean             @default(true)
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  merchant      Merchant? @relation(fields: [merchantId], references: [id])

  @@index([workspaceId, active])
}

model AnalyticsMonthlyRollup {
  id          String   @id @default(cuid())
  workspaceId String
  year        Int
  month       Int
  currency    String   @default("EUR")
  totalCents  Int      @default(0)
  byCategory  Json?    // { "Groceries": 12345, ... }
  byMerchant  Json?    // { "Amazon": 9999, ... }
  updatedAt   DateTime @updatedAt

  workspace   Workspace @relation(fields: [workspaceId], references: [id])

  @@unique([workspaceId, year, month, currency])
  @@index([workspaceId, year, month])
}

Notes that prevent pain later

Workspace multi-tenancy everywhere (workspaceId on all core records).

Soft deletes (deletedAt) for safety.

Idempotency/dedupe: Transaction.fingerprint, EmailMessage.sha256, Document.storageKey/checksum.

Extraction versioning: engine so you can rerun newer pipelines without overwriting old results.

2) Keycloak setup (don’t model “workspace roles” in Keycloak)

Keycloak is perfect for:

Login (email/pass)

Social login (Google/Microsoft)

MFA

Sessions, refresh tokens

Platform-wide admin roles

Keycloak is not great for “dynamic, per-workspace roles” because you’d create tons of groups/roles and constantly sync them.

Recommended approach

Keycloak handles identity

Your DB handles workspace membership + role

Keycloak realm model

Realm: family-finance

Clients

api (confidential)

Your NestJS API validates JWTs from this client.

web / mobile (public)

Uses Authorization Code Flow + PKCE.

admin (public)

Same flow, but your API checks platform_admin.

Realm roles

platform_admin (for your internal admin frontend)

(optional) support_agent

JWT contents

sub = Keycloak user id → map to User.keycloakSub

email, name

realm roles for platform-level control

Authorization in API (the clean rule)

If platform_admin: allow admin endpoints

Else: require workspace membership in DB:

WorkspaceMember(workspaceId, userId) must exist

enforce role checks per endpoint (OWNER/ADMIN/MEMBER)

This keeps your workspace logic consistent even if you later swap auth providers.

3) Job flow, queues, retries, DLQ, idempotency (BullMQ)
Queues

Create queues like this (in apps/worker):

email_sync – fetch new messages (per connected account)

email_parse – parse message bodies/attachments → create Document

doc_extract – PDF text extraction

doc_ocr – OCR for images/scanned PDFs

normalize – build Extraction.normalizedJson (merchant/amount/date)

categorize – map to Category

tx_upsert – create/dedupe Transaction

subscription_detect – rules-based recurring detection

rollup_monthly – update AnalyticsMonthlyRollup

dlq_* – dead-letter equivalents (or use BullMQ “failed” + a dedicated requeue tool)

Flow (event-driven pipeline)

Trigger points

User connects email → enqueue email_sync(connectedEmailAccountId)

Cron (repeatable job) every X hours → enqueue email_sync for all connected accounts

User uploads doc → enqueue doc_extract(documentId) (or doc_ocr if image)

Pipeline

email_sync finds new provider messages → writes EmailMessage (dedupe) → enqueue email_parse

email_parse stores attachments as Document → enqueue doc_extract/doc_ocr

extraction produces Extraction(normalizedJson) → enqueue tx_upsert + rollup_monthly

Retry/backoff defaults (good MVP baseline)

attempts: 8

backoff: { type: "exponential", delay: 30_000 } (30s → 1m → 2m → 4m …)

removeOnComplete: true

removeOnFail: false (keep failures for audit)

DLQ strategy (simple + safe)

When a job fails after max attempts:

Write a DB record in Extraction (or a generic JobFailure table if you add one)

Move to dlq_<queue> with payload + error

Expose an admin endpoint:

list DLQ items

retry (requeue)

mark ignored

Idempotency (this matters a lot)

Every stage should be re-runnable without duplicating data:

EmailMessage: @@unique([connectedId, providerMsgId]) + optional sha256

Document: storageKey unique + checksumSha256 to detect re-uploads

Extraction: @@unique([documentId, engine]) ensures you don’t create duplicates

Transaction: compute fingerprint, then @@unique([workspaceId, fingerprint])

Example fingerprint logic (in code):

fingerprint = sha256(workspaceId + occurredAt(YYYY-MM-DD) + amountCents + normalizedMerchant + currency)

Concurrency

email_sync: low concurrency (e.g., 5–20) to avoid provider rate limits

parsing/OCR: higher but depends on CPU

rollups: 1 per workspace (use jobId = rollup:${workspaceId}:${year}:${month})