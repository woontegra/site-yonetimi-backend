-- Bank statement import: fingerprint dedupe + column mapping templates
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "importFingerprint" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "bank_transactions_tenantId_bankAccountId_importFingerprint_key"
  ON "bank_transactions"("tenantId", "bankAccountId", "importFingerprint");

CREATE TABLE IF NOT EXISTS "bank_column_mapping_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "bankAccountId" TEXT,
  "name" TEXT NOT NULL,
  "mapping" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "bank_column_mapping_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bank_column_mapping_templates_tenantId_siteId_deletedAt_idx"
  ON "bank_column_mapping_templates"("tenantId", "siteId", "deletedAt");

CREATE INDEX IF NOT EXISTS "bank_column_mapping_templates_bankAccountId_deletedAt_idx"
  ON "bank_column_mapping_templates"("bankAccountId", "deletedAt");

ALTER TABLE "bank_column_mapping_templates"
  DROP CONSTRAINT IF EXISTS "bank_column_mapping_templates_tenantId_fkey";
ALTER TABLE "bank_column_mapping_templates"
  ADD CONSTRAINT "bank_column_mapping_templates_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_column_mapping_templates"
  DROP CONSTRAINT IF EXISTS "bank_column_mapping_templates_siteId_fkey";
ALTER TABLE "bank_column_mapping_templates"
  ADD CONSTRAINT "bank_column_mapping_templates_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_column_mapping_templates"
  DROP CONSTRAINT IF EXISTS "bank_column_mapping_templates_bankAccountId_fkey";
ALTER TABLE "bank_column_mapping_templates"
  ADD CONSTRAINT "bank_column_mapping_templates_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
