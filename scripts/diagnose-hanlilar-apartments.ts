/**
 * READ-ONLY diagnosis for Hanlılar apartment count.
 * Run: npx tsx scripts/diagnose-hanlilar-apartments.ts
 */
import { prisma } from "../src/lib/prisma";
import { siteService } from "../src/services/site.service";
import { buildingService } from "../src/services/building.service";
import { apartmentService } from "../src/services/apartment.service";

async function main() {
  const sites = await prisma.site.findMany({
    where: { name: { contains: "Hanlılar", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      tenantId: true,
      isActive: true,
      deletedAt: true,
    },
  });
  console.log("=== SITES matching Hanlılar ===");
  console.log(JSON.stringify(sites, null, 2));

  for (const site of sites) {
    console.log(`\n========== SITE ${site.name} (${site.id}) ==========`);

    const buildings = await prisma.building.findMany({
      where: { siteId: site.id },
      select: {
        id: true,
        name: true,
        apartmentCount: true,
        isActive: true,
        deletedAt: true,
        tenantId: true,
        siteId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log("=== BUILDINGS (including soft-deleted) ===");
    console.log(JSON.stringify(buildings, null, 2));

    const tenantAptTotal = await prisma.apartment.count({
      where: { tenantId: site.tenantId },
    });
    const tenantAptLive = await prisma.apartment.count({
      where: { tenantId: site.tenantId, deletedAt: null },
    });
    const siteAptAnyBuilding = await prisma.apartment.count({
      where: { building: { siteId: site.id } },
    });
    const siteAptLiveOnLiveBuilding = await prisma.apartment.count({
      where: {
        deletedAt: null,
        building: { siteId: site.id, deletedAt: null },
      },
    });
    const siteAptLiveOnAnyBuilding = await prisma.apartment.count({
      where: {
        deletedAt: null,
        building: { siteId: site.id },
      },
    });

    console.log("=== COUNTS ===");
    console.log(
      JSON.stringify(
        {
          tenantId: site.tenantId,
          tenantAptTotal,
          tenantAptLive,
          siteAptAnyBuilding,
          siteAptLiveOnAnyBuilding,
          siteAptLiveOnLiveBuilding,
        },
        null,
        2,
      ),
    );

    for (const b of buildings) {
      const total = await prisma.apartment.count({ where: { buildingId: b.id } });
      const live = await prisma.apartment.count({
        where: { buildingId: b.id, deletedAt: null },
      });
      const active = await prisma.apartment.count({
        where: { buildingId: b.id, deletedAt: null, isActive: true },
      });
      const inactive = await prisma.apartment.count({
        where: { buildingId: b.id, deletedAt: null, isActive: false },
      });
      const softDeleted = await prisma.apartment.count({
        where: { buildingId: b.id, deletedAt: { not: null } },
      });
      console.log(
        JSON.stringify(
          {
            buildingId: b.id,
            buildingName: b.name,
            buildingDeletedAt: b.deletedAt,
            apartmentCapacity_field: b.apartmentCount,
            aptTotal: total,
            aptLive: live,
            aptActive: active,
            aptInactive: inactive,
            aptSoftDeleted: softDeleted,
          },
          null,
          2,
        ),
      );
    }

    const apts = await prisma.apartment.findMany({
      where: { building: { siteId: site.id } },
      select: {
        id: true,
        number: true,
        isActive: true,
        deletedAt: true,
        buildingId: true,
        tenantId: true,
        building: {
          select: { id: true, name: true, deletedAt: true, siteId: true },
        },
      },
      orderBy: [{ buildingId: "asc" }, { number: "asc" }],
    });
    console.log("=== APARTMENT ROWS (number only, no PII) ===");
    console.log(
      JSON.stringify(
        apts.map((a) => ({
          apartmentId: a.id,
          number: a.number,
          isActive: a.isActive,
          deletedAt: a.deletedAt,
          buildingId: a.buildingId,
          buildingName: a.building.name,
          buildingDeletedAt: a.building.deletedAt,
          siteId: a.building.siteId,
          tenantId: a.tenantId,
        })),
        null,
        2,
      ),
    );

    // API-equivalent responses
    console.log("=== API: siteService.list (status=all) ===");
    const list = await siteService.list(site.tenantId, {
      page: 1,
      perPage: 100,
      status: "all",
    } as never);
    const listed = list.items.find((i: { id: string }) => i.id === site.id);
    console.log(JSON.stringify(listed, null, 2));

    console.log("=== API: siteService.getById ===");
    const detail = await siteService.getById(site.tenantId, site.id);
    console.log(
      JSON.stringify(
        {
          id: detail.id,
          name: detail.name,
          buildingCount: detail.buildingCount,
          apartmentCount: detail.apartmentCount,
          activeApartmentCount: detail.activeApartmentCount,
        },
        null,
        2,
      ),
    );

    const liveBuildings = buildings.filter((b) => b.deletedAt == null);
    for (const b of liveBuildings) {
      console.log(`=== API: buildingService.getById ${b.name} ===`);
      try {
        const bd = await buildingService.getById(site.tenantId, site.id, b.id);
        console.log(
          JSON.stringify(
            {
              id: bd.id,
              name: bd.name,
              apartmentCount_capacity: bd.apartmentCount,
              registeredApartmentCount: bd.registeredApartmentCount,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        console.log("building getById error", e instanceof Error ? e.message : e);
      }

      console.log(`=== API: apartmentService.list buildingId=${b.id} ===`);
      try {
        const aptList = await apartmentService.list(site.tenantId, site.id, {
          page: 1,
          perPage: 200,
          buildingId: b.id,
        } as never);
        console.log(
          JSON.stringify(
            {
              total: aptList.total,
              itemsLength: aptList.items.length,
              numbers: aptList.items.map((i: { number: string }) => i.number),
            },
            null,
            2,
          ),
        );
      } catch (e) {
        console.log("apartment list error", e instanceof Error ? e.message : e);
      }
    }

    // Also list apartments on soft-deleted buildings via raw prisma (API may hide)
    for (const b of buildings.filter((x) => x.deletedAt != null)) {
      console.log(`=== Soft-deleted building apartment numbers: ${b.name} ===`);
      const nums = await prisma.apartment.findMany({
        where: { buildingId: b.id },
        select: { number: true, deletedAt: true, isActive: true },
        orderBy: { number: "asc" },
      });
      console.log(JSON.stringify(nums, null, 2));
    }
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
