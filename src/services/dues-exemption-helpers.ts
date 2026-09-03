import type {
  ApartmentDuesExemptionReason,
  ApartmentDuesExemptionType,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  applyDuesExemptionAmount,
  duesPeriodReferenceDate,
  isUtcDayInInclusiveRange,
  turkeyTodayUtcMidnight,
} from "../utils/turkey-date";
import { toMoneyString } from "../utils/money";

export type ActiveExemptionRow = {
  id: string;
  apartmentId: string;
  exemptionType: ApartmentDuesExemptionType;
  value: Prisma.Decimal | null;
  startDate: Date;
  endDate: Date | null;
  reason: ApartmentDuesExemptionReason;
  note: string | null;
};

const REASON_LABELS: Record<ApartmentDuesExemptionReason, string> = {
  MANAGER: "Yönetici muafiyeti",
  STAFF: "Personel/görevli muafiyeti",
  BOARD_DECISION: "Yönetim kararı",
  OTHER: "Diğer",
};

export function exemptionReasonLabel(reason: ApartmentDuesExemptionReason): string {
  return REASON_LABELS[reason] ?? reason;
}

export function mapExemptionPublic(row: {
  id: string;
  apartmentId: string;
  exemptionType: ApartmentDuesExemptionType;
  value: Prisma.Decimal | null;
  startDate: Date;
  endDate: Date | null;
  reason: ApartmentDuesExemptionReason;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: row.id,
    apartmentId: row.apartmentId,
    exemptionType: row.exemptionType,
    value: row.value != null ? toMoneyString(row.value) : null,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
    reasonLabel: exemptionReasonLabel(row.reason),
    note: row.note,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

/** Belirli bir referans günü kapsayan aktif muafiyetler (daire başına en fazla bir; FULL öncelikli). */
export async function findActiveExemptionsForApartments(input: {
  tenantId: string;
  siteId: string;
  apartmentIds: string[];
  referenceDate: Date;
}): Promise<Map<string, ActiveExemptionRow>> {
  if (input.apartmentIds.length === 0) return new Map();

  const rows = await prisma.apartmentDuesExemption.findMany({
    where: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      apartmentId: { in: input.apartmentIds },
      isActive: true,
      revokedAt: null,
      startDate: { lte: input.referenceDate },
      OR: [{ endDate: null }, { endDate: { gte: input.referenceDate } }],
    },
    select: {
      id: true,
      apartmentId: true,
      exemptionType: true,
      value: true,
      startDate: true,
      endDate: true,
      reason: true,
      note: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const map = new Map<string, ActiveExemptionRow>();
  for (const row of rows) {
    if (!isUtcDayInInclusiveRange(input.referenceDate, row.startDate, row.endDate)) {
      continue;
    }
    const existing = map.get(row.apartmentId);
    if (!existing) {
      map.set(row.apartmentId, row);
      continue;
    }
    if (existing.exemptionType !== "FULL" && row.exemptionType === "FULL") {
      map.set(row.apartmentId, row);
    }
  }
  return map;
}

export async function findActiveExemptionsForPeriod(input: {
  tenantId: string;
  siteId: string;
  apartmentIds: string[];
  periodYear: number;
  periodMonth: number;
}): Promise<Map<string, ActiveExemptionRow>> {
  return findActiveExemptionsForApartments({
    ...input,
    referenceDate: duesPeriodReferenceDate(input.periodYear, input.periodMonth),
  });
}

export function resolveChargeAmount(
  baseAmount: Prisma.Decimal,
  exemption: ActiveExemptionRow | undefined,
): { skip: boolean; amount: Prisma.Decimal; exemption: ActiveExemptionRow | null } {
  if (!exemption) {
    return { skip: false, amount: baseAmount, exemption: null };
  }
  const applied = applyDuesExemptionAmount(baseAmount, exemption);
  return { ...applied, exemption };
}

export type DuesStatusCode = "NORMAL" | "EXEMPT" | "DISCOUNTED" | "EXPIRING_SOON";

export function resolveDuesStatusForToday(
  exemption: ActiveExemptionRow | null | undefined,
  today: Date = turkeyTodayUtcMidnight(),
): { code: DuesStatusCode; label: string; exemption: ReturnType<typeof mapExemptionPublic> | null } {
  if (!exemption) {
    return { code: "NORMAL", label: "Normal", exemption: null };
  }
  const mapped = mapExemptionPublic({ ...exemption, isActive: true, createdAt: today, updatedAt: today, revokedAt: null });
  if (exemption.endDate) {
    const daysLeft = Math.round(
      (exemption.endDate.getTime() - today.getTime()) / 86_400_000,
    );
    if (daysLeft >= 0 && daysLeft <= 30) {
      return { code: "EXPIRING_SOON", label: "Muafiyet sona eriyor", exemption: mapped };
    }
  }
  if (exemption.exemptionType === "FULL") {
    return { code: "EXEMPT", label: "Muaf", exemption: mapped };
  }
  return { code: "DISCOUNTED", label: "İndirimli", exemption: mapped };
}
