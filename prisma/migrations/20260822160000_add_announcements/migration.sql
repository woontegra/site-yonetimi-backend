-- CreateEnum
CREATE TYPE "AnnouncementAudienceType" AS ENUM ('ALL_SITE', 'BUILDINGS', 'APARTMENTS');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "audienceType" "AnnouncementAudienceType" NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_buildings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_apartments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_apartments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_tenantId_siteId_deletedAt_idx" ON "announcements"("tenantId", "siteId", "deletedAt");

-- CreateIndex
CREATE INDEX "announcements_siteId_status_deletedAt_idx" ON "announcements"("siteId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "announcements_tenantId_status_deletedAt_idx" ON "announcements"("tenantId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "announcements_siteId_publishedAt_idx" ON "announcements"("siteId", "publishedAt");

-- CreateIndex
CREATE INDEX "announcement_buildings_tenantId_buildingId_idx" ON "announcement_buildings"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "announcement_buildings_announcementId_idx" ON "announcement_buildings"("announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_buildings_announcementId_buildingId_key" ON "announcement_buildings"("announcementId", "buildingId");

-- CreateIndex
CREATE INDEX "announcement_apartments_tenantId_apartmentId_idx" ON "announcement_apartments"("tenantId", "apartmentId");

-- CreateIndex
CREATE INDEX "announcement_apartments_announcementId_idx" ON "announcement_apartments"("announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_apartments_announcementId_apartmentId_key" ON "announcement_apartments"("announcementId", "apartmentId");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_buildings" ADD CONSTRAINT "announcement_buildings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_buildings" ADD CONSTRAINT "announcement_buildings_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_buildings" ADD CONSTRAINT "announcement_buildings_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_apartments" ADD CONSTRAINT "announcement_apartments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_apartments" ADD CONSTRAINT "announcement_apartments_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_apartments" ADD CONSTRAINT "announcement_apartments_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
