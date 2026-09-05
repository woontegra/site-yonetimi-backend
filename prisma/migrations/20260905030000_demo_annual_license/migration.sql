-- Demo + Yıllık organizasyon lisansı
-- Not: PostgreSQL aynı transaction içinde yeni enum değerini kullanmaya izin vermez.
-- Bu yüzden ADD VALUE kullanılmaz; enum yeniden oluşturulur.
--
-- Dönüşüm özeti:
--   plan STANDARD/PROFESSIONAL → ANNUAL; diğerleri (DEMO) → DEMO
--   status TRIAL → ACTIVE; diğer status değerleri korunur
--   tenantId UNIQUE: aynı anda birden fazla subscription satırı zaten yok
--   startsAt/endsAt değiştirilmez; yalnız plan/status/fiyat snapshot backfill

-- 1) Yeni fiyat / meta kolonları
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "netPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "grossPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'TRY',
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "createdByPlatformAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastModifiedByPlatformAdminId" TEXT;

-- 2) Plan enum: DEMO | ANNUAL (STANDARD/PROFESSIONAL → ANNUAL)
CREATE TYPE "SubscriptionPlan_new" AS ENUM ('DEMO', 'ANNUAL');
ALTER TABLE "subscriptions" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "subscriptions"
  ALTER COLUMN "plan" TYPE "SubscriptionPlan_new"
  USING (
    CASE
      WHEN "plan"::text IN ('STANDARD', 'PROFESSIONAL', 'ANNUAL') THEN 'ANNUAL'::"SubscriptionPlan_new"
      ELSE 'DEMO'::"SubscriptionPlan_new"
    END
  );
DROP TYPE "SubscriptionPlan";
ALTER TYPE "SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DEFAULT 'DEMO';

-- 3) Status enum: TRIAL → ACTIVE, TRIAL kaldırılır
CREATE TYPE "SubscriptionStatus_new" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscriptions"
  ALTER COLUMN "status" TYPE "SubscriptionStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'TRIAL' THEN 'ACTIVE'::"SubscriptionStatus_new"
      WHEN "status"::text = 'EXPIRED' THEN 'EXPIRED'::"SubscriptionStatus_new"
      WHEN "status"::text = 'SUSPENDED' THEN 'SUSPENDED'::"SubscriptionStatus_new"
      WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED'::"SubscriptionStatus_new"
      ELSE 'ACTIVE'::"SubscriptionStatus_new"
    END
  );
DROP TYPE "SubscriptionStatus";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 4) Fiyat backfill
UPDATE "subscriptions"
SET
  "netPrice" = 0,
  "vatAmount" = 0,
  "grossPrice" = 0,
  "vatRate" = 20,
  "currency" = 'TRY'
WHERE "plan" = 'DEMO';

UPDATE "subscriptions"
SET
  "netPrice" = 4000,
  "vatRate" = 20,
  "vatAmount" = 800,
  "grossPrice" = 4800,
  "currency" = 'TRY'
WHERE "plan" = 'ANNUAL' AND "netPrice" = 0;

UPDATE "subscriptions" SET "activatedAt" = "startsAt" WHERE "activatedAt" IS NULL;

-- 5) Eski trialEndsAt kaldır
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "trialEndsAt";

-- 6) FK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_createdByPlatformAdminId_fkey') THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_createdByPlatformAdminId_fkey"
      FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_lastModifiedByPlatformAdminId_fkey') THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_lastModifiedByPlatformAdminId_fkey"
      FOREIGN KEY ("lastModifiedByPlatformAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "subscriptions_plan_endsAt_idx" ON "subscriptions"("plan", "endsAt");

-- 7) Geçmiş tablosu
CREATE TABLE IF NOT EXISTS "subscription_history" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousValues" JSONB,
  "newValues" JSONB,
  "reason" TEXT NOT NULL,
  "performedById" TEXT NOT NULL,
  "netPrice" DECIMAL(12,2),
  "vatRate" DECIMAL(5,2),
  "vatAmount" DECIMAL(12,2),
  "grossPrice" DECIMAL(12,2),
  "currency" TEXT DEFAULT 'TRY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_history_subscriptionId_fkey') THEN
    ALTER TABLE "subscription_history"
      ADD CONSTRAINT "subscription_history_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_history_tenantId_fkey') THEN
    ALTER TABLE "subscription_history"
      ADD CONSTRAINT "subscription_history_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_history_performedById_fkey') THEN
    ALTER TABLE "subscription_history"
      ADD CONSTRAINT "subscription_history_performedById_fkey"
      FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "subscription_history_tenantId_createdAt_idx"
  ON "subscription_history"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "subscription_history_subscriptionId_createdAt_idx"
  ON "subscription_history"("subscriptionId", "createdAt");
