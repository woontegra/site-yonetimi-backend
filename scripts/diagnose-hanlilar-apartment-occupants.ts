import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";
const BLD = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  const apts = await p.apartment.findMany({
    where: { buildingId: BLD, deletedAt: null },
    select: { id: true, number: true },
    orderBy: { number: "asc" },
  });
  const now = new Date();
  const rels = await p.apartmentPersonRelation.findMany({
    where: {
      tenantId: TENANT,
      apartmentId: { in: apts.map((a) => a.id) },
    },
    select: {
      apartmentId: true,
      relationType: true,
      isActive: true,
      startDate: true,
      endDate: true,
      person: { select: { firstName: true, lastName: true, isActive: true, deletedAt: true } },
    },
  });
  const activeNow = rels.filter(
    (r) =>
      r.isActive &&
      r.person.deletedAt == null &&
      r.person.isActive &&
      (!r.startDate || r.startDate <= now) &&
      (!r.endDate || r.endDate >= now),
  );
  const byApt = new Map(
    apts.map((a) => [a.id, { number: a.number, owners: [] as string[], tenants: [] as string[] }]),
  );
  for (const r of activeNow) {
    const row = byApt.get(r.apartmentId)!;
    const name = `${r.person.firstName} ${r.person.lastName}`.trim();
    if (r.relationType === "OWNER") row.owners.push(name);
    if (r.relationType === "TENANT") row.tenants.push(name);
  }
  const rows = [...byApt.values()].sort((a, b) =>
    a.number.localeCompare(b.number, "tr", { numeric: true }),
  );
  const apt6 = rows.find((x) => x.number === "6");
  console.log(
    JSON.stringify(
      {
        apartmentCount: apts.length,
        totalRelationsOnBuilding: rels.length,
        activeNowRelations: activeNow.length,
        apt6,
        all: rows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
