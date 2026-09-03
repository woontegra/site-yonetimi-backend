import { prisma } from "../src/lib/prisma";

const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";

async function main() {
  const orphansThisTenant = await prisma.apartment.findMany({
    where: {
      tenantId: TENANT,
      deletedAt: null,
      building: { deletedAt: { not: null } },
    },
    select: {
      buildingId: true,
      building: { select: { siteId: true, name: true } },
    },
  });
  const byBuilding = new Map<
    string,
    { buildingId: string; siteId: string; buildingName: string; count: number }
  >();
  for (const a of orphansThisTenant) {
    const cur = byBuilding.get(a.buildingId) ?? {
      buildingId: a.buildingId,
      siteId: a.building.siteId,
      buildingName: a.building.name,
      count: 0,
    };
    cur.count += 1;
    byBuilding.set(a.buildingId, cur);
  }
  console.log("ORPHANS_THIS_TENANT", JSON.stringify([...byBuilding.values()], null, 2));

  const orphansAll = await prisma.$queryRaw<
    Array<{ buildingId: string; siteId: string; tenantId: string; count: number }>
  >`
    SELECT b.id as "buildingId", b."siteId", b."tenantId", COUNT(a.id)::int as count
    FROM apartments a
    JOIN buildings b ON b.id = a."buildingId"
    WHERE a."deletedAt" IS NULL AND b."deletedAt" IS NOT NULL
    GROUP BY b.id, b."siteId", b."tenantId"
    ORDER BY count DESC
  `;
  console.log("ORPHANS_ALL_TENANTS", JSON.stringify(orphansAll, null, 2));

  const debtsWrongBuilding = await prisma.apartmentDebt.count({
    where: {
      tenantId: TENANT,
      buildingId: "3e841b88-3230-45d5-9f0e-602e90336185",
    },
  });
  console.log(JSON.stringify({ debtsWrongBuilding }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
