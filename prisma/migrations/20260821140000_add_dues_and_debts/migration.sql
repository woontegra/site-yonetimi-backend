-- CreateEnum
CREATE TYPE "ApartmentDebtType" AS ENUM ('DUES', 'MANUAL');

-- CreateEnum
CREATE TYPE "ApartmentDebtStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "dues_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dues_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartment_debts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "duesDefinitionId" TEXT,
    "type" "ApartmentDebtType" NOT NULL,
    "title" TEXT NOT NULL,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "remainingAmount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodYear" INTEGER,
    "periodMonth" INTEGER,
    "description" TEXT,
    "status" "ApartmentDebtStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "apartment_debts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dues_definitions_tenantId_deletedAt_idx" ON "dues_definitions"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "dues_definitions_buildingId_periodYear_periodMonth_idx" ON "dues_definitions"("buildingId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "apartment_debts_duesDefinitionId_apartmentId_key" ON "apartment_debts"("duesDefinitionId", "apartmentId");

-- CreateIndex
CREATE INDEX "apartment_debts_tenantId_status_idx" ON "apartment_debts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "apartment_debts_apartmentId_status_idx" ON "apartment_debts"("apartmentId", "status");

-- CreateIndex
CREATE INDEX "apartment_debts_buildingId_status_idx" ON "apartment_debts"("buildingId", "status");

-- CreateIndex
CREATE INDEX "apartment_debts_periodYear_periodMonth_idx" ON "apartment_debts"("periodYear", "periodMonth");

-- AddForeignKey
ALTER TABLE "dues_definitions" ADD CONSTRAINT "dues_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues_definitions" ADD CONSTRAINT "dues_definitions_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_debts" ADD CONSTRAINT "apartment_debts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_debts" ADD CONSTRAINT "apartment_debts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_debts" ADD CONSTRAINT "apartment_debts_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_debts" ADD CONSTRAINT "apartment_debts_duesDefinitionId_fkey" FOREIGN KEY ("duesDefinitionId") REFERENCES "dues_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
