-- CreateEnum
CREATE TYPE "AnnualLicenseRequestStatus" AS ENUM ('PENDING', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EmailDeliveryType" ADD VALUE 'ANNUAL_LICENSE_REQUEST_NOTIFICATION';

-- CreateTable
CREATE TABLE "annual_license_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "currentSubscriptionId" TEXT,
    "status" "AnnualLicenseRequestStatus" NOT NULL DEFAULT 'PENDING',
    "netPriceSnapshot" DECIMAL(12,2) NOT NULL,
    "vatRateSnapshot" DECIMAL(5,2) NOT NULL,
    "vatAmountSnapshot" DECIMAL(12,2) NOT NULL,
    "grossPriceSnapshot" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "note" TEXT,
    "organizationNameSnapshot" TEXT NOT NULL,
    "requesterNameSnapshot" TEXT NOT NULL,
    "requesterEmailSnapshot" TEXT NOT NULL,
    "requesterPhoneSnapshot" TEXT,
    "currentPlanSnapshot" TEXT,
    "currentEndsAtSnapshot" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedByAdminId" TEXT,
    "processedAt" TIMESTAMP(3),
    "adminNote" TEXT,

    CONSTRAINT "annual_license_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annual_license_requests_tenantId_status_createdAt_idx" ON "annual_license_requests"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "annual_license_requests_status_createdAt_idx" ON "annual_license_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "annual_license_requests_requestedByUserId_createdAt_idx" ON "annual_license_requests"("requestedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "annual_license_requests" ADD CONSTRAINT "annual_license_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_license_requests" ADD CONSTRAINT "annual_license_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_license_requests" ADD CONSTRAINT "annual_license_requests_processedByAdminId_fkey" FOREIGN KEY ("processedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
