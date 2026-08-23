-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE', 'LOST', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "AssetMovementType" AS ENUM ('CREATED', 'LOCATION_CHANGED', 'STATUS_CHANGED', 'QUANTITY_CHANGED', 'UPDATED');

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "assetCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePrice" DECIMAL(12,2),
    "currentValue" DECIMAL(12,2),
    "location" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "warrantyEndDate" TIMESTAMP(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetMovementType" NOT NULL,
    "fromBuildingId" TEXT,
    "toBuildingId" TEXT,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "previousStatus" "AssetStatus",
    "newStatus" "AssetStatus",
    "previousQuantity" INTEGER,
    "newQuantity" INTEGER,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_categories_tenantId_deletedAt_idx" ON "asset_categories"("tenantId", "deletedAt");
CREATE INDEX "asset_categories_tenantId_isActive_sortOrder_idx" ON "asset_categories"("tenantId", "isActive", "sortOrder");

CREATE INDEX "assets_tenantId_siteId_deletedAt_idx" ON "assets"("tenantId", "siteId", "deletedAt");
CREATE INDEX "assets_siteId_status_deletedAt_idx" ON "assets"("siteId", "status", "deletedAt");
CREATE INDEX "assets_buildingId_deletedAt_idx" ON "assets"("buildingId", "deletedAt");
CREATE INDEX "assets_assetCategoryId_idx" ON "assets"("assetCategoryId");
CREATE INDEX "assets_tenantId_name_idx" ON "assets"("tenantId", "name");

CREATE INDEX "asset_movements_assetId_occurredAt_idx" ON "asset_movements"("assetId", "occurredAt");
CREATE INDEX "asset_movements_tenantId_siteId_occurredAt_idx" ON "asset_movements"("tenantId", "siteId", "occurredAt");

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assets" ADD CONSTRAINT "assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_assetCategoryId_fkey" FOREIGN KEY ("assetCategoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_fromBuildingId_fkey" FOREIGN KEY ("fromBuildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_toBuildingId_fkey" FOREIGN KEY ("toBuildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
