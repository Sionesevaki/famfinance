-- Initial schema for famfinance (generated manually from prisma schema).

CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "ProviderType" AS ENUM ('GMAIL', 'MICROSOFT', 'IMAP');
CREATE TYPE "DocumentType" AS ENUM ('RECEIPT', 'INVOICE', 'STATEMENT', 'SUBSCRIPTION', 'OTHER');
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "TransactionSource" AS ENUM ('EMAIL', 'UPLOAD', 'BANK', 'MANUAL');
CREATE TYPE "SubscriptionInterval" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY', 'UNKNOWN');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "keycloakSub" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "fullName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_keycloakSub_key" ON "User"("keycloakSub");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

ALTER TABLE "WorkspaceMember"
  ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
  ADD CONSTRAINT "WorkspaceMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkspaceInvite" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "invitedEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedById" TEXT NOT NULL,
  CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");
CREATE INDEX "WorkspaceInvite_invitedEmail_idx" ON "WorkspaceInvite"("invitedEmail");

ALTER TABLE "WorkspaceInvite"
  ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceInvite"
  ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ConnectedEmailAccount" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "ProviderType" NOT NULL,
  "providerEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "accessTokenEnc" TEXT,
  "refreshTokenEnc" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastHistoryId" TEXT,
  CONSTRAINT "ConnectedEmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConnectedEmailAccount_workspaceId_idx" ON "ConnectedEmailAccount"("workspaceId");
CREATE INDEX "ConnectedEmailAccount_userId_idx" ON "ConnectedEmailAccount"("userId");
CREATE UNIQUE INDEX "ConnectedEmailAccount_provider_providerEmail_workspaceId_key"
  ON "ConnectedEmailAccount"("provider", "providerEmail", "workspaceId");

ALTER TABLE "ConnectedEmailAccount"
  ADD CONSTRAINT "ConnectedEmailAccount_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConnectedEmailAccount"
  ADD CONSTRAINT "ConnectedEmailAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EmailMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "connectedId" TEXT NOT NULL,
  "providerMsgId" TEXT NOT NULL,
  "subject" TEXT,
  "fromEmail" TEXT,
  "sentAt" TIMESTAMP(3),
  "snippet" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sha256" TEXT,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailMessage_connectedId_providerMsgId_key" ON "EmailMessage"("connectedId", "providerMsgId");
CREATE UNIQUE INDEX "EmailMessage_sha256_key" ON "EmailMessage"("sha256");
CREATE INDEX "EmailMessage_workspaceId_idx" ON "EmailMessage"("workspaceId");

ALTER TABLE "EmailMessage"
  ADD CONSTRAINT "EmailMessage_connectedId_fkey"
  FOREIGN KEY ("connectedId") REFERENCES "ConnectedEmailAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailMessage"
  ADD CONSTRAINT "EmailMessage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Document" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "checksumSha256" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "uploadedById" TEXT,
  "emailMessageId" TEXT,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_workspaceId_idx" ON "Document"("workspaceId");
CREATE INDEX "Document_emailMessageId_idx" ON "Document"("emailMessageId");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_emailMessageId_fkey"
  FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Extraction" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
  "engine" TEXT NOT NULL DEFAULT 'pipeline-v1',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "extractedText" TEXT,
  "normalizedJson" JSONB,
  CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Extraction_documentId_engine_key" ON "Extraction"("documentId", "engine");
CREATE INDEX "Extraction_workspaceId_status_idx" ON "Extraction"("workspaceId", "status");

ALTER TABLE "Extraction"
  ADD CONSTRAINT "Extraction_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Extraction"
  ADD CONSTRAINT "Extraction_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Merchant" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Merchant_workspaceId_normalized_key" ON "Merchant"("workspaceId", "normalized");
CREATE INDEX "Merchant_workspaceId_idx" ON "Merchant"("workspaceId");

ALTER TABLE "Merchant"
  ADD CONSTRAINT "Merchant_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_workspaceId_name_key" ON "Category"("workspaceId", "name");
CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Transaction" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "source" "TransactionSource" NOT NULL DEFAULT 'EMAIL',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "merchantId" TEXT,
  "categoryId" TEXT,
  "documentId" TEXT,
  "extractionId" TEXT,
  "fingerprint" TEXT,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Transaction_workspaceId_fingerprint_key" ON "Transaction"("workspaceId", "fingerprint");
CREATE INDEX "Transaction_workspaceId_occurredAt_idx" ON "Transaction"("workspaceId", "occurredAt");
CREATE INDEX "Transaction_workspaceId_merchantId_idx" ON "Transaction"("workspaceId", "merchantId");
CREATE INDEX "Transaction_workspaceId_categoryId_idx" ON "Transaction"("workspaceId", "categoryId");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_extractionId_fkey"
  FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "merchantId" TEXT,
  "name" TEXT NOT NULL,
  "interval" "SubscriptionInterval" NOT NULL DEFAULT 'UNKNOWN',
  "amountCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "lastChargedAt" TIMESTAMP(3),
  "nextDueAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Subscription_workspaceId_active_idx" ON "Subscription"("workspaceId", "active");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnalyticsMonthlyRollup" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "byCategory" JSONB,
  "byMerchant" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsMonthlyRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsMonthlyRollup_workspaceId_year_month_currency_key"
  ON "AnalyticsMonthlyRollup"("workspaceId", "year", "month", "currency");
CREATE INDEX "AnalyticsMonthlyRollup_workspaceId_year_month_idx"
  ON "AnalyticsMonthlyRollup"("workspaceId", "year", "month");

ALTER TABLE "AnalyticsMonthlyRollup"
  ADD CONSTRAINT "AnalyticsMonthlyRollup_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

