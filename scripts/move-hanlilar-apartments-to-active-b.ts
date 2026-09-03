/**
 * Safe move: 17 orphan apartments from soft-deleted building → active B Blok.
 * Run: npx tsx scripts/move-hanlilar-apartments-to-active-b.ts
 */
import { prisma } from "../src/lib/prisma";
import { siteService } from "../src/services/site.service";
import { buildingService } from "../src/services/building.service";
import { apartmentService } from "../src/services/apartment.service";

const TENANT_ID = "b932002a-ec1e-46dd-bba2-816322a7a363";
const SITE_ID = "93c20125-fe52-4148-a2e1-8f263af7b088";
const SOURCE_BUILDING_ID = "3e841b88-3230-45d5-9f0e-602e90336185";
const TARGET_BUILDING_ID = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`ABORT: ${message}`);
}

async function main() {
  const source = await prisma.building.findFirst({
    where: { id: SOURCE_BUILDING_ID },
    select: {
      id: true,
      name: true,
      tenantId: true,
      siteId: true,
      isActive: true,
      deletedAt: true,
    },
  });
  const target = await prisma.building.findFirst({
    where: { id: TARGET_BUILDING_ID },
    select: {
      id: true,
      name: true,
      tenantId: true,
      siteId: true,
      isActive: true,
      deletedAt: true,
      apartmentCount: true,
    },
  });

  assert(Boolean(source), "Kaynak bina bulunamadı");
  assert(Boolean(target), "Hedef bina bulunamadı");
  assert(source!.tenantId === TENANT_ID, "Kaynak tenant uyuşmuyor");
  assert(target!.tenantId === TENANT_ID, "Hedef tenant uyuşmuyor");
  assert(source!.siteId === SITE_ID, "Kaynak site uyuşmuyor");
  assert(target!.siteId === SITE_ID, "Hedef site uyuşmuyor");
  assert(source!.tenantId === target!.tenantId, "Tenant eşleşmiyor");
  assert(source!.siteId === target!.siteId, "Site eşleşmiyor");
  assert(source!.deletedAt != null, "Kaynak soft-delete değil");
  assert(target!.deletedAt == null, "Hedef soft-delete olmamalı");
  assert(target!.isActive === true, "Hedef aktif değil");
  assert(/b\s*blok/i.test(target!.name), `Hedef B Blok değil: ${target!.name}`);

  const toMove = await prisma.apartment.findMany({
    where: {
      buildingId: SOURCE_BUILDING_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
    },
    select: {
      id: true,
      number: true,
      buildingId: true,
      tenantId: true,
      isActive: true,
      deletedAt: true,
      building: { select: { siteId: true } },
    },
    orderBy: { number: "asc" },
  });

  assert(toMove.length === 17, `Taşınacak daire sayısı 17 değil: ${toMove.length}`);
  assert(
    toMove.every((a) => a.building.siteId === SITE_ID && a.tenantId === TENANT_ID),
    "Daire tenant/site uyuşmazlığı",
  );
  assert(
    toMove.every((a) => a.deletedAt == null && a.isActive === true),
    "Daireler canlı değil; körü körüne aktifleştirme yapılmaz",
  );

  const numbers = toMove.map((a) => a.number);
  assert(new Set(numbers).size === 17, "Kaynakta duplicate numara");

  const targetLiveConflicts = await prisma.apartment.findMany({
    where: {
      buildingId: TARGET_BUILDING_ID,
      deletedAt: null,
      number: { in: numbers },
    },
    select: { id: true, number: true },
  });
  assert(
    targetLiveConflicts.length === 0,
    `Hedefte canlı numara çakışması: ${targetLiveConflicts.map((c) => c.number).join(",")}`,
  );

  const ids = toMove.map((a) => a.id);
  const relationCountBefore = await prisma.apartmentPersonRelation.count({
    where: { apartmentId: { in: ids } },
  });
  const debtCountBefore = await prisma.apartmentDebt.count({
    where: { apartmentId: { in: ids } },
  });
  const tenantAptBefore = await prisma.apartment.count({ where: { tenantId: TENANT_ID } });

  console.log("=== PRE-MOVE BACKUP (no PII) ===");
  console.log(
    JSON.stringify(
      {
        source,
        target,
        apartments: toMove.map((a) => ({
          apartmentId: a.id,
          number: a.number,
          buildingId: a.buildingId,
          siteId: a.building.siteId,
          tenantId: a.tenantId,
          isActive: a.isActive,
          deletedAt: a.deletedAt,
        })),
        relationCountBefore,
        debtCountBefore,
        tenantAptBefore,
      },
      null,
      2,
    ),
  );

  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction
    const stillSource = await tx.apartment.count({
      where: {
        id: { in: ids },
        buildingId: SOURCE_BUILDING_ID,
        deletedAt: null,
      },
    });
    if (stillSource !== 17) {
      throw new Error(`Transaction guard: expected 17 on source, got ${stillSource}`);
    }

    const conflicts = await tx.apartment.count({
      where: {
        buildingId: TARGET_BUILDING_ID,
        deletedAt: null,
        number: { in: numbers },
      },
    });
    if (conflicts > 0) {
      throw new Error(`Transaction guard: target conflicts ${conflicts}`);
    }

    const updated = await tx.apartment.updateMany({
      where: {
        id: { in: ids },
        buildingId: SOURCE_BUILDING_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      },
      data: {
        buildingId: TARGET_BUILDING_ID,
      },
    });

    if (updated.count !== 17) {
      throw new Error(`Expected update 17, got ${updated.count}`);
    }

    return updated.count;
  });

  console.log("=== MOVE RESULT ===", { moved: result });

  // Post-verify
  const sourceLeft = await prisma.apartment.count({
    where: { buildingId: SOURCE_BUILDING_ID },
  });
  const targetLive = await prisma.apartment.count({
    where: { buildingId: TARGET_BUILDING_ID, deletedAt: null },
  });
  const targetActive = await prisma.apartment.count({
    where: { buildingId: TARGET_BUILDING_ID, deletedAt: null, isActive: true },
  });
  const tenantAptAfter = await prisma.apartment.count({ where: { tenantId: TENANT_ID } });
  const afterRows = await prisma.apartment.findMany({
    where: { id: { in: ids } },
    select: { id: true, number: true, buildingId: true, deletedAt: true, isActive: true },
    orderBy: { number: "asc" },
  });
  const relationCountAfter = await prisma.apartmentPersonRelation.count({
    where: { apartmentId: { in: ids } },
  });
  const debtCountAfter = await prisma.apartmentDebt.count({
    where: { apartmentId: { in: ids } },
  });

  assert(sourceLeft === 0, `Kaynakta kalan daire: ${sourceLeft}`);
  assert(targetLive === 17, `Hedef canlı: ${targetLive}`);
  assert(targetActive === 17, `Hedef aktif: ${targetActive}`);
  assert(tenantAptAfter === tenantAptBefore, "Tenant apartment sayısı değişti");
  assert(
    afterRows.every((r) => r.buildingId === TARGET_BUILDING_ID),
    "Bazı ID'ler hedefe geçmedi",
  );
  assert(
    afterRows.map((r) => r.id).sort().join() === [...ids].sort().join(),
    "Apartment ID set değişti",
  );
  assert(new Set(afterRows.map((r) => r.number)).size === 17, "Duplicate number after move");
  assert(relationCountAfter === relationCountBefore, "Relation count değişti");
  assert(debtCountAfter === debtCountBefore, "Debt count değişti");

  const siteList = await siteService.list(TENANT_ID, {
    page: 1,
    perPage: 100,
    status: "all",
  } as never);
  const siteItem = siteList.items.find((i: { id: string }) => i.id === SITE_ID);
  const building = await buildingService.getById(TENANT_ID, SITE_ID, TARGET_BUILDING_ID);
  const aptList = await apartmentService.list(TENANT_ID, SITE_ID, {
    page: 1,
    perPage: 200,
    buildingId: TARGET_BUILDING_ID,
  } as never);

  console.log("=== POST-MOVE API COUNTS ===");
  console.log(
    JSON.stringify(
      {
        site: {
          apartmentCount: siteItem?.apartmentCount,
          activeApartmentCount: siteItem?.activeApartmentCount,
          buildingCount: siteItem?.buildingCount,
        },
        building: {
          apartmentCount_capacity: building.apartmentCount,
          registeredApartmentCount: building.registeredApartmentCount,
        },
        apartmentList: {
          total: aptList.total,
          itemsLength: aptList.items.length,
          numbers: aptList.items.map((i: { number: string }) => i.number).sort((a, b) => Number(a) - Number(b)),
        },
        relationCountAfter,
        debtCountAfter,
        idsUnchanged: true,
      },
      null,
      2,
    ),
  );

  console.log("MOVE_OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
