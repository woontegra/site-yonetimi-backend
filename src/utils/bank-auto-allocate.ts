import { Prisma } from "@prisma/client";

/**
 * Open debts oldest-first; exact full amount required (no advance/credit balance).
 * Returns null if nothing to allocate or remainder would remain.
 */
export async function buildAutoAllocations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  apartmentId: string,
  amount: Prisma.Decimal,
): Promise<Array<{ apartmentDebtId: string; amount: number }> | null> {
  const debts = await tx.apartmentDebt.findMany({
    where: {
      tenantId,
      apartmentId,
      status: "OPEN",
      cancelledAt: null,
      building: { siteId, deletedAt: null },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      remainingAmount: true,
      title: true,
      periodYear: true,
      periodMonth: true,
      dueDate: true,
    },
  });

  let left = new Prisma.Decimal(amount);
  const allocations: Array<{ apartmentDebtId: string; amount: number }> = [];
  for (const debt of debts) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(debt.remainingAmount, left);
    if (take.lte(0)) continue;
    allocations.push({ apartmentDebtId: debt.id, amount: Number(take.toFixed(2)) });
    left = left.sub(take);
  }

  if (allocations.length === 0) return null;
  if (left.gt(0)) return null;
  return allocations;
}

export async function previewAutoAllocations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  apartmentId: string,
  amount: Prisma.Decimal,
): Promise<{
  allocations: Array<{
    apartmentDebtId: string;
    amount: string;
    title: string;
    periodYear: number | null;
    periodMonth: number | null;
    remainingBefore: string;
    remainingAfter: string;
  }>;
  openDebtTotal: string;
  allocatable: boolean;
  remainder: string;
  warning: string | null;
}> {
  const debts = await tx.apartmentDebt.findMany({
    where: {
      tenantId,
      apartmentId,
      status: "OPEN",
      cancelledAt: null,
      building: { siteId, deletedAt: null },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      remainingAmount: true,
      title: true,
      periodYear: true,
      periodMonth: true,
    },
  });

  const openDebtTotal = debts.reduce(
    (sum, d) => sum.add(d.remainingAmount),
    new Prisma.Decimal(0),
  );

  let left = new Prisma.Decimal(amount);
  const allocations: Array<{
    apartmentDebtId: string;
    amount: string;
    title: string;
    periodYear: number | null;
    periodMonth: number | null;
    remainingBefore: string;
    remainingAfter: string;
  }> = [];

  for (const debt of debts) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(debt.remainingAmount, left);
    if (take.lte(0)) continue;
    const after = debt.remainingAmount.sub(take);
    allocations.push({
      apartmentDebtId: debt.id,
      amount: take.toFixed(2),
      title: debt.title,
      periodYear: debt.periodYear,
      periodMonth: debt.periodMonth,
      remainingBefore: debt.remainingAmount.toFixed(2),
      remainingAfter: after.toFixed(2),
    });
    left = left.sub(take);
  }

  const remainder = left.toFixed(2);
  const allocatable = allocations.length > 0 && left.lte(0);
  let warning: string | null = null;
  if (debts.length === 0) {
    warning = "Bu dairede açık borç yok; tahsilata aktarılamaz.";
  } else if (left.gt(0)) {
    warning =
      "Gelen tutar açık borç toplamını aşıyor. Avans/devreden bakiye henüz desteklenmiyor; işlem engellendi.";
  }

  return {
    allocations,
    openDebtTotal: openDebtTotal.toFixed(2),
    allocatable,
    remainder,
    warning,
  };
}
