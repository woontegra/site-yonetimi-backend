import { Prisma } from "@prisma/client";

export type DebtSnapshot = {
  id: string;
  title: string;
  periodYear: number | null;
  periodMonth: number | null;
  remainingAmount: Prisma.Decimal;
  dueDate: Date;
};

export type BatchTxInput = {
  id: string;
  amount: Prisma.Decimal;
  transactionDate: Date;
  description: string;
  referenceNo: string | null;
  apartmentId: string;
};

export type PlannedAllocation = {
  apartmentDebtId: string;
  amount: string;
  title: string;
  periodYear: number | null;
  periodMonth: number | null;
  remainingBefore: string;
  remainingAfter: string;
};

export type TxAllocationPlan = {
  transactionId: string;
  allocations: PlannedAllocation[];
  allocatedTotal: string;
  remainder: string;
  allocatable: boolean;
  warning: string | null;
};

export type ApartmentBatchPlan = {
  apartmentId: string;
  transactionPlans: TxAllocationPlan[];
  unifiedAllocations: Array<{
    apartmentDebtId: string;
    title: string;
    periodYear: number | null;
    periodMonth: number | null;
    amount: string;
    remainingAfter: string;
  }>;
  totalIncoming: string;
  openDebtTotal: string;
  allocatableTotal: string;
  remainderTotal: string;
  /** Kaç açık borca tutar yazıldı */
  debtsCovered: number;
  status: "READY" | "OVERPAYMENT" | "NO_OPEN_DEBT" | "MANUAL_REVIEW";
  warning: string | null;
};

