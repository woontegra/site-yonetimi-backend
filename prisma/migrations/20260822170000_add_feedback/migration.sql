-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('INFO', 'SUGGESTION', 'REQUEST', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "FeedbackPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "feedback_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "feedback_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "apartmentId" TEXT,
    "personId" TEXT,
    "employeeId" TEXT,
    "categoryId" TEXT,
    "type" "FeedbackType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "FeedbackPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "feedback_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_status_histories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "feedbackRecordId" TEXT NOT NULL,
    "previousStatus" "FeedbackStatus",
    "newStatus" "FeedbackStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_categories_tenantId_deletedAt_idx" ON "feedback_categories"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "feedback_categories_tenantId_isActive_sortOrder_idx" ON "feedback_categories"("tenantId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "feedback_records_tenantId_siteId_deletedAt_idx" ON "feedback_records"("tenantId", "siteId", "deletedAt");

-- CreateIndex
CREATE INDEX "feedback_records_siteId_status_deletedAt_idx" ON "feedback_records"("siteId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "feedback_records_siteId_type_deletedAt_idx" ON "feedback_records"("siteId", "type", "deletedAt");

-- CreateIndex
CREATE INDEX "feedback_records_siteId_priority_deletedAt_idx" ON "feedback_records"("siteId", "priority", "deletedAt");

-- CreateIndex
CREATE INDEX "feedback_records_categoryId_idx" ON "feedback_records"("categoryId");

-- CreateIndex
CREATE INDEX "feedback_records_employeeId_idx" ON "feedback_records"("employeeId");

-- CreateIndex
CREATE INDEX "feedback_records_personId_idx" ON "feedback_records"("personId");

-- CreateIndex
CREATE INDEX "feedback_records_buildingId_idx" ON "feedback_records"("buildingId");

-- CreateIndex
CREATE INDEX "feedback_records_apartmentId_idx" ON "feedback_records"("apartmentId");

-- CreateIndex
CREATE INDEX "feedback_status_histories_feedbackRecordId_createdAt_idx" ON "feedback_status_histories"("feedbackRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_status_histories_tenantId_siteId_createdAt_idx" ON "feedback_status_histories"("tenantId", "siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback_categories" ADD CONSTRAINT "feedback_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "feedback_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_histories" ADD CONSTRAINT "feedback_status_histories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_histories" ADD CONSTRAINT "feedback_status_histories_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_histories" ADD CONSTRAINT "feedback_status_histories_feedbackRecordId_fkey" FOREIGN KEY ("feedbackRecordId") REFERENCES "feedback_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
