import { Prisma } from "@prisma/client";
import { formatPeriodLabel } from "../utils/dues-period";
import { toMoneyString } from "../utils/money";
import type { ProposedAllocationLine } from "./types";

export type OpenDebtForPlan = {
  id: string;
  title: string;
  periodYear: number | null;
  periodMonth: number | null;
  remainingAmount: Prisma.Decimal;
  dueDate: Date;
};

/**
 * En eski vadeden başlayarak tutarı açık borçlara dağıtır (FIFO).
 * Avans bakiyesi üretmez; kalan tutar remainder olarak döner.
 */
export function planFifoAllocations(
  amount: Prisma.Decimal,
  debts: OpenDebtForPlan[],
): {
  lines: ProposedAllocationLine[];
  allocated: Prisma.Decimal;
  remainder: Prisma.Decimal;
} {
  let left = new Prisma.Decimal(amount);
  const lines: ProposedAllocationLine[] = [];

  for (const debt of debts) {
    if (left.lte(0)) break;
    const rem = new Prisma.Decimal(debt.remainingAmount);
    if (rem.lte(0)) continue;
    const take = Prisma.Decimal.min(rem, left);
    if (take.lte(0)) continue;
    const after = rem.sub(take);
    lines.push({
      apartmentDebtId: debt.id,
      title: debt.title,
      periodYear: debt.periodYear,
      periodMonth: debt.periodMonth,
      periodLabel:
        debt.periodYear != null && debt.periodMonth != null
          ? formatPeriodLabel(debt.periodYear, debt.periodMonth)
          : null,
      amount: toMoneyString(take),
      remainingBefore: toMoneyString(rem),
      remainingAfter: toMoneyString(after),
    });
    left = left.sub(take);
  }

  const allocated = new Prisma.Decimal(amount).sub(left);
  return { lines, allocated, remainder: left };
}

/** Aynı daireye gelen birden fazla tutarı birleştirip tek FIFO planı üretir. */
export function planUnifiedFifoForAmounts(
  amounts: Prisma.Decimal[],
  debts: OpenDebtForPlan[],
): {
  lines: ProposedAllocationLine[];
  totalIncoming: Prisma.Decimal;
  remainder: Prisma.Decimal;
} {
  const totalIncoming = amounts.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
  const plan = planFifoAllocations(totalIncoming, debts);
  return {
    lines: plan.lines,
    totalIncoming,
    remainder: plan.remainder,
  };
}
