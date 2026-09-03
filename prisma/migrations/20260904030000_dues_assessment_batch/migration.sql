-- AlterTable
ALTER TABLE "dues_definitions" ADD COLUMN "assessmentBatchId" TEXT;

-- CreateIndex
CREATE INDEX "dues_definitions_tenantId_assessmentBatchId_idx" ON "dues_definitions"("tenantId", "assessmentBatchId");
