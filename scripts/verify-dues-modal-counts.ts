import { listApartmentsQuerySchema } from "../src/validators/apartment.validators";
import { apartmentService } from "../src/services/apartment.service";
import { buildingService } from "../src/services/building.service";
import { prisma } from "../src/lib/prisma";

const TENANT_ID = "b932002a-ec1e-46dd-bba2-816322a7a363";
const SITE_ID = "93c20125-fe52-4148-a2e1-8f263af7b088";
const BUILDING_ID = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  // Historical bug: perPage 200 exceeded old max(100)
  const oldSchemaWouldReject = (() => {
    // Simulate old max(100)
    const z = require("zod");
    const old = z.object({
      perPage: z.coerce.number().int().min(1).max(100).default(20),
    });
    return old.safeParse({ perPage: "200" });
  })();
  console.log(
    "OLD_perPage_200",
    JSON.stringify({
      success: oldSchemaWouldReject.success,
      error: oldSchemaWouldReject.success ? null : oldSchemaWouldReject.error.issues[0]?.message,
    }),
  );

  const now = listApartmentsQuerySchema.safeParse({
    buildingId: BUILDING_ID,
    page: "1",
    perPage: "500",
    status: "aktif",
  });
  console.log("NEW_perPage_500", JSON.stringify({ success: now.success }));

  const building = await buildingService.getById(TENANT_ID, SITE_ID, BUILDING_ID);
  const apts = await apartmentService.list(TENANT_ID, SITE_ID, {
    page: 1,
    perPage: 500,
    buildingId: BUILDING_ID,
    status: "aktif",
  } as never);

  console.log(
    "PREVIEW_COUNTS",
    JSON.stringify({
      dropdownRegistered: building.registeredApartmentCount,
      scopeAktif: apts.total,
      numbers: apts.items
        .map((i: { number: string }) => i.number)
        .sort((a: string, b: string) => Number(a) - Number(b)),
      sameBuilding: apts.items.every(
        (i: { building: { id: string } }) => i.building.id === BUILDING_ID,
      ),
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
