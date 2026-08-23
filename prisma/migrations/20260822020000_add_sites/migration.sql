-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sites_tenantId_deletedAt_idx" ON "sites"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "sites_tenantId_isActive_idx" ON "sites"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "sites_tenantId_name_idx" ON "sites"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Her mevcut tenant için Varsayılan Site oluştur
INSERT INTO "sites" ("id", "tenantId", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'Varsayılan Site', 'DEFAULT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t;

-- Building.siteId
ALTER TABLE "buildings" ADD COLUMN "siteId" TEXT;

UPDATE "buildings" b
SET "siteId" = s."id"
FROM "sites" s
WHERE s."tenantId" = b."tenantId" AND s."name" = 'Varsayılan Site' AND s."deletedAt" IS NULL;

ALTER TABLE "buildings" ALTER COLUMN "siteId" SET NOT NULL;

CREATE INDEX "buildings_siteId_deletedAt_idx" ON "buildings"("siteId", "deletedAt");

ALTER TABLE "buildings" ADD CONSTRAINT "buildings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Expense.siteId
ALTER TABLE "expenses" ADD COLUMN "siteId" TEXT;

UPDATE "expenses" e
SET "siteId" = COALESCE(
  (SELECT b."siteId" FROM "buildings" b WHERE b."id" = e."buildingId"),
  (SELECT s."id" FROM "sites" s WHERE s."tenantId" = e."tenantId" AND s."name" = 'Varsayılan Site' AND s."deletedAt" IS NULL LIMIT 1)
);

ALTER TABLE "expenses" ALTER COLUMN "siteId" SET NOT NULL;

CREATE INDEX "expenses_siteId_expenseDate_idx" ON "expenses"("siteId", "expenseDate");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BankAccount.siteId
ALTER TABLE "bank_accounts" ADD COLUMN "siteId" TEXT;

UPDATE "bank_accounts" ba
SET "siteId" = (
  SELECT s."id" FROM "sites" s
  WHERE s."tenantId" = ba."tenantId" AND s."name" = 'Varsayılan Site' AND s."deletedAt" IS NULL
  LIMIT 1
);

ALTER TABLE "bank_accounts" ALTER COLUMN "siteId" SET NOT NULL;

CREATE INDEX "bank_accounts_siteId_deletedAt_idx" ON "bank_accounts"("siteId", "deletedAt");

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BankMatchingRule.siteId
ALTER TABLE "bank_matching_rules" ADD COLUMN "siteId" TEXT;

UPDATE "bank_matching_rules" r
SET "siteId" = COALESCE(
  (SELECT ba."siteId" FROM "bank_accounts" ba WHERE ba."id" = r."bankAccountId"),
  (SELECT b."siteId" FROM "buildings" b WHERE b."id" = r."buildingId"),
  (SELECT s."id" FROM "sites" s WHERE s."tenantId" = r."tenantId" AND s."name" = 'Varsayılan Site' AND s."deletedAt" IS NULL LIMIT 1)
);

ALTER TABLE "bank_matching_rules" ALTER COLUMN "siteId" SET NOT NULL;

CREATE INDEX "bank_matching_rules_siteId_deletedAt_isActive_idx" ON "bank_matching_rules"("siteId", "deletedAt", "isActive");

ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EmployeeAssignment.siteId
ALTER TABLE "employee_assignments" ADD COLUMN "siteId" TEXT;

UPDATE "employee_assignments" ea
SET "siteId" = COALESCE(
  (SELECT b."siteId" FROM "buildings" b WHERE b."id" = ea."buildingId"),
  (SELECT s."id" FROM "sites" s WHERE s."tenantId" = ea."tenantId" AND s."name" = 'Varsayılan Site' AND s."deletedAt" IS NULL LIMIT 1)
);

ALTER TABLE "employee_assignments" ALTER COLUMN "siteId" SET NOT NULL;

CREATE INDEX "employee_assignments_siteId_isActive_idx" ON "employee_assignments"("siteId", "isActive");

ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
