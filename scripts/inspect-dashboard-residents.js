/**
 * READ-ONLY: Genel Bakış kişi özeti — Hanlılar B Blok örnek daireler.
 * Çalıştır: node scripts/inspect-dashboard-residents.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const site = await prisma.site.findFirst({
    where: { name: { contains: "Hanlı" }, deletedAt: null },
    select: { id: true, name: true, tenantId: true },
  });
  if (!site) {
    console.log("site not found");
    await prisma.$disconnect();
    return;
  }

  const building = await prisma.building.findFirst({
    where: { siteId: site.id, name: { contains: "B" }, deletedAt: null },
    select: { id: true, name: true },
  });

  const numbers = ["1", "2", "3", "4", "5", "7", "8", "9", "10", "12"];
  const apts = await prisma.apartment.findMany({
    where: {
      buildingId: building.id,
      number: { in: numbers },
      deletedAt: null,
    },
    select: {
      id: true,
      number: true,
      relations: {
        where: {
          isActive: true,
          relationType: { in: ["OWNER", "TENANT"] },
          person: { deletedAt: null, isActive: true },
        },
        select: {
          relationType: true,
          endDate: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { number: "asc" },
  });

  const now = new Date();
  console.log(
    JSON.stringify(
      {
        site: site.name,
        building: building.name,
        apartments: apts.map((a) => {
          const active = a.relations.filter((r) => !r.endDate || r.endDate >= now);
          return {
            number: a.number,
            owners: active
              .filter((r) => r.relationType === "OWNER")
              .map((r) => `${r.person.firstName} ${r.person.lastName}`.trim()),
            tenants: active
              .filter((r) => r.relationType === "TENANT")
              .map((r) => `${r.person.firstName} ${r.person.lastName}`.trim()),
          };
        }),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
