import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";
const BLD = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";

async function main() {
  const defs = await p.duesDefinition.findMany({
    where: {
      tenantId: TENANT,
      buildingId: BLD,
      periodYear: 2026,
      periodMonth: 9,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      amount: true,
      createdAt: true,
      _count: { select: { debts: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const allApts = await p.apartment.findMany({
    where: { buildingId: BLD, deletedAt: null, isActive: true },
    select: { id: true, number: true },
  });

  const out = [];
  for (const d of defs) {
    const debts = await p.apartmentDebt.findMany({
      where: { duesDefinitionId: d.id },
      select: {
        id: true,
        apartmentId: true,
        originalAmount: true,
        remainingAmount: true,
        status: true,
        apartment: { select: { number: true } },
      },
    });
    const alloc = await p.paymentAllocation.count({
      where: { apartmentDebtId: { in: debts.map((x) => x.id) } },
    });
    const aptIds = new Set(debts.map((x) => x.apartmentId));
    const missing = allApts.filter((a) => !aptIds.has(a.id)).map((a) => a.number);
    out.push({
      id: d.id,
      name: d.name,
      amount: String(d.amount),
      createdAt: d.createdAt.toISOString(),
      debtCount: d._count.debts,
      allocationCount: alloc,
      missingApartmentNumbers: missing,
      totalOriginal: debts.reduce((s, x) => s + Number(x.originalAmount), 0).toFixed(2),
      totalRemaining: debts.reduce((s, x) => s + Number(x.remainingAmount), 0).toFixed(2),
    });
  }
  console.log(JSON.stringify({ definitionCount: defs.length, activeApartments: allApts.length, defs: out }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
