/**
 * Diagnose dues modal 17 vs 0 for Hanlılar B Blok.
 * Run: npx tsx scripts/diagnose-dues-apartment-filters.ts
 */
import { prisma } from "../src/lib/prisma";
import { buildingService } from "../src/services/building.service";
import { apartmentService } from "../src/services/apartment.service";

const TENANT_ID = "b932002a-ec1e-46dd-bba2-816322a7a363";
const SITE_ID = "93c20125-fe52-4148-a2e1-8f263af7b088";
const BUILDING_ID = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  const building = await prisma.building.findFirst({
    where: { id: BUILDING_ID },
    select: {
      id: true,
      name: true,
      tenantId: true,
      siteId: true,
      deletedAt: true,
      isActive: true,
      apartmentCount: true,
    },
  });
  console.log("BUILDING", JSON.stringify(building, null, 2));

  const steps = {
    buildingIdMatch: await prisma.apartment.count({ where: { buildingId: BUILDING_ID } }),
    deletedAtNull: await prisma.apartment.count({
      where: { buildingId: BUILDING_ID, deletedAt: null },
    }),
    isActiveTrue: await prisma.apartment.count({
      where: { buildingId: BUILDING_ID, deletedAt: null, isActive: true },
    }),
    isActiveFalse: await prisma.apartment.count({
      where: { buildingId: BUILDING_ID, deletedAt: null, isActive: false },
    }),
    buildingNotDeleted: await prisma.apartment.count({
      where: {
        buildingId: BUILDING_ID,
        deletedAt: null,
        isActive: true,
        building: { deletedAt: null },
      },
    }),
    withSite: await prisma.apartment.count({
      where: {
        tenantId: TENANT_ID,
        buildingId: BUILDING_ID,
        deletedAt: null,
        isActive: true,
        building: { siteId: SITE_ID, deletedAt: null },
      },
    }),
    withOwnerOrTenant: await prisma.apartment.count({
      where: {
        tenantId: TENANT_ID,
        buildingId: BUILDING_ID,
        deletedAt: null,
        isActive: true,
        building: { siteId: SITE_ID, deletedAt: null },
        relations: {
          some: { isActive: true, relationType: { in: ["OWNER", "TENANT"] } },
        },
      },
    }),
  };
  console.log("FILTER_FUNNEL", JSON.stringify(steps, null, 2));

  const sample = await prisma.apartment.findMany({
    where: { buildingId: BUILDING_ID },
    select: { id: true, number: true, isActive: true, deletedAt: true, tenantId: true },
    orderBy: { number: "asc" },
  });
  console.log(
    "APARTMENT_STATUS",
    JSON.stringify(
      sample.map((a) => ({
        number: a.number,
        isActive: a.isActive,
        deletedAt: a.deletedAt,
        tenantOk: a.tenantId === TENANT_ID,
      })),
      null,
      2,
    ),
  );

  const apiBuilding = await buildingService.getById(TENANT_ID, SITE_ID, BUILDING_ID);
  const apiAptsAktif = await apartmentService.list(TENANT_ID, SITE_ID, {
    page: 1,
    perPage: 200,
    buildingId: BUILDING_ID,
    status: "aktif",
  } as never);
  const apiAptsAll = await apartmentService.list(TENANT_ID, SITE_ID, {
    page: 1,
    perPage: 200,
    buildingId: BUILDING_ID,
  } as never);

  console.log(
    "API_EQUIVALENT",
    JSON.stringify(
      {
        dropdownWouldShow:
          apiBuilding.registeredApartmentCount ?? apiBuilding.apartmentCount ?? null,
        registeredApartmentCount: apiBuilding.registeredApartmentCount,
        capacityApartmentCount: apiBuilding.apartmentCount,
        listAktifTotal: apiAptsAktif.total,
        listAktifLen: apiAptsAktif.items.length,
        listAllTotal: apiAptsAll.total,
        listAllLen: apiAptsAll.items.length,
        aktifNumbers: apiAptsAktif.items.map((i: { number: string }) => i.number),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
