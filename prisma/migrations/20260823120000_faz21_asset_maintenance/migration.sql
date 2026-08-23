-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'DISPOSED';

-- AlterTable
ALTER TABLE "asset_categories" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- AlterTable
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "apartmentId" TEXT;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "asset_maintenances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "maintenanceDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(12,2),
    "performedBy" TEXT,
    "nextMaintenanceDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "asset_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assets_apartmentId_idx" ON "assets"("apartmentId");

CREATE INDEX IF NOT EXISTS "asset_maintenances_assetId_maintenanceDate_idx" ON "asset_maintenances"("assetId", "maintenanceDate");
CREATE INDEX IF NOT EXISTS "asset_maintenances_tenantId_siteId_deletedAt_idx" ON "asset_maintenances"("tenantId", "siteId", "deletedAt");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
