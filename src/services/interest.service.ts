import {
  ApartmentDebtStatus,
  ApartmentDebtType,
  InterestDecisionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  INTEREST_FORMULA_TR,
  buildCalculationNote,
  buildInterestTitle,
  comparePeriod,
  computeMonthlyInterest,
  firstInterestPeriod,
  iterateMonths,
  lastDayOfMonthUtc,
  monthCoveredByDecision,
  periodCode,
  principalCutoffDate,
  remainingPrincipalForInterestMonth,
  type PaymentSlice,
} from "../finance/interest-calc";
import { toMoneyString } from "../utils/money";
import {
  formatTurkeyDateInput,
  parseTurkeyDateInput,
  turkeyTodayUtcMidnight,
} from "../utils/turkey-date";
import { HttpError } from "../utils/httpError";
import type {
  CreateInterestDecisionInput,
  InterestApplyInput,
  InterestPreviewInput,
  ListInterestDecisionsQuery,
  UpdateInterestDecisionInput,
} from "../validators/interest.validators";

const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

const INTEREST_ELIGIBLE_TYPES: ApartmentDebtType[] = ["DUES", "MANUAL"];

function personFullName(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`.trim();
}

function mapDecision(row: {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  monthlyRate: Prisma.Decimal;
  ratePeriod: "MONTHLY";
  description: string | null;
  status: InterestDecisionStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; fullName: string } | null;
  _count?: { applications: number };
}) {
  return {
    id: row.id,
    name: row.name,
    startDate: formatTurkeyDateInput(row.startDate),
    endDate: formatTurkeyDateInput(row.endDate),
    monthlyRate: row.monthlyRate.toFixed(4),
    ratePeriod: row.ratePeriod,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    applicationCount: row._count?.applications ?? 0,
    formula: INTEREST_FORMULA_TR,
  };
}

async function assertNoActiveOverlap(
  tenantId: string,
  siteId: string,
  startDate: Date,
  endDate: Date,
  excludeId?: string,
): Promise<void> {
  const overlapping = await prisma.interestDecision.findFirst({
    where: {
      tenantId,
      siteId,
      status: "ACTIVE",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, name: true },
  });
  if (overlapping) {
    throw new HttpError(
      409,
      `Bu tarih aralığında aktif faiz kararı zaten var: “${overlapping.name}”. Aynı siteye çakışan aktif oran uygulanamaz.`,
    );
  }
}

async function getDecisionOrThrow(tenantId: string, siteId: string, id: string) {
  const decision = await prisma.interestDecision.findFirst({
    where: { id, tenantId, siteId },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      _count: { select: { applications: true } },
    },
  });
  if (!decision) throw new HttpError(404, "Faiz kararı bulunamadı.");
  return decision;
}

type PreviewRowStatus = "APPLICABLE" | "ALREADY_APPLIED" | "EXCLUDED";

type PreviewRow = {
  status: PreviewRowStatus;
  excludeReason: string | null;
  warning: string | null;
  sourceDebtId: string;
  buildingName: string;
  apartmentNumber: string;
  apartmentId: string;
  personLabel: string;
  relationLabel: string | null;
  sourceTitle: string;
  sourceType: ApartmentDebtType;
  sourcePeriodLabel: string | null;
  dueDate: string;
  elapsedLabel: string;
  paymentsInWindow: string;
  principalBase: string;
  monthlyRate: string;
  interestAmount: string;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  calculationNote: string | null;
  alreadyAppliedInterestDebtId: string | null;
};

function relationPersonLabel(relations: Array<{
  relationType: "OWNER" | "TENANT";
  person: { firstName: string; lastName: string };
}>): { personLabel: string; relationLabel: string | null } {
  const owner = relations.find((r) => r.relationType === "OWNER");
  const tenant = relations.find((r) => r.relationType === "TENANT");
  if (owner) {
    return { personLabel: personFullName(owner.person), relationLabel: "Malik" };
  }
  if (tenant) {
    return { personLabel: personFullName(tenant.person), relationLabel: "Sakin" };
  }
  return { personLabel: "—", relationLabel: null };
}

function periodLabel(year: number | null, month: number | null): string | null {
  if (!year || !month) return null;
  return `${MONTH_NAMES[month - 1] ?? month} ${year}`;
}

async function buildPreviewRows(
  tenantId: string,
  siteId: string,
  decision: {
    id: string;
    startDate: Date;
    endDate: Date;
    monthlyRate: Prisma.Decimal;
  },
  input: InterestPreviewInput,
): Promise<{ rows: PreviewRow[]; formula: string }> {
  const debts = await prisma.apartmentDebt.findMany({
    where: {
      tenantId,
      status: { not: "CANCELLED" },
      type: { in: INTEREST_ELIGIBLE_TYPES },
      building: {
        siteId,
        deletedAt: null,
        ...(input.buildingId ? { id: input.buildingId } : {}),
      },
      apartment: {
        deletedAt: null,
        ...(input.apartmentId ? { id: input.apartmentId } : {}),
      },
    },
    select: {
      id: true,
      type: true,
      title: true,
      originalAmount: true,
      remainingAmount: true,
      dueDate: true,
      periodYear: true,
      periodMonth: true,
      status: true,
      building: { select: { id: true, name: true } },
      apartment: {
        select: {
          id: true,
          number: true,
          relations: {
            where: { isActive: true, isPrimary: true },
            select: {
              relationType: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      allocations: {
        where: { payment: { status: "COMPLETED" } },
        select: {
          amount: true,
          payment: { select: { paymentDate: true } },
        },
      },
      interestApplicationsAsSource: {
        select: {
          periodYear: true,
          periodMonth: true,
          principalBase: true,
          interestAmount: true,
          interestDebtId: true,
        },
      },
    },
  });

  const rate = decision.monthlyRate;
  const rows: PreviewRow[] = [];
  const fromCode = periodCode(input.fromYear, input.fromMonth);
  const toCode = periodCode(input.toYear, input.toMonth);

  for (const debt of debts) {
    const { personLabel, relationLabel } = relationPersonLabel(debt.apartment.relations);
    const payments: PaymentSlice[] = debt.allocations.map((a) => ({
      paymentDate: a.payment.paymentDate,
      amount: a.amount,
    }));
    const paymentsTotal = payments.reduce(
      (sum, p) => sum.add(p.amount),
      new Prisma.Decimal(0),
    );
    const first = firstInterestPeriod(debt.dueDate);
    const appliedMap = new Map(
      debt.interestApplicationsAsSource
        .filter((a) => {
          const code = periodCode(a.periodYear, a.periodMonth);
          return code >= fromCode && code <= toCode;
        })
        .map((a) => [periodCode(a.periodYear, a.periodMonth), a]),
    );

    for (const { year, month } of iterateMonths(
      input.fromYear,
      input.fromMonth,
      input.toYear,
      input.toMonth,
    )) {
      if (comparePeriod(year, month, first.year, first.month) < 0) {
        // Vade ayı dolmadan faiz başlamaz; ön izlemeyi şişirmemek için sessizce atla.
        continue;
      }

      const pLabel = `${MONTH_NAMES[month - 1] ?? month} ${year}`;
      const baseMeta = {
        sourceDebtId: debt.id,
        buildingName: debt.building.name,
        apartmentNumber: debt.apartment.number,
        apartmentId: debt.apartment.id,
        personLabel,
        relationLabel,
        sourceTitle: debt.title,
        sourceType: debt.type,
        sourcePeriodLabel: periodLabel(debt.periodYear, debt.periodMonth),
        dueDate: formatTurkeyDateInput(debt.dueDate),
        periodYear: year,
        periodMonth: month,
        periodLabel: pLabel,
        monthlyRate: rate.toFixed(4),
        paymentsInWindow: toMoneyString(paymentsTotal),
      };

      if (!monthCoveredByDecision(year, month, decision.startDate, decision.endDate)) {
        const principalProbe = remainingPrincipalForInterestMonth(
          debt.originalAmount,
          payments,
          year,
          month,
        );
        if (principalProbe.lte(0)) continue;
        rows.push({
          ...baseMeta,
          status: "EXCLUDED",
          excludeReason: "Bu ay faiz kararının tarih aralığında değil.",
          warning: null,
          elapsedLabel: `${comparePeriod(year, month, first.year, first.month) + 1}. faiz ayı`,
          principalBase: toMoneyString(principalProbe),
          interestAmount: "0.00",
          calculationNote: null,
          alreadyAppliedInterestDebtId: null,
        });
        continue;
      }

      const applied = appliedMap.get(periodCode(year, month));
      if (applied) {
        const recomputed = remainingPrincipalForInterestMonth(
          debt.originalAmount,
          payments,
          year,
          month,
        );
        const warning =
          !recomputed.eq(applied.principalBase)
            ? "Ödeme iptali / değişikliği nedeniyle faiz hesabı yeniden kontrol edilmeli. Geçmiş faiz kaydı sessizce değiştirilmez."
            : null;
        rows.push({
          ...baseMeta,
          status: "ALREADY_APPLIED",
          excludeReason: `Bu borcun ${String(month).padStart(2, "0")}.${year} dönemi faizi daha önce uygulanmış.`,
          warning,
          elapsedLabel: `${comparePeriod(year, month, first.year, first.month) + 1}. faiz ayı`,
          principalBase: toMoneyString(applied.principalBase),
          interestAmount: toMoneyString(applied.interestAmount),
          calculationNote: null,
          alreadyAppliedInterestDebtId: applied.interestDebtId,
        });
        continue;
      }

      const principal = remainingPrincipalForInterestMonth(
        debt.originalAmount,
        payments,
        year,
        month,
      );
      if (principal.lte(0)) {
        continue;
      }

      const interestAmount = computeMonthlyInterest(principal, rate);
      if (interestAmount.lte(0)) {
        rows.push({
          ...baseMeta,
          status: "EXCLUDED",
          excludeReason: "Hesaplanan faiz tutarı 0.",
          warning: null,
          elapsedLabel: `${comparePeriod(year, month, first.year, first.month) + 1}. faiz ayı`,
          principalBase: toMoneyString(principal),
          interestAmount: "0.00",
          calculationNote: null,
          alreadyAppliedInterestDebtId: null,
        });
        continue;
      }

      const cutoff = principalCutoffDate(year, month);
      const monthsElapsed = comparePeriod(year, month, first.year, first.month) + 1;
      const note = buildCalculationNote({
        principalBase: principal,
        monthlyRate: rate,
        interestAmount,
        periodYear: year,
        periodMonth: month,
        cutoffDate: cutoff,
      });

      rows.push({
        ...baseMeta,
        status: "APPLICABLE",
        excludeReason: null,
        warning: null,
        elapsedLabel: `${monthsElapsed}. faiz ayı`,
        principalBase: toMoneyString(principal),
        interestAmount: toMoneyString(interestAmount),
        calculationNote: note,
        alreadyAppliedInterestDebtId: null,
      });
    }
  }

  rows.sort((a, b) => {
    const byBuilding = a.buildingName.localeCompare(b.buildingName, "tr");
    if (byBuilding !== 0) return byBuilding;
    const byApt = a.apartmentNumber.localeCompare(b.apartmentNumber, "tr", { numeric: true });
    if (byApt !== 0) return byApt;
    return periodCode(a.periodYear, a.periodMonth) - periodCode(b.periodYear, b.periodMonth);
  });

  return { rows, formula: INTEREST_FORMULA_TR };
}

function summarizePreview(rows: PreviewRow[], calculationAsOf: string) {
  const applicable = rows.filter((r) => r.status === "APPLICABLE");
  const already = rows.filter((r) => r.status === "ALREADY_APPLIED");
  const excluded = rows.filter((r) => r.status === "EXCLUDED");
  const apartmentsInspected = new Set(rows.map((r) => r.apartmentId)).size;
  const apartmentsApplicable = new Set(applicable.map((r) => r.apartmentId)).size;
  const debtsApplicable = new Set(applicable.map((r) => r.sourceDebtId)).size;
  const debtsExcluded = new Set(excluded.map((r) => r.sourceDebtId)).size;
  const openPrincipal = applicable.reduce(
    (s, r) => s.add(new Prisma.Decimal(r.principalBase)),
    new Prisma.Decimal(0),
  );
  const totalInterest = applicable.reduce(
    (s, r) => s.add(new Prisma.Decimal(r.interestAmount)),
    new Prisma.Decimal(0),
  );

  return {
    apartmentsInspected,
    apartmentsApplicable,
    debtsApplicable,
    debtsExcluded,
    alreadyAppliedCount: already.length,
    applicableCount: applicable.length,
    excludedCount: excluded.length,
    totalOpenPrincipal: toMoneyString(openPrincipal),
    totalInterest: toMoneyString(totalInterest),
    calculationAsOf,
    applyMessage:
      applicable.length === 0
        ? "Uygulanacak faiz satırı yok."
        : `${apartmentsApplicable} dairenin ${applicable.length} gecikmiş borcuna toplam ${toMoneyString(totalInterest)} ₺ faiz uygulanacak.`,
  };
}

export const interestService = {
  async list(tenantId: string, siteId: string, query: ListInterestDecisionsQuery) {
    const where: Prisma.InterestDecisionWhereInput = {
      tenantId,
      siteId,
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.perPage;
    const [total, items] = await Promise.all([
      prisma.interestDecision.count({ where }),
      prisma.interestDecision.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { applications: true } },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
    ]);
    return {
      items: items.map(mapDecision),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  },

  async getById(tenantId: string, siteId: string, id: string) {
    const decision = await getDecisionOrThrow(tenantId, siteId, id);
    return mapDecision(decision);
  },

  async create(
    tenantId: string,
    siteId: string,
    userId: string | undefined,
    input: CreateInterestDecisionInput,
  ) {
    const startDate = parseTurkeyDateInput(input.startDate);
    const endDate = parseTurkeyDateInput(input.endDate);
    if (input.status === "ACTIVE") {
      await assertNoActiveOverlap(tenantId, siteId, startDate, endDate);
    }
    const created = await prisma.interestDecision.create({
      data: {
        tenantId,
        siteId,
        name: input.name,
        startDate,
        endDate,
        monthlyRate: new Prisma.Decimal(input.monthlyRate.toFixed(4)),
        ratePeriod: input.ratePeriod,
        description: input.description ?? null,
        status: input.status,
        createdByUserId: userId ?? null,
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { applications: true } },
      },
    });
    return mapDecision(created);
  },

  async update(
    tenantId: string,
    siteId: string,
    id: string,
    input: UpdateInterestDecisionInput,
  ) {
    const existing = await getDecisionOrThrow(tenantId, siteId, id);
    const hasApplications = existing._count.applications > 0;

    if (hasApplications) {
      const forbidden =
        input.name !== undefined ||
        input.startDate !== undefined ||
        input.endDate !== undefined ||
        input.monthlyRate !== undefined ||
        input.description !== undefined;
      if (forbidden && input.status === undefined) {
        throw new HttpError(
          409,
          `Bu faiz kararı daha önce ${existing._count.applications} borca uygulanmıştır. Geçmiş hesaplamaların korunması için oran/tarihler düzenlenemez; pasife alabilirsiniz.`,
        );
      }
      if (forbidden) {
        throw new HttpError(
          409,
          `Bu faiz kararı daha önce ${existing._count.applications} borca uygulanmıştır. Geçmiş hesaplamaların korunması için karar silinemez veya oran/tarihler değiştirilemez; pasife alabilirsiniz.`,
        );
      }
      if (input.status && input.status !== "INACTIVE" && input.status !== existing.status) {
        if (input.status === "ACTIVE") {
          const startDate = existing.startDate;
          const endDate = existing.endDate;
          await assertNoActiveOverlap(tenantId, siteId, startDate, endDate, id);
        } else if (input.status === "DRAFT") {
          throw new HttpError(409, "Uygulanmış faiz kararı taslağa alınamaz; pasife alabilirsiniz.");
        }
      }
      const updated = await prisma.interestDecision.update({
        where: { id },
        data: { status: input.status ?? existing.status },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { applications: true } },
        },
      });
      return mapDecision(updated);
    }

    const startDate = input.startDate
      ? parseTurkeyDateInput(input.startDate)
      : existing.startDate;
    const endDate = input.endDate ? parseTurkeyDateInput(input.endDate) : existing.endDate;
    if (startDate > endDate) {
      throw new HttpError(400, "Başlangıç tarihi bitiş tarihinden sonra olamaz.");
    }
    const nextStatus = input.status ?? existing.status;
    if (nextStatus === "ACTIVE") {
      await assertNoActiveOverlap(tenantId, siteId, startDate, endDate, id);
    }

    const updated = await prisma.interestDecision.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        startDate,
        endDate,
        monthlyRate:
          input.monthlyRate !== undefined
            ? new Prisma.Decimal(input.monthlyRate.toFixed(4))
            : existing.monthlyRate,
        description:
          input.description !== undefined ? input.description ?? null : existing.description,
        status: nextStatus,
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { applications: true } },
      },
    });
    return mapDecision(updated);
  },

  async remove(tenantId: string, siteId: string, id: string) {
    const existing = await getDecisionOrThrow(tenantId, siteId, id);
    if (existing._count.applications > 0) {
      throw new HttpError(
        409,
        `Bu faiz kararı daha önce ${existing._count.applications} borca uygulanmıştır. Geçmiş hesaplamaların korunması için karar silinemez; pasife alabilirsiniz.`,
      );
    }
    await prisma.interestDecision.delete({ where: { id } });
    return { ok: true as const };
  },

  async preview(tenantId: string, siteId: string, input: InterestPreviewInput) {
    const decision = await getDecisionOrThrow(tenantId, siteId, input.decisionId);
    const { rows, formula } = await buildPreviewRows(tenantId, siteId, decision, input);
    const calculationAsOf = formatTurkeyDateInput(turkeyTodayUtcMidnight());
    return {
      decision: mapDecision(decision),
      formula,
      summary: summarizePreview(rows, calculationAsOf),
      rows,
    };
  },

  async apply(
    tenantId: string,
    siteId: string,
    userId: string | undefined,
    input: InterestApplyInput,
  ) {
    const decision = await getDecisionOrThrow(tenantId, siteId, input.decisionId);
    if (decision.status !== "ACTIVE") {
      throw new HttpError(409, "Faiz yalnızca aktif karar üzerinden uygulanabilir.");
    }

    const { rows } = await buildPreviewRows(tenantId, siteId, decision, input);
    const applicable = rows.filter((r) => r.status === "APPLICABLE");
    if (applicable.length === 0) {
      throw new HttpError(400, "Uygulanacak faiz satırı yok.");
    }

    const created = await prisma.$transaction(async (tx) => {
      const results: Array<{ interestDebtId: string; applicationId: string }> = [];

      for (const row of applicable) {
        // Transaction içinde mükerrer kontrolü
        const dup = await tx.interestApplication.findUnique({
          where: {
            sourceDebtId_periodYear_periodMonth: {
              sourceDebtId: row.sourceDebtId,
              periodYear: row.periodYear,
              periodMonth: row.periodMonth,
            },
          },
          select: { id: true },
        });
        if (dup) {
          throw new HttpError(
            409,
            `Bu borcun ${String(row.periodMonth).padStart(2, "0")}.${row.periodYear} dönemi faizi daha önce uygulanmış.`,
          );
        }

        const source = await tx.apartmentDebt.findFirst({
          where: {
            id: row.sourceDebtId,
            tenantId,
            status: { not: "CANCELLED" },
            type: { in: INTEREST_ELIGIBLE_TYPES },
            building: { siteId, deletedAt: null },
          },
          select: {
            id: true,
            buildingId: true,
            apartmentId: true,
            title: true,
            originalAmount: true,
            dueDate: true,
            periodYear: true,
            periodMonth: true,
            allocations: {
              where: { payment: { status: "COMPLETED" } },
              select: {
                amount: true,
                payment: { select: { paymentDate: true } },
              },
            },
          },
        });
        if (!source) {
          throw new HttpError(404, "Kaynak borç bulunamadı veya faiz için uygun değil.");
        }

        const payments: PaymentSlice[] = source.allocations.map((a) => ({
          paymentDate: a.payment.paymentDate,
          amount: a.amount,
        }));
        const principal = remainingPrincipalForInterestMonth(
          source.originalAmount,
          payments,
          row.periodYear,
          row.periodMonth,
        );
        const interestAmount = computeMonthlyInterest(principal, decision.monthlyRate);
        if (principal.lte(0) || interestAmount.lte(0)) {
          throw new HttpError(
            409,
            "Faiz uygulanmadan önce bakiyeler değişti. Lütfen ön izlemeyi yenileyin.",
          );
        }

        const dueDate = lastDayOfMonthUtc(row.periodYear, row.periodMonth);
        const cutoff = principalCutoffDate(row.periodYear, row.periodMonth);
        const note = buildCalculationNote({
          principalBase: principal,
          monthlyRate: decision.monthlyRate,
          interestAmount,
          periodYear: row.periodYear,
          periodMonth: row.periodMonth,
          cutoffDate: cutoff,
        });
        const title = buildInterestTitle(source.title, row.periodYear, row.periodMonth);

        const interestDebt = await tx.apartmentDebt.create({
          data: {
            tenantId,
            buildingId: source.buildingId,
            apartmentId: source.apartmentId,
            type: "INTEREST",
            title,
            originalAmount: interestAmount,
            remainingAmount: interestAmount,
            dueDate,
            periodYear: row.periodYear,
            periodMonth: row.periodMonth,
            description: note,
            status: ApartmentDebtStatus.OPEN,
          },
        });

        const application = await tx.interestApplication.create({
          data: {
            tenantId,
            siteId,
            decisionId: decision.id,
            sourceDebtId: source.id,
            interestDebtId: interestDebt.id,
            periodYear: row.periodYear,
            periodMonth: row.periodMonth,
            principalBase: principal,
            monthlyRate: decision.monthlyRate,
            interestAmount,
            calculationNote: note,
            appliedByUserId: userId ?? null,
          },
        });

        results.push({ interestDebtId: interestDebt.id, applicationId: application.id });
      }

      return results;
    });

    const summary = summarizePreview(rows, formatTurkeyDateInput(turkeyTodayUtcMidnight()));
    return {
      createdCount: created.length,
      interestDebtIds: created.map((c) => c.interestDebtId),
      summary,
      message: summary.applyMessage,
    };
  },
};
