/**
 * READ-ONLY: Hanlılar B Blok Eylül 2026 aidat duplicate teşhisi.
 * Silme/yazma yok.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";
const SITE = "93c20125-fe52-4148-a2e1-8f263af7b088";
const BLD = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  const defs = await prisma.duesDefinition.findMany({
    where: {
      tenantId: TENANT,
      buildingId: BLD,
      periodYear: 2026,
      periodMonth: 9,
      building: { siteId: SITE },
    },
    select: {
      id: true,
      name: true,
      amount: true,
      periodYear: true,
      periodMonth: true,
      isActive: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      buildingId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const report = [];
  for (const def of defs) {
    const debts = await prisma.apartmentDebt.findMany({
      where: { tenantId: TENANT, duesDefinitionId: def.id },
      select: {
        id: true,
        apartmentId: true,
        originalAmount: true,
        remainingAmount: true,
        status: true,
        cancelledAt: true,
        apartment: { select: { number: true } },
      },
      orderBy: { apartment: { number: "asc" } },
    });

    const debtIds = debts.map((d) => d.id);
    const allocations = debtIds.length
      ? await prisma.paymentAllocation.findMany({
          where: { tenantId: TENANT, apartmentDebtId: { in: debtIds } },
          select: {
            id: true,
            amount: true,
            paymentId: true,
            apartmentDebtId: true,
            payment: {
              select: {
                id: true,
                amount: true,
                status: true,
                bankTransaction: { select: { id: true } },
              },
            },
          },
        })
      : [];

    const paymentIds = [...new Set(allocations.map((a) => a.paymentId))];
    const paidSum = debts.reduce(
      (acc, d) => acc + Number(d.originalAmount) - Number(d.remainingAmount),
      0,
    );
    const remainingSum = debts.reduce((acc, d) => acc + Number(d.remainingAmount), 0);
    const originalSum = debts.reduce((acc, d) => acc + Number(d.originalAmount), 0);

    report.push({
      id: def.id,
      name: def.name,
      amount: def.amount.toString(),
      createdAt: def.createdAt.toISOString(),
      deletedAt: def.deletedAt?.toISOString() ?? null,
      isActive: def.isActive,
      debtCount: debts.length,
      originalSum: originalSum.toFixed(2),
      remainingSum: remainingSum.toFixed(2),
      paidViaDebtDiff: paidSum.toFixed(2),
      allocationCount: allocations.length,
      paymentCount: paymentIds.length,
      bankLinkedPayments: allocations.filter((a) => a.payment.bankTransaction != null).length,
      statuses: debts.reduce(
        (acc, d) => {
          acc[d.status] = (acc[d.status] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      apartmentNumbers: debts.map((d) => d.apartment.number),
    });
  }

  // Per-apartment debt count for Sep 2026 dues-linked debts on this building
  const allDebts = await prisma.apartmentDebt.findMany({
    where: {
      tenantId: TENANT,
      buildingId: BLD,
      periodYear: 2026,
      periodMonth: 9,
      type: "DUES",
      building: { siteId: SITE },
    },
    select: {
      id: true,
      apartmentId: true,
      duesDefinitionId: true,
      originalAmount: true,
      remainingAmount: true,
      status: true,
      apartment: { select: { number: true } },
    },
  });

  const byApt = new Map<string, typeof allDebts>();
  for (const d of allDebts) {
    const list = byApt.get(d.apartmentId) ?? [];
    list.push(d);
    byApt.set(d.apartmentId, list);
  }

  const dual = [...byApt.entries()].filter(([, list]) => list.length >= 2);
  const createdDeltaMs =
    defs.length >= 2 ? defs[1]!.createdAt.getTime() - defs[0]!.createdAt.getTime() : null;

  console.log(
    JSON.stringify(
      {
        definitionCount: defs.length,
        createdDeltaMs,
        defs: report,
        totalApartmentDebtsSep2026Dues: allDebts.length,
        apartmentsWithTwoOrMoreDebts: dual.length,
        sampleDualApartments: dual.slice(0, 5).map(([apartmentId, list]) => ({
          apartmentId,
          number: list[0]!.apartment.number,
          debts: list.map((d) => ({
            debtId: d.id,
            duesDefinitionId: d.duesDefinitionId,
            original: d.originalAmount.toString(),
            remaining: d.remainingAmount.toString(),
            status: d.status,
          })),
        })),
        allApartmentsHaveExactlyTwo:
          byApt.size === 17 && dual.length === 17 && dual.every(([, l]) => l.length === 2),
        anyAllocationOnAnySepDebt: (
          await prisma.paymentAllocation.count({
            where: {
              tenantId: TENANT,
              apartmentDebtId: { in: allDebts.map((d) => d.id) },
            },
          })
        ),
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
