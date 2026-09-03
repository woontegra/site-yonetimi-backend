import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toMoneyString } from "../utils/money";

export type AssessmentSafety = {
  debtCount: number;
  openDebtCount: number;
  allocationCount: number;
  collectedAmount: string;
  hasCollections: boolean;
  canHardDelete: boolean;
  canSafeCancel: boolean;
  canChargeMore: boolean;
  financialFieldsLocked: boolean;
  blockedReason: string | null;
};

export async function loadAssessmentSafety(
  tenantId: string,
  siteId: string,
  duesDefinitionId: string,
  activeApartmentCount?: number,
): Promise<AssessmentSafety> {
  const debts = await prisma.apartmentDebt.findMany({
    where: {
      tenantId,
      duesDefinitionId,
      building: { siteId, deletedAt: null },
    },
    select: {
      id: true,
      status: true,
      originalAmount: true,
      remainingAmount: true,
      _count: { select: { allocations: true } },
    },
  });

  const debtCount = debts.length;
  const openDebtCount = debts.filter((d) => d.status === "OPEN").length;
  const allocationCount = debts.reduce((sum, d) => sum + d._count.allocations, 0);
  let collected = new Prisma.Decimal(0);
  for (const d of debts) {
    if (d.status === "CANCELLED") continue;
    collected = collected.plus(d.originalAmount.minus(d.remainingAmount));
  }

  const unpaidFully =
    debtCount > 0 &&
    debts.every(
      (d) =>
        d.status === "OPEN" &&
        d.originalAmount.equals(d.remainingAmount) &&
        d._count.allocations === 0,
    );
  const draftOnly = debtCount === 0;
  const hasCollections = allocationCount > 0 || collected.greaterThan(0);
  const canHardDelete = draftOnly || (unpaidFully && !hasCollections);
  const canSafeCancel =
    openDebtCount > 0 &&
    debts.some(
      (d) =>
        d.status === "OPEN" &&
        d.originalAmount.equals(d.remainingAmount) &&
        d._count.allocations === 0,
    );

  let activeCount = activeApartmentCount;
  if (activeCount === undefined) {
    const dues = await prisma.duesDefinition.findFirst({
      where: { id: duesDefinitionId, tenantId, deletedAt: null },
      select: { buildingId: true },
    });
    activeCount = dues
      ? await prisma.apartment.count({
          where: {
            tenantId,
            buildingId: dues.buildingId,
            deletedAt: null,
            isActive: true,
            building: { siteId, deletedAt: null },
          },
        })
      : 0;
  }

  const chargedActiveLike = debts.filter((d) => d.status === "OPEN" || d.status === "PAID").length;
  const canChargeMore = chargedActiveLike < (activeCount ?? 0);

  return {
    debtCount,
    openDebtCount,
    allocationCount,
    collectedAmount: toMoneyString(collected),
    hasCollections,
    canHardDelete,
    canSafeCancel,
    canChargeMore: debtCount === 0 || canChargeMore,
    financialFieldsLocked: debtCount > 0,
    blockedReason: hasCollections
      ? "Bu aidata tahsilat işlendiği için doğrudan silinemez. Önce bağlı tahsilatları inceleyin veya borçlandırmayı güvenli iptal akışıyla geri alın."
      : null,
  };
}

export async function loadAssessmentSafetyMap(
  tenantId: string,
  siteId: string,
  duesDefinitionIds: string[],
): Promise<Map<string, AssessmentSafety>> {
  const map = new Map<string, AssessmentSafety>();
  if (duesDefinitionIds.length === 0) return map;

  await Promise.all(
    duesDefinitionIds.map(async (id) => {
      map.set(id, await loadAssessmentSafety(tenantId, siteId, id));
    }),
  );
  return map;
}
