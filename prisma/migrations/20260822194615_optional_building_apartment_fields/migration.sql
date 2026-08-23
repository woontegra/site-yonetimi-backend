-- AlterTable
ALTER TABLE "apartments" ALTER COLUMN "floor" DROP NOT NULL,
ALTER COLUMN "roomType" DROP NOT NULL;

-- AlterTable
ALTER TABLE "buildings" ALTER COLUMN "apartmentCount" DROP NOT NULL,
ALTER COLUMN "floorCount" DROP NOT NULL;
