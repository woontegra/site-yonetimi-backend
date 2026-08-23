-- CreateEnum
CREATE TYPE "SiteSetupStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "setupStatus" "SiteSetupStatus" NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "sites" ADD COLUMN "setupCompletedAt" TIMESTAMP(3);
