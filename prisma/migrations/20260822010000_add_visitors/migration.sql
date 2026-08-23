-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('EXPECTED', 'INSIDE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "nationalId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "hostPersonId" TEXT,
    "purpose" TEXT,
    "vehiclePlate" TEXT,
    "expectedAt" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'INSIDE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitors_tenantId_deletedAt_idx" ON "visitors"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "visitors_tenantId_lastName_firstName_idx" ON "visitors"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "visits_tenantId_status_idx" ON "visits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "visits_visitorId_status_idx" ON "visits"("visitorId", "status");

-- CreateIndex
CREATE INDEX "visits_apartmentId_status_idx" ON "visits"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "visits_tenantId_checkInAt_idx" ON "visits"("tenantId", "checkInAt");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_hostPersonId_fkey" FOREIGN KEY ("hostPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
