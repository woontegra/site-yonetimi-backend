-- CreateEnum
CREATE TYPE "ApartmentRelationType" AS ENUM ('OWNER', 'TENANT');

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "nationalId" TEXT,
    "gender" TEXT,
    "occupation" TEXT,
    "birthDate" TIMESTAMP(3),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartment_person_relations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "relationType" "ApartmentRelationType" NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apartment_person_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_tenantId_deletedAt_idx" ON "persons"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "persons_tenantId_lastName_firstName_idx" ON "persons"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "apartment_person_relations_tenantId_isActive_idx" ON "apartment_person_relations"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "apartment_person_relations_apartmentId_relationType_isActive_idx" ON "apartment_person_relations"("apartmentId", "relationType", "isActive");

-- CreateIndex
CREATE INDEX "apartment_person_relations_personId_isActive_idx" ON "apartment_person_relations"("personId", "isActive");

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_person_relations" ADD CONSTRAINT "apartment_person_relations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_person_relations" ADD CONSTRAINT "apartment_person_relations_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_person_relations" ADD CONSTRAINT "apartment_person_relations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
