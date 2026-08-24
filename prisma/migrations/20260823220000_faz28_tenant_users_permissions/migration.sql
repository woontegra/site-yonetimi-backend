-- AlterEnum: UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ORGANIZASYON_SAHIBI';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'YONETICI';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MUHASEBE';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERASYON';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'GORUNTULEYICI';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "allSites" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "permissionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "membership_site_accesses" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  CONSTRAINT "membership_site_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "membership_site_accesses_membershipId_siteId_key"
  ON "membership_site_accesses"("membershipId", "siteId");

CREATE INDEX IF NOT EXISTS "membership_site_accesses_siteId_idx"
  ON "membership_site_accesses"("siteId");

CREATE INDEX IF NOT EXISTS "memberships_tenantId_status_idx"
  ON "memberships"("tenantId", "status");

DO $$ BEGIN
  ALTER TABLE "membership_site_accesses"
    ADD CONSTRAINT "membership_site_accesses_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "membership_site_accesses"
    ADD CONSTRAINT "membership_site_accesses_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_audit_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_audit_logs_tenantId_createdAt_idx"
  ON "tenant_audit_logs"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "tenant_audit_logs_actorUserId_createdAt_idx"
  ON "tenant_audit_logs"("actorUserId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "tenant_audit_logs"
    ADD CONSTRAINT "tenant_audit_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_audit_logs"
    ADD CONSTRAINT "tenant_audit_logs_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
