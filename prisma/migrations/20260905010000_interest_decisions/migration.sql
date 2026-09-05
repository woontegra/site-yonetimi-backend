-- Gecikme faizi / faiz kararları
-- Not: Bu migration dosyası hazırlanmıştır; uygulama (migrate deploy) kullanıcı onayı olmadan çalıştırılmamalıdır.

ALTER TYPE "ApartmentDebtType" ADD VALUE IF NOT EXISTS 'INTEREST';

CREATE TYPE "InterestDecisionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "InterestRatePeriod" AS ENUM ('MONTHLY');

CREATE TABLE "interest_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "monthlyRate" DECIMAL(8,4) NOT NULL,
    "ratePeriod" "InterestRatePeriod" NOT NULL DEFAULT 'MONTHLY',
    "description" TEXT,
    "status" "InterestDecisionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interest_applications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "sourceDebtId" TEXT NOT NULL,
    "interestDebtId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "principalBase" DECIMAL(12,2) NOT NULL,
    "monthlyRate" DECIMAL(8,4) NOT NULL,
    "interestAmount" DECIMAL(12,2) NOT NULL,
    "calculationNote" TEXT,
    "appliedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interest_decisions_tenantId_siteId_status_idx" ON "interest_decisions"("tenantId", "siteId", "status");
CREATE INDEX "interest_decisions_siteId_startDate_endDate_idx" ON "interest_decisions"("siteId", "startDate", "endDate");

CREATE UNIQUE INDEX "interest_applications_interestDebtId_key" ON "interest_applications"("interestDebtId");
CREATE UNIQUE INDEX "interest_applications_sourceDebtId_periodYear_periodMonth_key" ON "interest_applications"("sourceDebtId", "periodYear", "periodMonth");
CREATE INDEX "interest_applications_tenantId_siteId_idx" ON "interest_applications"("tenantId", "siteId");
CREATE INDEX "interest_applications_decisionId_idx" ON "interest_applications"("decisionId");
CREATE INDEX "interest_applications_periodYear_periodMonth_idx" ON "interest_applications"("periodYear", "periodMonth");

ALTER TABLE "interest_decisions" ADD CONSTRAINT "interest_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interest_decisions" ADD CONSTRAINT "interest_decisions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_decisions" ADD CONSTRAINT "interest_decisions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "interest_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_sourceDebtId_fkey" FOREIGN KEY ("sourceDebtId") REFERENCES "apartment_debts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_interestDebtId_fkey" FOREIGN KEY ("interestDebtId") REFERENCES "apartment_debts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_applications" ADD CONSTRAINT "interest_applications_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
