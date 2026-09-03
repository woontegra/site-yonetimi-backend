/**
 * READ-ONLY consistency check for Hanlılar B Blok counts.
 * Proves capacity ≠ registered, and orphan apartments on soft-deleted building.
 */
import { prisma } from "../src/lib/prisma";
import { buildingService } from "../src/services/building.service";
import { apartmentService } from "../src/services/apartment.service";

const SITE_ID = "93c20125-fe52-4148-a2e1-8f263af7b088";
const TENANT_ID = "b932002a-ec1e-46dd-bba2-816322a7a363";
const ACTIVE_BUILDING_ID = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";
const ORPHAN_BUILDING_ID = "3e841b88-3230-45d5-9f0e-602e90336185";

async function main() {
  const building = await buildingService.getById(TENANT_ID, SITE_ID, ACTIVE_BUILDING_ID);
  const listed = await apartmentService.list(TENANT_ID, SITE_ID, {
    buildingId: ACTIVE_BUILDING_ID,
    page: 1,
    perPage: 100,
  });

  const orphanApts = await prisma.apartment.count({
    where: { buildingId: ORPHAN_BUILDING_ID, deletedAt: null },
  });

  // Simulated dues preview would use active apartments on active building
  const chargeable = await prisma.apartment.count({
    where: {
      tenantId: TENANT_ID,
      buildingId: ACTIVE_BUILDING_ID,
      deletedAt: null,
      isActive: true,
      building: { siteId: SITE_ID, deletedAt: null },
    },
  });

  const report = {
    capacityField: building.apartmentCount,
    registeredApartmentCount: building.registeredApartmentCount,
    apartmentsListTotal: listed.total,
    apartmentsListItems: listed.items.length,
    chargeableActiveApartmentsOnActiveBuilding: chargeable,
    orphanApartmentsOnSoftDeletedBuilding: orphanApts,
    consistentTriple:
      building.registeredApartmentCount === listed.total &&
      listed.total === chargeable,
    note:
      "17 real apartments exist on soft-deleted building; active B Blok has capacity 17 and 0 rows. No data migration performed.",
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.consistentTriple) {
    throw new Error("Triple count mismatch on active building");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