export function sortBatchTransactions(txs: BatchTxInput[]): BatchTxInput[] {
  return [...txs].sort((a, b) => {
    const da = a.transactionDate.getTime();
    const db = b.transactionDate.getTime();
    if (da !== db) return da - db;
    const ra = a.referenceNo ?? "";
    const rb = b.referenceNo ?? "";
    if (ra !== rb) return ra.localeCompare(rb);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Aynı dairenin hareketlerini tarih sırasıyla işler; her hareket tutarını
 * en eski açık borçtan başlayarak (geçici kalanlarla) dağıtır.
 * Açıklamadaki ay adları dağıtımı etkilemez. DB yazılmaz.
 */
export function planApartmentBatchAllocations(
  debts: DebtSnapshot[],
  transactions: BatchTxInput[],
): ApartmentBatchPlan {
  const apartmentId = transactions[0]?.apartmentId ?? "";
  const openDebtTotal = debts.reduce((s, d) => s.add(d.remainingAmount), new Prisma.Decimal(0));
  const provisional = new Map(debts.map((d) => [d.id, new Prisma.Decimal(d.remainingAmount)]));
  const sorted = sortBatchTransactions(transactions);

  const transactionPlans: TxAllocationPlan[] = [];
  const unifiedMap = new Map<
    string,
    {
      apartmentDebtId: string;
      title: string;
      periodYear: number | null;
      periodMonth: number | null;
      amount: Prisma.Decimal;
      remainingAfter: Prisma.Decimal;
    }
  >();

  for (const tx of sorted) {
    const result = allocateFifo(debts, provisional, tx.amount);
    for (const alloc of result.allocations) {
      const prev = unifiedMap.get(alloc.apartmentDebtId);
      const take = new Prisma.Decimal(alloc.amount);
      unifiedMap.set(alloc.apartmentDebtId, {
        apartmentDebtId: alloc.apartmentDebtId,
        title: alloc.title,
        periodYear: alloc.periodYear,
        periodMonth: alloc.periodMonth,
        amount: (prev?.amount ?? new Prisma.Decimal(0)).add(take),
        remainingAfter: new Prisma.Decimal(alloc.remainingAfter),
      });
    }

    let warning: string | null = null;
    if (debts.length === 0) warning = "Bu dairede açık borç yok; tahsilata aktarılamaz.";
    else if (result.remainder.gt(0)) {
      warning = `Dağıtılamayan bakiye: ${result.remainder.toFixed(2)} TL`;
    }

    transactionPlans.push({
      transactionId: tx.id,
      allocations: result.allocations,
      allocatedTotal: result.allocated.toFixed(2),
      remainder: result.remainder.toFixed(2),
      allocatable: result.allocations.length > 0 && result.remainder.lte(0),
      warning,
    });
  }

  const totalIncoming = sorted.reduce((s, t) => s.add(t.amount), new Prisma.Decimal(0));
  const allocatableTotal = transactionPlans
    .filter((p) => p.allocatable)
    .reduce((s, p) => s.add(new Prisma.Decimal(p.allocatedTotal)), new Prisma.Decimal(0));
  const remainderTotal = transactionPlans.reduce(
    (s, p) => s.add(new Prisma.Decimal(p.remainder)),
    new Prisma.Decimal(0),
  );

  for (const debt of debts) {
    const planned = unifiedMap.get(debt.id)?.amount ?? new Prisma.Decimal(0);
    if (planned.gt(debt.remainingAmount.add(new Prisma.Decimal("0.001")))) {
      throw new Error(
        `Allocation invariant broken for debt ${debt.id}: planned ${planned} > remaining ${debt.remainingAmount}`,
      );
    }
  }

  let status: ApartmentBatchPlan["status"] = "READY";
  let warning: string | null = null;
  if (debts.length === 0) {
    status = "NO_OPEN_DEBT";
    warning = "Açık borç yok.";
  } else if (remainderTotal.gt(0)) {
    status = "OVERPAYMENT";
    warning = `Dağıtılamayan bakiye: ${remainderTotal.toFixed(2)} TL`;
  } else if (transactionPlans.some((p) => !p.allocatable)) {
    status = "MANUAL_REVIEW";
    warning = "Bazı hareketler dağıtılamadı.";
  } else {
    warning = null;
  }

  return {
    apartmentId,
    transactionPlans,
    unifiedAllocations: [...unifiedMap.values()].map((u) => ({
      apartmentDebtId: u.apartmentDebtId,
      title: u.title,
      periodYear: u.periodYear,
      periodMonth: u.periodMonth,
      amount: u.amount.toFixed(2),
      remainingAfter: u.remainingAfter.toFixed(2),
    })),
    totalIncoming: totalIncoming.toFixed(2),
    openDebtTotal: openDebtTotal.toFixed(2),
    allocatableTotal: allocatableTotal.toFixed(2),
    remainderTotal: remainderTotal.toFixed(2),
    debtsCovered: unifiedMap.size,
    status,
    warning,
  };
}

function allocateFifo(
  debts: DebtSnapshot[],
  provisional: Map<string, Prisma.Decimal>,
  amount: Prisma.Decimal,
): { allocations: PlannedAllocation[]; allocated: Prisma.Decimal; remainder: Prisma.Decimal } {
  let left = new Prisma.Decimal(amount);
  const allocations: PlannedAllocation[] = [];

  for (const debt of debts) {
    if (left.lte(0)) break;
    const rem = provisional.get(debt.id) ?? new Prisma.Decimal(0);
    if (rem.lte(0)) continue;
    const take = Prisma.Decimal.min(rem, left);
    if (take.lte(0)) continue;
    const after = rem.sub(take);
    provisional.set(debt.id, after);
    allocations.push({
      apartmentDebtId: debt.id,
      amount: take.toFixed(2),
      title: debt.title,
      periodYear: debt.periodYear,
      periodMonth: debt.periodMonth,
      remainingBefore: rem.toFixed(2),
      remainingAfter: after.toFixed(2),
    });
    left = left.sub(take);
  }

  const allocated = new Prisma.Decimal(amount).sub(left);
  return { allocations, allocated, remainder: left };
}

export async function loadOpenDebtsForApartment(
  client: Prisma.TransactionClient | typeof import("../lib/prisma").prisma,
  tenantId: string,
  siteId: string,
  apartmentId: string,
): Promise<DebtSnapshot[]> {
  return client.apartmentDebt.findMany({
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
      title: true,
      periodYear: true,
      periodMonth: true,
      remainingAmount: true,
      dueDate: true,
    },
  });
}

/** Commit-time: en eski açıktan itibaren dağıt (açıklama dönemi yok). */
export function allocateAmountAgainstProvisional(
  debts: DebtSnapshot[],
  provisional: Map<string, Prisma.Decimal>,
  amount: Prisma.Decimal,
  _description: string,
  _transactionDate: Date,
): Array<{ apartmentDebtId: string; amount: number }> | null {
  const result = allocateFifo(debts, provisional, amount);
  if (result.allocations.length === 0) return null;
  if (result.remainder.gt(0)) return null;
  return result.allocations.map((a) => ({
    apartmentDebtId: a.apartmentDebtId,
    amount: Number(a.amount),
  }));
}
