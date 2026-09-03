-- CreateEnum
CREATE TYPE "ApartmentDuesExemptionType" AS ENUM ('FULL', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "ApartmentDuesExemptionReason" AS ENUM ('MANAGER', 'STAFF', 'BOARD_DECISION', 'OTHER');

-- CreateTable
CREATE TABLE "apartment_dues_exemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "exemptionType" "ApartmentDuesExemptionType" NOT NULL,
    "value" DECIMAL(12,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "reason" "ApartmentDuesExemptionReason" NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "apartment_dues_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apartment_dues_exemptions_tenantId_siteId_isActive_idx" ON "apartment_dues_exemptions"("tenantId", "siteId", "isActive");

-- CreateIndex
CREATE INDEX "apartment_dues_exemptions_apartmentId_isActive_startDate_endDate_idx" ON "apartment_dues_exemptions"("apartmentId", "isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "apartment_dues_exemptions_tenantId_apartmentId_isActive_idx" ON "apartment_dues_exemptions"("tenantId", "apartmentId", "isActive");

-- AddForeignKey
ALTER TABLE "apartment_dues_exemptions" ADD CONSTRAINT "apartment_dues_exemptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_dues_exemptions" ADD CONSTRAINT "apartment_dues_exemptions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_dues_exemptions" ADD CONSTRAINT "apartment_dues_exemptions_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_dues_exemptions" ADD CONSTRAINT "apartment_dues_exemptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_dues_exemptions" ADD CONSTRAINT "apartment_dues_exemptions_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
