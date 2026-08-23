-- CreateTable
CREATE TABLE "apartments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "squareMeters" DOUBLE PRECISION,
    "hasBalcony" BOOLEAN,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apartments_tenantId_deletedAt_idx" ON "apartments"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "apartments_buildingId_deletedAt_idx" ON "apartments"("buildingId", "deletedAt");

-- CreateIndex
CREATE INDEX "apartments_buildingId_number_idx" ON "apartments"("buildingId", "number");

-- Soft-delete uyumlu unique: silinmiş daire numarası yeniden kullanılabilir.
CREATE UNIQUE INDEX "apartments_buildingId_number_active_key"
ON "apartments"("buildingId", "number")
WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "apartments" ADD CONSTRAINT "apartments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartments" ADD CONSTRAINT "apartments_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
