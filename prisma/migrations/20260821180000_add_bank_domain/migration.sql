-- CreateEnum
CREATE TYPE "BankConnectionType" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "BankTransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('ACTIVE', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'PROCESSED');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "iban" TEXT,
    "accountNumber" TEXT,
    "branchName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectionType" "BankConnectionType" NOT NULL DEFAULT 'MANUAL',
    "provider" TEXT,
    "externalAccountId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalTransactionId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "direction" "BankTransactionDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "senderName" TEXT,
    "senderIban" TEXT,
    "referenceNo" TEXT,
    "balanceAfter" DECIMAL(12,2),
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "matchStatus" "BankMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedApartmentId" TEXT,
    "matchedPersonId" TEXT,
    "paymentId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_matching_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "name" TEXT NOT NULL,
    "containsText" TEXT NOT NULL,
    "buildingId" TEXT,
    "apartmentId" TEXT,
    "personId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_matching_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_deletedAt_idx" ON "bank_accounts"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_isActive_idx" ON "bank_accounts"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_paymentId_key" ON "bank_transactions"("paymentId");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_matchStatus_idx" ON "bank_transactions"("tenantId", "matchStatus");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_transactionDate_idx" ON "bank_transactions"("bankAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_status_idx" ON "bank_transactions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_externalTransactionId_idx" ON "bank_transactions"("externalTransactionId");

-- CreateIndex
CREATE INDEX "bank_matching_rules_tenantId_deletedAt_isActive_idx" ON "bank_matching_rules"("tenantId", "deletedAt", "isActive");

-- CreateIndex
CREATE INDEX "bank_matching_rules_bankAccountId_isActive_idx" ON "bank_matching_rules"("bankAccountId", "isActive");

-- CreateIndex
CREATE INDEX "bank_matching_rules_tenantId_priority_idx" ON "bank_matching_rules"("tenantId", "priority");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matchedApartmentId_fkey" FOREIGN KEY ("matchedApartmentId") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matchedPersonId_fkey" FOREIGN KEY ("matchedPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matching_rules" ADD CONSTRAINT "bank_matching_rules_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
