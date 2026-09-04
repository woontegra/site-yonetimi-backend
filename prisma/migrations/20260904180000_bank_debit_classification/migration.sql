-- Giden banka hareketi sınıflandırması + Expense bağlantısı
CREATE TYPE "BankDebitClass" AS ENUM ('UNCLASSIFIED', 'EXPENSE', 'EXCLUDED');

ALTER TABLE "bank_transactions"
  ADD COLUMN "debitClass" "BankDebitClass",
  ADD COLUMN "expenseId" TEXT;

-- Mevcut giden hareketleri sınıflandırılmamış kabul et
UPDATE "bank_transactions"
SET "debitClass" = 'UNCLASSIFIED'
WHERE "direction" = 'DEBIT' AND "debitClass" IS NULL;

-- IGNORED gidenler hariç tutulmuş sayılır
UPDATE "bank_transactions"
SET "debitClass" = 'EXCLUDED'
WHERE "direction" = 'DEBIT' AND "status" = 'IGNORED';

CREATE UNIQUE INDEX "bank_transactions_expenseId_key" ON "bank_transactions"("expenseId");
CREATE INDEX "bank_transactions_tenantId_direction_debitClass_idx" ON "bank_transactions"("tenantId", "direction", "debitClass");

ALTER TABLE "bank_transactions"
  ADD CONSTRAINT "bank_transactions_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "expenses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
