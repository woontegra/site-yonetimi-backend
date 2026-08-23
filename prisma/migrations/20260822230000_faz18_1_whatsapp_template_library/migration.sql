-- AlterEnum: add DRAFT to WhatsAppTemplateStatus
ALTER TYPE "WhatsAppTemplateStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

-- CreateEnum
CREATE TYPE "WhatsAppTemplateSource" AS ENUM ('META_SYNC', 'LIBRARY', 'CUSTOM');

-- AlterTable: new columns + nullable integrationId
ALTER TABLE "whatsapp_templates" ADD COLUMN "displayName" TEXT;
ALTER TABLE "whatsapp_templates" ADD COLUMN "source" "WhatsAppTemplateSource" NOT NULL DEFAULT 'META_SYNC';
ALTER TABLE "whatsapp_templates" ADD COLUMN "bodyText" TEXT;
ALTER TABLE "whatsapp_templates" ADD COLUMN "parameterMapping" JSONB;
ALTER TABLE "whatsapp_templates" ADD COLUMN "libraryKey" TEXT;
ALTER TABLE "whatsapp_templates" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "whatsapp_templates" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "whatsapp_templates" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "whatsapp_templates" ALTER COLUMN "integrationId" DROP NOT NULL;

-- Drop old unique constraint
DROP INDEX IF EXISTS "whatsapp_templates_integrationId_name_language_key";

-- Create new unique constraint and index
CREATE UNIQUE INDEX "whatsapp_templates_tenantId_name_language_key" ON "whatsapp_templates"("tenantId", "name", "language");
CREATE INDEX "whatsapp_templates_tenantId_deletedAt_idx" ON "whatsapp_templates"("tenantId", "deletedAt");
