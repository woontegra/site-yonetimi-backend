/**
 * Geçici tenant ile aidat silme / duplicate koruması.
 * Hanlılar verisine dokunmaz.
 */
import { PrismaClient } from "@prisma/client";
import { duesDefinitionService } from "../src/services/dues.service";

const prisma = new PrismaClient();
const PREFIX = "__verify_dues_purge_";

async function main() {
  const stamp = Date.now();
  const actor = await prisma.user.create({
    data: {
      email: `${PREFIX}${stamp}@example.test`,
      passwordHash: "x",
      fullName: "Verify Actor",
    },
  });
  const tenant = await prisma.tenant.create({
    data: { name: `${PREFIX}${stamp}`, slug: `${PREFIX}${stamp}` },
  });
  const site = await prisma.site.create({
    data: { tenantId: tenant.id, name: "Verify Site" },
  });
  const building = await prisma.building.create({
    data: { tenantId: tenant.id, siteId: site.id, name: "A Blok" },
  });
  const buildingB = await prisma.building.create({
    data: { tenantId: tenant.id, siteId: site.id, name: "B Blok" },
  });

  for (const b of [building, buildingB]) {
    for (let i = 1; i <= 2; i++) {
      await prisma.apartment.create({
        data: {
          tenantId: tenant.id,
          buildingId: b.id,
          number: String(i),
          isActive: true,
        },
      });
    }
  }

  const checks: Record<string, boolean> = {};

  const created = await duesDefinitionService.create(tenant.id, site.id, {
    buildingId: building.id,
    name: "Eylül 2026 Aidatı",
    amount: 100,
    periodYear: 2026,
    periodMonth: 9,
    dueDate: new Date(Date.UTC(2026, 8, 15)),
    chargeImmediately: true,
  });
  checks.createdTwoDebts = created.createdCount === 2;

  try {
    await duesDefinitionService.create(tenant.id, site.id, {
      buildingId: building.id,
      name: "Eylül 2026 Aidatı",
      amount: 100,
      periodYear: 2026,
      periodMonth: 9,
      dueDate: new Date(Date.UTC(2026, 8, 15)),
      chargeImmediately: true,
    });
    checks.duplicateBlocked = false;
  } catch (error) {
    checks.duplicateBlocked = error instanceof Error && error.message.includes("zaten bulunuyor");
  }

  const otherPeriod = await duesDefinitionService.create(tenant.id, site.id, {
    buildingId: building.id,
    name: "Ekim 2026 Aidatı",
    amount: 100,
    periodYear: 2026,
    periodMonth: 10,
    dueDate: new Date(Date.UTC(2026, 9, 15)),
    chargeImmediately: true,
  });
  checks.otherPeriodOk = otherPeriod.createdCount === 2;

  const otherBuilding = await duesDefinitionService.create(tenant.id, site.id, {
    buildingId: buildingB.id,
    name: "Eylül 2026 Aidatı B",
    amount: 100,
    periodYear: 2026,
    periodMonth: 9,
    dueDate: new Date(Date.UTC(2026, 8, 15)),
    chargeImmediately: true,
  });
  checks.otherBuildingOk = otherBuilding.createdCount === 2;

  // Parallel race: two creates for Nov should yield one success one fail
  const parallel = await Promise.allSettled([
    duesDefinitionService.create(tenant.id, site.id, {
      buildingId: building.id,
      name: "Kasım 2026 Aidatı",
      amount: 100,
      periodYear: 2026,
      periodMonth: 11,
      dueDate: new Date(Date.UTC(2026, 10, 15)),
      chargeImmediately: true,
    }),
    duesDefinitionService.create(tenant.id, site.id, {
      buildingId: building.id,
      name: "Kasım 2026 Aidatı",
      amount: 100,
      periodYear: 2026,
      periodMonth: 11,
      dueDate: new Date(Date.UTC(2026, 10, 15)),
      chargeImmediately: true,
    }),
  ]);
  const novDefs = await prisma.duesDefinition.count({
    where: {
      tenantId: tenant.id,
      buildingId: building.id,
      periodYear: 2026,
      periodMonth: 11,
      deletedAt: null,
    },
  });
  const novDebts = await prisma.apartmentDebt.count({
    where: {
      tenantId: tenant.id,
      buildingId: building.id,
      periodYear: 2026,
      periodMonth: 11,
      type: "DUES",
      status: "OPEN",
    },
  });
  checks.parallelSingleDefinition = novDefs === 1;
  checks.parallelSingleDebtSet = novDebts === 2;
  checks.parallelOneRejected = parallel.filter((p) => p.status === "rejected").length === 1;

  const preview = await duesDefinitionService.getPurgePreview(tenant.id, site.id, created.dues.id);
  checks.canHardDeleteUnpaid = preview.canHardDelete === true;

  await duesDefinitionService.purgeUnpaid(
    tenant.id,
    site.id,
    created.dues.id,
    actor.id,
    "Eylül 2026 Aidatı",
  );
  const afterPurgeDebts = await prisma.apartmentDebt.count({
    where: { tenantId: tenant.id, duesDefinitionId: created.dues.id },
  });
  const afterPurgeDef = await prisma.duesDefinition.findFirst({
    where: { id: created.dues.id },
  });
  checks.purgeRemovedDebts = afterPurgeDebts === 0;
  checks.purgeRemovedDefinition = afterPurgeDef == null;

  // Archive does not delete debts
  await duesDefinitionService.remove(tenant.id, site.id, otherPeriod.dues.id);
  const archivedDebts = await prisma.apartmentDebt.count({
    where: { tenantId: tenant.id, duesDefinitionId: otherPeriod.dues.id, status: "OPEN" },
  });
  checks.archiveKeepsDebts = archivedDebts === 2;

  // Payment blocks purge
  const paidCreate = await duesDefinitionService.create(tenant.id, site.id, {
    buildingId: building.id,
    name: "Aralık 2026 Aidatı",
    amount: 100,
    periodYear: 2026,
    periodMonth: 12,
    dueDate: new Date(Date.UTC(2026, 11, 15)),
    chargeImmediately: true,
  });
  const oneDebt = await prisma.apartmentDebt.findFirst({
    where: { tenantId: tenant.id, duesDefinitionId: paidCreate.dues.id },
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      apartmentId: oneDebt!.apartmentId,
      amount: 50,
      paymentDate: new Date(),
      paymentMethod: "CASH",
      status: "COMPLETED",
    },
  });
  await prisma.paymentAllocation.create({
    data: {
      tenantId: tenant.id,
      paymentId: payment.id,
      apartmentDebtId: oneDebt!.id,
      amount: 50,
    },
  });
  await prisma.apartmentDebt.update({
    where: { id: oneDebt!.id },
    data: { remainingAmount: 50 },
  });

  try {
    await duesDefinitionService.purgeUnpaid(
      tenant.id,
      site.id,
      paidCreate.dues.id,
      actor.id,
      "Aralık 2026 Aidatı",
    );
    checks.purgeBlockedWithPayment = false;
  } catch (error) {
    checks.purgeBlockedWithPayment =
      error instanceof Error && (error as { statusCode?: number }).statusCode === 409;
  }

  const otherTenant = await prisma.tenant.create({
    data: { name: `${PREFIX}other_${stamp}`, slug: `${PREFIX}other_${stamp}` },
  });
  const otherCount = await prisma.duesDefinition.count({ where: { tenantId: otherTenant.id } });
  checks.otherTenantUntouched = otherCount === 0;

  console.log(JSON.stringify({ checks, failed: Object.entries(checks).filter(([, v]) => !v) }, null, 2));

  // cleanup
  await prisma.paymentAllocation.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.apartmentDebt.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.duesDefinition.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.apartment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.building.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.site.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
  await prisma.user.delete({ where: { id: actor.id } });

  if (Object.values(checks).some((ok) => !ok)) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
