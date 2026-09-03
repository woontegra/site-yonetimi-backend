/**
 * READ-ONLY: Hanlılar B Blok 1–17 daire relation dağılımı.
 * Kişisel veri yazılmaz; yalnızca adet ve durum bayrakları.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";
const SITE = "93c20125-fe52-4148-a2e1-8f263af7b088";
const BLD = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

function windowStatus(
  r: { isActive: boolean; startDate: Date | null; endDate: Date | null },
  now: Date,
): string {
  if (!r.isActive) return "inactive_flag";
  if (r.startDate && r.startDate > now) return "future_start";
  if (r.endDate && r.endDate < now) return "ended";
  return "active_window";
}

async function main() {
  const apts = await prisma.apartment.findMany({
    where: { tenantId: TENANT, buildingId: BLD, deletedAt: null },
    select: { id: true, number: true, isActive: true, buildingId: true },
    orderBy: { number: "asc" },
  });
  const aptIds = new Set(apts.map((a) => a.id));

  const allRels = await prisma.apartmentPersonRelation.findMany({
    where: { tenantId: TENANT },
    select: {
      id: true,
      apartmentId: true,
      relationType: true,
      isActive: true,
      startDate: true,
      endDate: true,
      person: { select: { isActive: true, deletedAt: true, tenantId: true } },
      apartment: {
        select: {
          deletedAt: true,
          buildingId: true,
          building: { select: { siteId: true, deletedAt: true } },
        },
      },
    },
  });

  const on17 = allRels.filter((r) => aptIds.has(r.apartmentId));
  const now = new Date();

  const byApartment = apts.map((a) => {
    const rels = on17.filter((r) => r.apartmentId === a.id);
    const mapRel = (r: (typeof rels)[0]) => ({
      type: r.relationType,
      isActive: r.isActive,
      window: windowStatus(r, now),
      personActive: r.person.isActive,
      personDeleted: r.person.deletedAt != null,
      personTenantOk: r.person.tenantId === TENANT,
    });
    return {
      apartmentId: a.id,
      number: a.number,
      ownerCount: rels.filter((r) => r.relationType === "OWNER").length,
      tenantCount: rels.filter((r) => r.relationType === "TENANT").length,
      otherCount: rels.filter((r) => r.relationType !== "OWNER" && r.relationType !== "TENANT")
        .length,
      relations: rels.map(mapRel),
    };
  });

  const ownersActive = on17.filter(
    (r) =>
      r.relationType === "OWNER" &&
      windowStatus(r, now) === "active_window" &&
      r.person.isActive &&
      !r.person.deletedAt,
  ).length;
  const tenantsActive = on17.filter(
    (r) =>
      r.relationType === "TENANT" &&
      windowStatus(r, now) === "active_window" &&
      r.person.isActive &&
      !r.person.deletedAt,
  ).length;

  console.log(
    JSON.stringify(
      {
        siteId: SITE,
        buildingId: BLD,
        apartmentCount: apts.length,
        totalTenantRelations: allRels.length,
        relationsOnThese17: on17.length,
        relationsNotOnThese17: allRels.length - on17.length,
        apartmentIdsPreservedHint: apts.every((a) => a.buildingId === BLD),
        activeOwnerRelationsUsable: ownersActive,
        activeTenantRelationsUsable: tenantsActive,
        byApartment,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
