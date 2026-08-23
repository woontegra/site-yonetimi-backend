-- FAZ 25: merkezi platform e-posta entegrasyonu, teslimat kaydı, aktivasyon tokenı

CREATE TYPE "SmtpSecurity" AS ENUM ('SSL_TLS', 'STARTTLS');
CREATE TYPE "PlatformEmailStatus" AS ENUM ('UNCONFIGURED', 'READY', 'ERROR', 'INACTIVE');
CREATE TYPE "EmailDeliveryType" AS ENUM ('TENANT_WELCOME_ACTIVATION', 'PLATFORM_NEW_TENANT_NOTIFICATION', 'SMTP_TEST');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "platform_email_integrations" (
    "id" TEXT NOT NULL,
    "providerType" TEXT NOT NULL DEFAULT 'SMTP',
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "replyToEmail" TEXT,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecurity" "SmtpSecurity" NOT NULL,
    "smtpUsername" TEXT NOT NULL,
    "encryptedSmtpPassword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "PlatformEmailStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorSummary" TEXT,
    "notificationEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "platform_email_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "type" "EmailDeliveryType" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "subject" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "safeErrorSummary" TEXT,
    "relatedTenantId" TEXT,
    "relatedUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_activation_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activation_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_activation_tokens_tokenHash_key" ON "user_activation_tokens"("tokenHash");
CREATE INDEX "user_activation_tokens_userId_usedAt_idx" ON "user_activation_tokens"("userId", "usedAt");
CREATE INDEX "user_activation_tokens_expiresAt_idx" ON "user_activation_tokens"("expiresAt");
CREATE INDEX "email_deliveries_status_createdAt_idx" ON "email_deliveries"("status", "createdAt");
CREATE INDEX "email_deliveries_type_createdAt_idx" ON "email_deliveries"("type", "createdAt");
CREATE INDEX "email_deliveries_relatedTenantId_createdAt_idx" ON "email_deliveries"("relatedTenantId", "createdAt");
CREATE INDEX "email_deliveries_relatedUserId_idx" ON "email_deliveries"("relatedUserId");

ALTER TABLE "platform_email_integrations" ADD CONSTRAINT "platform_email_integrations_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_relatedTenantId_fkey" FOREIGN KEY ("relatedTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_relatedUserId_fkey" FOREIGN KEY ("relatedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_activation_tokens" ADD CONSTRAINT "user_activation_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
