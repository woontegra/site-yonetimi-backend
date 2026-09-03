-- DEFERRED — apply only after duplicate Sep-2026 (and any other) assessments are cleaned.
-- Name: 20260904020000_dues_period_unique_guards
-- Do NOT place in prisma/migrations until duplicates are gone; Prisma migrate would fail.

CREATE UNIQUE INDEX IF NOT EXISTS "dues_definitions_building_period_active_uidx"
ON "dues_definitions" ("buildingId", "periodYear", "periodMonth")
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "apartment_debts_apartment_period_dues_active_uidx"
ON "apartment_debts" ("apartmentId", "periodYear", "periodMonth")
WHERE "type" = 'DUES' AND "status" IN ('OPEN', 'PAID') AND "periodYear" IS NOT NULL AND "periodMonth" IS NOT NULL;
