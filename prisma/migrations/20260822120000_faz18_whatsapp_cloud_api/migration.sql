-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "WhatsAppTemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "CommunicationMessageStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "CommunicationMessageStatus" ADD VALUE 'READ';

-- CreateTable
CREATE TABLE "whatsapp_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessPhone" TEXT,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "tokenLastFour" TEXT,
    "apiVersion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectionStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "status" "WhatsAppTemplateStatus" NOT NULL,
    "componentsJson" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN "whatsAppTemplateId" TEXT;
ALTER TABLE "message_templates" ADD COLUMN "whatsAppParameterMapping" JSONB;

-- CreateIndex
CREATE INDEX "whatsapp_integrations_tenantId_deletedAt_isActive_idx" ON "whatsapp_integrations"("tenantId", "deletedAt", "isActive");

-- CreateIndex
CREATE INDEX "whatsapp_templates_tenantId_status_idx" ON "whatsapp_templates"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_integrationId_name_language_key" ON "whatsapp_templates"("integrationId", "name", "language");

-- CreateIndex
CREATE INDEX "communication_messages_providerMessageId_idx" ON "communication_messages"("providerMessageId");

-- AddForeignKey
ALTER TABLE "whatsapp_integrations" ADD CONSTRAINT "whatsapp_integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_whatsAppTemplateId_fkey" FOREIGN KEY ("whatsAppTemplateId") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
