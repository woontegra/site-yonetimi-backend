/**
 * READ-ONLY: where are the 17 apartments actually attached?
 */
import { prisma } from "../src/lib/prisma";

const SITE_ID = "93c20125-fe52-4148-a2e1-8f263af7b088";
const TENANT_ID = "b932002a-ec1e-46dd-bba2-816322a7a363";
const BUILDING_ID = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  const apts = await prisma.apartment.findMany({
    where: { tenantId: TENANT_ID, deletedAt: null },
    select: {
      id: true,
      number: true,
      isActive: true,
      buildingId: true,
      createdAt: true,
      building: {
        select: {
          id: true,
          name: true,
          siteId: true,
          deletedAt: true,
          apartmentCount: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("TENANT_ACTIVE_APTS_COUNT", apts.length);
  console.log(
    "BY_BUILDING",
    JSON.stringify(
      Object.entries(
        apts.reduce<Record<string, { buildingName: string; siteId: string; buildingDeleted: string | null; capacity: number | null; numbers: string[] }>>(
          (acc, apt) => {
            const key = apt.buildingId;
            if (!acc[key]) {
              acc[key] = {
                buildingName: apt.building.name,
                siteId: apt.building.siteId,
                buildingDeleted: apt.building.deletedAt?.toISOString() ?? null,
                capacity: apt.building.apartmentCount,
                numbers: [],
              };
            }
            acc[key]!.numbers.push(apt.number);
            return acc;
          },
          {},
        ),
      ),
      null,
      2,
    ),
  );

  const onSiteViaRelation = apts.filter((a) => a.building.siteId === SITE_ID);
  console.log("ON_TARGET_SITE", onSiteViaRelation.length);
  console.log("ON_TARGET_BUILDING", apts.filter((a) => a.buildingId === BUILDING_ID).length);

  const allBuildings = await prisma.building.findMany({
    where: { tenantId: TENANT_ID },
    select: {
      id: true,
      name: true,
      siteId: true,
      deletedAt: true,
      apartmentCount: true,
      isActive: true,
      _count: { select: { apartments: { where: { deletedAt: null } } } },
    },
  });
  console.log("ALL_TENANT_BUILDINGS", JSON.stringify(allBuildings, null, 2));

  const sites = await prisma.site.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, name: true, deletedAt: true, isActive: true },
  });
  console.log("ALL_TENANT_SITES", JSON.stringify(sites, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
