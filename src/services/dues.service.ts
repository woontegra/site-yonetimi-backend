import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite } from "../utils/siteScope";
import {
  computeDueDate,
  expandCustomMonths,
  expandFullYear,
  expandPeriodRange,
  formatDueDateInput,
  formatPeriodLabel,
  suggestedPeriodName,
  type PeriodRef,
} from "../utils/dues-period";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import {
  exemptionReasonLabel,
  findActiveExemptionsForPeriod,
  resolveChargeAmount,
  type ActiveExemptionRow,
} from "./dues-exemption-helpers";
import { loadAssessmentSafety, loadAssessmentSafetyMap } from "./dues-assessment-safety";
import { writeTenantAudit } from "./tenant-audit.service";
import type {
  CreateDuesDefinitionInput,
  ListDuesDefinitionsQuery,
  MultiPeriodAssessmentInput,
  UpdateDuesDefinitionInput,
} from "../validators/dues.validators";

const duesSelect = {
  id: true,
  name: true,
  amount: true,
  periodYear: true,
  periodMonth: true,
  dueDate: true,
  description: true,
  isActive: true,
  assessmentBatchId: true,
  createdAt: true,
  updatedAt: true,
  building: {
    select: { id: true, name: true },
  },
  _count: {
    select: {
      debts: true,
    },
  },
} as const;

const PERIOD_MONTH_LABELS = [
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

function formatDuesPeriod(year: number, month: number): string {
  const label = PERIOD_MONTH_LABELS[month - 1] ?? String(month);
  return `${label} ${year}`;
}

function mapDues(row: {
  id: string;
  name: string;
  amount: Prisma.Decimal;
  periodYear: number;
  periodMonth: number;
  dueDate: Date;
  description: string | null;
  isActive: boolean;
  assessmentBatchId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  building: { id: string; name: string };
  _count: { debts: number };
}) {
  return {
    id: row.id,
    name: row.name,
    amount: toMoneyString(row.amount),
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    dueDate: row.dueDate,
    description: row.description,
    isActive: row.isActive,
    assessmentBatchId: row.assessmentBatchId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    building: row.building,
    chargedApartmentCount: row._count.debts,
  };
}

export class DuesDefinitionService {
  async list(tenantId: string, siteId: string, query: ListDuesDefinitionsQuery) {
    const where: Prisma.DuesDefinitionWhereInput = {
      tenantId,
      deletedAt: null,
      building: { siteId, deletedAt: null },
    };

    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.periodYear) where.periodYear = query.periodYear;
    if (query.periodMonth) where.periodMonth = query.periodMonth;
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { building: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.duesDefinition.findMany({
        where,
        select: duesSelect,
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.duesDefinition.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const aggregates =
      ids.length === 0
        ? []
        : await prisma.apartmentDebt.groupBy({
            by: ["duesDefinitionId"],
            where: {
              tenantId,
              duesDefinitionId: { in: ids },
              status: { not: "CANCELLED" },
              building: { siteId, deletedAt: null },
            },
            _sum: { originalAmount: true, remainingAmount: true },
            _count: { _all: true },
          });

    const openCounts =
      ids.length === 0
        ? []
        : await prisma.apartmentDebt.groupBy({
            by: ["duesDefinitionId"],
            where: {
              tenantId,
              duesDefinitionId: { in: ids },
              status: "OPEN",
              building: { siteId, deletedAt: null },
            },
            _count: { _all: true },
          });

    const aggregateMap = new Map(
      aggregates.map((item) => [
        item.duesDefinitionId,
        {
          totalOriginalAmount: toMoneyString(item._sum.originalAmount ?? 0),
          totalRemainingAmount: toMoneyString(item._sum.remainingAmount ?? 0),
        },
      ]),
    );
    const openMap = new Map(openCounts.map((item) => [item.duesDefinitionId, item._count._all]));

    const safetyMap = await loadAssessmentSafetyMap(tenantId, siteId, ids);

    return {
      items: rows.map((row) => {
        const mapped = mapDues(row);
        const agg = aggregateMap.get(row.id);
        const safety = safetyMap.get(row.id);
        return {
          ...mapped,
          chargedOpenCount: openMap.get(row.id) ?? 0,
          totalOriginalAmount: agg?.totalOriginalAmount ?? "0.00",
          totalRemainingAmount: agg?.totalRemainingAmount ?? "0.00",
          hasCollections: safety?.hasCollections ?? false,
          canHardDelete: safety?.canHardDelete ?? true,
          canSafeCancel: safety?.canSafeCancel ?? false,
          canChargeMore: safety?.canChargeMore ?? true,
          financialFieldsLocked: safety?.financialFieldsLocked ?? false,
          collectedAmount: safety?.collectedAmount ?? "0.00",
        };
      }),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.duesDefinition.findFirst({
      where: { id, tenantId, deletedAt: null, building: { siteId, deletedAt: null } },
      select: duesSelect,
    });

    if (!row) {
      throw new HttpError(404, "Aidat tanımı bulunamadı.");
    }

    const aggregates = await prisma.apartmentDebt.aggregate({
      where: {
        tenantId,
        duesDefinitionId: id,
        status: { not: "CANCELLED" },
        building: { siteId, deletedAt: null },
      },
      _sum: { originalAmount: true, remainingAmount: true },
      _count: true,
    });

    const activeApartmentCount = await prisma.apartment.count({
      where: {
        tenantId,
        buildingId: row.building.id,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
    });

    const openCount = await prisma.apartmentDebt.count({
      where: {
        tenantId,
        duesDefinitionId: id,
        status: "OPEN",
        building: { siteId, deletedAt: null },
      },
    });

    return {
      ...mapDues(row),
      activeApartmentCount,
      chargedOpenCount: openCount,
      totalOriginalAmount: toMoneyString(aggregates._sum.originalAmount ?? 0),
      totalRemainingAmount: toMoneyString(aggregates._sum.remainingAmount ?? 0),
      ...(await loadAssessmentSafety(tenantId, siteId, id, activeApartmentCount)),
    };
  }

  async create(tenantId: string, siteId: string, input: CreateDuesDefinitionInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);

    if (!input.chargeImmediately) {
      await this.assertNoActivePeriodAssessment(
        tenantId,
        siteId,
        input.buildingId,
        input.periodYear,
        input.periodMonth,
      );
      const created = await prisma.duesDefinition.create({
        data: {
          tenantId,
          buildingId: input.buildingId,
          name: input.name,
          amount: new Prisma.Decimal(input.amount),
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          dueDate: input.dueDate,
          description: input.description,
        },
        select: duesSelect,
      });
      return { dues: mapDues(created), createdCount: 0, totalAmount: toMoneyString(0) };
    }

    await this.assertNoActivePeriodAssessment(
      tenantId,
      siteId,
      input.buildingId,
      input.periodYear,
      input.periodMonth,
    );

    const planOutside = await this.buildChargePlan({
      tenantId,
      siteId,
      buildingId: input.buildingId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: new Prisma.Decimal(input.amount),
    });

    if (planOutside.apartments.length === 0) {
      throw new HttpError(409, "Bu binada borçlandırılabilecek aktif daire bulunmuyor.");
    }
    if (planOutside.toCharge.length === 0) {
      throw new HttpError(
        409,
        "Seçilen dönemde borçlandırılacak daire kalmadı (muafiyet veya mevcut borç).",
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        await this.advisoryPeriodLock(
          tx,
          tenantId,
          input.buildingId,
          input.periodYear,
          input.periodMonth,
        );
        await this.assertNoActivePeriodAssessment(
          tenantId,
          siteId,
          input.buildingId,
          input.periodYear,
          input.periodMonth,
          undefined,
          tx,
        );

        const blocked = await tx.apartmentDebt.findMany({
          where: {
            tenantId,
            apartmentId: { in: planOutside.toCharge.map((item) => item.apartmentId) },
            type: "DUES",
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            status: { in: ["OPEN", "PAID"] },
          },
          select: { apartmentId: true },
        });
        const blockedSet = new Set(blocked.map((row) => row.apartmentId));
        const toCharge = planOutside.toCharge.filter((item) => !blockedSet.has(item.apartmentId));
        if (toCharge.length === 0) {
          throw new HttpError(
            409,
            "Seçilen dönemde borçlandırılacak daire kalmadı (muafiyet veya mevcut borç).",
          );
        }

        const created = await tx.duesDefinition.create({
          data: {
            tenantId,
            buildingId: input.buildingId,
            name: input.name,
            amount: planOutside.baseAmount,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            dueDate: input.dueDate,
            description: input.description,
          },
          select: { id: true },
        });

        await tx.apartmentDebt.createMany({
          data: toCharge.map((item) => ({
            tenantId,
            buildingId: item.buildingId,
            apartmentId: item.apartmentId,
            duesDefinitionId: created.id,
            type: "DUES" as const,
            title: input.name,
            originalAmount: item.amount,
            remainingAmount: item.amount,
            dueDate: input.dueDate,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            description: input.description,
            status: "OPEN" as const,
          })),
        });

        const totalChargeAmount = toCharge.reduce(
          (sum, item) => sum.plus(item.amount),
          new Prisma.Decimal(0),
        );

        return {
          id: created.id,
          createdCount: toCharge.length,
          totalChargeAmount,
          exemptCount: planOutside.exempt.length,
          discountedCount: planOutside.discounted.length,
        };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    const dues = await this.getById(tenantId, siteId, result.id);
    return {
      dues,
      createdCount: result.createdCount,
      totalAmount: toMoneyString(result.totalChargeAmount),
      exemptCount: result.exemptCount,
      discountedCount: result.discountedCount,
    };
  }

  private resolveAssessmentPeriods(input: MultiPeriodAssessmentInput): PeriodRef[] {
    try {
      if (input.mode === "SINGLE") {
        return [{ periodYear: input.periodYear!, periodMonth: input.periodMonth! }];
      }
      if (input.mode === "RANGE") {
        return expandPeriodRange(
          input.startYear!,
          input.startMonth!,
          input.endYear!,
          input.endMonth!,
        );
      }
      if (input.mode === "YEAR") {
        return expandFullYear(input.year!);
      }
      return expandCustomMonths(input.year!, input.months ?? []);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Dönem seçimi geçersiz.");
    }
  }

  async previewMultiPeriodAssessment(
    tenantId: string,
    siteId: string,
    input: MultiPeriodAssessmentInput,
  ) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    const periods = this.resolveAssessmentPeriods(input);
    const amount = new Prisma.Decimal(input.amount);

    const existing = await prisma.duesDefinition.findMany({
      where: {
        tenantId,
        buildingId: input.buildingId,
        deletedAt: null,
        OR: periods.map((p) => ({ periodYear: p.periodYear, periodMonth: p.periodMonth })),
      },
      select: { id: true, name: true, periodYear: true, periodMonth: true },
    });
    const existingMap = new Map(
      existing.map((row) => [`${row.periodYear}-${row.periodMonth}`, row]),
    );

    const periodRows: Array<{
      periodYear: number;
      periodMonth: number;
      periodLabel: string;
      name: string;
      dueDate: string;
      status: "EXISTS" | "CREATE";
      existingDuesId: string | null;
      existingDuesName: string | null;
      activeApartmentCount: number;
      normalChargeCount: number;
      exemptCount: number;
      discountedCount: number;
      pendingChargeCount: number;
      totalChargeAmount: string;
      exemptApartments: ReturnType<DuesDefinitionService["mapChargePlanSummary"]>["exemptApartments"];
    }> = [];
    let createPeriodCount = 0;
    let skipPeriodCount = 0;
    let totalDebts = 0;
    let totalExemptRows = 0;
    let totalCharge = new Prisma.Decimal(0);

    for (const period of periods) {
      const key = `${period.periodYear}-${period.periodMonth}`;
      const conflict = existingMap.get(key);
      const dueDate = computeDueDate(period.periodYear, period.periodMonth, input.dueDay);
      const name = suggestedPeriodName(period.periodYear, period.periodMonth);

      if (conflict) {
        skipPeriodCount += 1;
        periodRows.push({
          periodYear: period.periodYear,
          periodMonth: period.periodMonth,
          periodLabel: formatPeriodLabel(period.periodYear, period.periodMonth),
          name,
          dueDate: formatDueDateInput(dueDate),
          status: "EXISTS" as const,
          existingDuesId: conflict.id,
          existingDuesName: conflict.name,
          activeApartmentCount: 0,
          normalChargeCount: 0,
          exemptCount: 0,
          discountedCount: 0,
          pendingChargeCount: 0,
          totalChargeAmount: "0.00",
          exemptApartments: [] as ReturnType<DuesDefinitionService["mapChargePlanSummary"]>["exemptApartments"],
        });
        continue;
      }

      const plan = await this.buildChargePlan({
        tenantId,
        siteId,
        buildingId: input.buildingId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        amount,
      });
      const summary = this.mapChargePlanSummary(plan);
      createPeriodCount += 1;
      totalDebts += summary.pendingChargeCount;
      totalExemptRows += summary.exemptCount;
      totalCharge = totalCharge.plus(plan.totalChargeAmount);

      periodRows.push({
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodLabel: formatPeriodLabel(period.periodYear, period.periodMonth),
        name,
        dueDate: formatDueDateInput(dueDate),
        status: "CREATE" as const,
        existingDuesId: null,
        existingDuesName: null,
        ...summary,
      });
    }

    return {
      buildingId: input.buildingId,
      amountPerApartment: toMoneyString(amount),
      dueDay: input.dueDay,
      conflictPolicy: input.conflictPolicy,
      periodCount: periods.length,
      createPeriodCount,
      skipPeriodCount,
      totalDebtCount: totalDebts,
      totalExemptRows,
      totalChargeAmount: toMoneyString(totalCharge),
      periods: periodRows,
      canCreate: createPeriodCount > 0 && (skipPeriodCount === 0 || input.conflictPolicy === "SKIP"),
      requiresConflictChoice: skipPeriodCount > 0 && createPeriodCount > 0,
      blockedByConflicts: skipPeriodCount > 0 && createPeriodCount === 0,
      check: {
        allowed: createPeriodCount > 0,
        requiresConfirmation: false,
        issues: [
          ...(createPeriodCount === 0
            ? [
                {
                  code: "DUES_ALL_PERIODS_EXIST" as const,
                  severity: "BLOCK" as const,
                  title: "Yeni borç yok",
                  message:
                    "Seçilen dönem ve dairelerin tamamı daha önce borçlandırılmış. Oluşturulacak yeni borç bulunmuyor.",
                },
              ]
            : []),
          ...(skipPeriodCount > 0 && createPeriodCount > 0
            ? [
                {
                  code: "DUES_PERIOD_CONFLICT" as const,
                  severity: "INFO" as const,
                  title: "Mevcut dönemler korunacak",
                  message: `Seçilen dönemlerin ${skipPeriodCount}'ü daha önce borçlandırılmış. Mevcut kayıtlar korunacak, yalnız eksik ${createPeriodCount} dönem oluşturulacaktır.`,
                },
              ]
            : []),
        ],
        summary: {
          periodCount: periods.length,
          createPeriodCount,
          skipPeriodCount,
          totalDebtCount: totalDebts,
          totalChargeAmount: toMoneyString(totalCharge),
        },
        proposedAllocation: [],
        debtSnapshot: [],
      },
    };
  }

  async createMultiPeriodAssessment(
    tenantId: string,
    siteId: string,
    input: MultiPeriodAssessmentInput,
    actorUserId: string,
  ) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);

    const periods = this.resolveAssessmentPeriods(input);
    const amount = new Prisma.Decimal(input.amount);
    const batchId = input.assessmentBatchId ?? randomUUID();

    const existing = await prisma.duesDefinition.findMany({
      where: {
        tenantId,
        buildingId: input.buildingId,
        deletedAt: null,
        OR: periods.map((p) => ({ periodYear: p.periodYear, periodMonth: p.periodMonth })),
      },
      select: { id: true, name: true, periodYear: true, periodMonth: true },
    });
    const existingMap = new Map(
      existing.map((row) => [`${row.periodYear}-${row.periodMonth}`, row]),
    );

    const toCreate: Array<PeriodRef & { name: string; dueDate: Date }> = [];
    const skipped: Array<{ periodYear: number; periodMonth: number; existingDuesId: string }> = [];

    for (const period of periods) {
      const key = `${period.periodYear}-${period.periodMonth}`;
      const conflict = existingMap.get(key);
      if (conflict) {
        if (input.conflictPolicy === "ABORT") {
          throw new HttpError(
            409,
            `${suggestedPeriodName(period.periodYear, period.periodMonth)} dönemi zaten borçlandırılmış.`,
            "DUES_PERIOD_EXISTS",
            { existingDuesId: conflict.id, existingDuesName: conflict.name },
          );
        }
        skipped.push({
          periodYear: period.periodYear,
          periodMonth: period.periodMonth,
          existingDuesId: conflict.id,
        });
        continue;
      }
      toCreate.push({
        ...period,
        name: suggestedPeriodName(period.periodYear, period.periodMonth),
        dueDate: computeDueDate(period.periodYear, period.periodMonth, input.dueDay),
      });
    }

    if (toCreate.length === 0) {
      throw new HttpError(409, "Seçilen dönemlerin tümü zaten borçlandırılmış.");
    }

    // Precompute plans outside the write transaction (reads); re-validate inside.
    type ChargePlan = Awaited<ReturnType<DuesDefinitionService["buildChargePlan"]>>;
    const plans: Array<{ period: PeriodRef & { name: string; dueDate: Date }; plan: ChargePlan }> = [];
    for (const period of toCreate) {
      const plan = await this.buildChargePlan({
        tenantId,
        siteId,
        buildingId: input.buildingId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        amount,
      });
      if (plan.apartments.length === 0) {
        throw new HttpError(409, "Bu binada borçlandırılabilecek aktif daire bulunmuyor.");
      }
      plans.push({ period, plan });
    }

    const created = await prisma.$transaction(
      async (tx) => {
        // Idempotent replay: same batch already written
        const prior = await tx.duesDefinition.findMany({
          where: { tenantId, assessmentBatchId: batchId, deletedAt: null },
          select: duesSelect,
        });
        if (prior.length > 0) {
          return {
            replay: true as const,
            definitions: prior,
            createdDebtCount: prior.reduce((sum, row) => sum + row._count.debts, 0),
            totalAmount: new Prisma.Decimal(0),
          };
        }

        const definitions = [];
        let createdDebtCount = 0;
        let totalAmount = new Prisma.Decimal(0);

        for (const { period, plan } of plans) {
          await this.advisoryPeriodLock(
            tx,
            tenantId,
            input.buildingId,
            period.periodYear,
            period.periodMonth,
          );
          await this.assertNoActivePeriodAssessment(
            tenantId,
            siteId,
            input.buildingId,
            period.periodYear,
            period.periodMonth,
            undefined,
            tx,
          );

          const blocked = await tx.apartmentDebt.findMany({
            where: {
              tenantId,
              apartmentId: { in: plan.toCharge.map((item) => item.apartmentId) },
              type: "DUES",
              periodYear: period.periodYear,
              periodMonth: period.periodMonth,
              status: { in: ["OPEN", "PAID"] },
            },
            select: { apartmentId: true },
          });
          const blockedSet = new Set(blocked.map((row) => row.apartmentId));
          const toCharge = plan.toCharge.filter((item) => !blockedSet.has(item.apartmentId));

          const definition = await tx.duesDefinition.create({
            data: {
              tenantId,
              buildingId: input.buildingId,
              name: period.name,
              amount: plan.baseAmount,
              periodYear: period.periodYear,
              periodMonth: period.periodMonth,
              dueDate: period.dueDate,
              description: input.description,
              assessmentBatchId: batchId,
            },
            select: duesSelect,
          });

          if (toCharge.length > 0) {
            await tx.apartmentDebt.createMany({
              data: toCharge.map((item) => ({
                tenantId,
                buildingId: item.buildingId,
                apartmentId: item.apartmentId,
                duesDefinitionId: definition.id,
                type: "DUES" as const,
                title: period.name,
                originalAmount: item.amount,
                remainingAmount: item.amount,
                dueDate: period.dueDate,
                periodYear: period.periodYear,
                periodMonth: period.periodMonth,
                description: input.description,
                status: "OPEN" as const,
              })),
            });
          }

          createdDebtCount += toCharge.length;
          totalAmount = totalAmount.plus(
            toCharge.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)),
          );
          definitions.push({
            ...definition,
            _count: { debts: toCharge.length },
          });
        }

        return {
          replay: false as const,
          definitions,
          createdDebtCount,
          totalAmount,
        };
      },
      { maxWait: 20_000, timeout: 90_000 },
    );

    if (!created.replay) {
      await writeTenantAudit({
        tenantId,
        actorUserId,
        action: "dues.assessment.batch_created",
        targetType: "DuesDefinition",
        targetId: batchId,
        metadata: {
          assessmentBatchId: batchId,
          periodCount: created.definitions.length,
          createdDebtCount: created.createdDebtCount,
          skippedPeriodCount: skipped.length,
          amount: toMoneyString(amount),
        },
      });
    }

    return {
      assessmentBatchId: batchId,
      replay: created.replay,
      createdPeriodCount: created.definitions.length,
      createdDebtCount: created.createdDebtCount,
      skippedPeriodCount: skipped.length,
      skippedPeriods: skipped,
      totalAmount: toMoneyString(
        created.replay
          ? created.definitions.reduce(
              (sum, row) => sum.plus(row.amount.mul(row._count.debts)),
              new Prisma.Decimal(0),
            )
          : created.totalAmount,
      ),
      dues: created.definitions.map(mapDues),
    };
  }

  async getAssessmentBatch(tenantId: string, siteId: string, batchId: string) {
    const items = await prisma.duesDefinition.findMany({
      where: {
        tenantId,
        assessmentBatchId: batchId,
        deletedAt: null,
        building: { siteId, deletedAt: null },
      },
      select: duesSelect,
      orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
    });
    if (items.length === 0) throw new HttpError(404, "Toplu borçlandırma bulunamadı.");

    const safetyMap = await loadAssessmentSafetyMap(
      tenantId,
      siteId,
      items.map((item) => item.id),
    );
    const mapped = items.map((item) => {
      const base = mapDues(item);
      const safety = safetyMap.get(item.id);
      return {
        ...base,
        ...(safety ?? {}),
      };
    });
    const canHardDeleteAll = mapped.every((item) => item.canHardDelete);
    return {
      assessmentBatchId: batchId,
      periodCount: mapped.length,
      canHardDelete: canHardDeleteAll,
      blockedReason: canHardDeleteAll
        ? null
        : "Gruptaki en az bir döneme tahsilat uygulanmış; toplu silme yapılamaz.",
      items: mapped,
    };
  }

  async purgeAssessmentBatch(
    tenantId: string,
    siteId: string,
    batchId: string,
    actorUserId: string,
    confirmName: string,
  ) {
    const batch = await this.getAssessmentBatch(tenantId, siteId, batchId);
    const expected = `TOPLU-${batch.periodCount}`;
    if (confirmName.trim() !== expected && confirmName.trim() !== batchId) {
      throw new HttpError(
        400,
        `Onay için TOPLU-${batch.periodCount} veya batch kimliğini yazın.`,
      );
    }
    if (!batch.canHardDelete) {
      throw new HttpError(
        409,
        batch.blockedReason ?? "Toplu silme bu grup için güvenli değil.",
        "DUES_HAS_COLLECTIONS",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let deletedDebtCount = 0;
      let totalAmount = new Prisma.Decimal(0);
      for (const item of batch.items) {
        const debts = await tx.apartmentDebt.findMany({
          where: {
            tenantId,
            duesDefinitionId: item.id,
            building: { siteId, deletedAt: null },
          },
          select: { id: true, originalAmount: true, remainingAmount: true, status: true },
        });
        const debtIds = debts.map((d) => d.id);
        if (debtIds.length > 0) {
          const alloc = await tx.paymentAllocation.count({
            where: { tenantId, apartmentDebtId: { in: debtIds } },
          });
          if (alloc > 0) {
            throw new HttpError(409, "Bu gruba bağlı tahsilat dağılımı bulunduğu için silinemez.");
          }
          const unsafe = debts.some(
            (d) => d.status !== "OPEN" || !d.originalAmount.equals(d.remainingAmount),
          );
          if (unsafe) {
            throw new HttpError(409, "Ödenmiş veya kısmen ödenmiş borçlar bulunduğu için silinemez.");
          }
          await tx.apartmentDebt.deleteMany({
            where: { tenantId, id: { in: debtIds }, duesDefinitionId: item.id },
          });
          deletedDebtCount += debts.length;
          totalAmount = totalAmount.plus(
            debts.reduce((sum, d) => sum.plus(d.originalAmount), new Prisma.Decimal(0)),
          );
        }
        await tx.duesDefinition.deleteMany({
          where: { id: item.id, tenantId, assessmentBatchId: batchId, building: { siteId } },
        });
      }
      return { deletedDebtCount, totalAmount, deletedPeriodCount: batch.items.length };
    });

    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "dues.assessment.batch_deleted",
      targetType: "DuesDefinition",
      targetId: batchId,
      metadata: {
        assessmentBatchId: batchId,
        deletedPeriodCount: result.deletedPeriodCount,
        deletedDebtCount: result.deletedDebtCount,
      },
    });

    return {
      assessmentBatchId: batchId,
      deletedPeriodCount: result.deletedPeriodCount,
      deletedDebtCount: result.deletedDebtCount,
      totalAmount: toMoneyString(result.totalAmount),
    };
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateDuesDefinitionInput) {
    const current = await this.getById(tenantId, siteId, id);
    const safety = await loadAssessmentSafety(tenantId, siteId, id);

    if (safety.financialFieldsLocked) {
      const financialTouch =
        input.buildingId !== undefined ||
        input.amount !== undefined ||
        input.periodYear !== undefined ||
        input.periodMonth !== undefined ||
        input.dueDate !== undefined;
      if (financialTouch) {
        throw new HttpError(
          409,
          safety.hasCollections
            ? "Tahsilat almış aidatta dönem/tutar/kapsam değiştirilemez."
            : "Borçlandırılmış aidatta dönem/tutar/kapsam değiştirilemez. Silip yeniden oluşturun veya yalnızca açıklama güncelleyin.",
        );
      }
    }

    if (input.buildingId) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
      await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    }

    if (
      (input.buildingId || input.periodYear || input.periodMonth) &&
      !safety.financialFieldsLocked
    ) {
      await this.assertNoActivePeriodAssessment(
        tenantId,
        siteId,
        input.buildingId ?? current.building.id,
        input.periodYear ?? current.periodYear,
        input.periodMonth ?? current.periodMonth,
        id,
      );
    }

    await prisma.duesDefinition.updateMany({
      where: { id, tenantId, deletedAt: null, building: { siteId, deletedAt: null } },
      data: {
        ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.periodYear !== undefined ? { periodYear: input.periodYear } : {}),
        ...(input.periodMonth !== undefined ? { periodMonth: input.periodMonth } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return this.getById(tenantId, siteId, id);
  }

  /** Soft-archive: borçları silmez. */
  async remove(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);

    const result = await prisma.duesDefinition.updateMany({
      where: { id, tenantId, deletedAt: null, building: { siteId, deletedAt: null } },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Aidat tanımı bulunamadı.");
    }
  }

  async getPurgePreview(tenantId: string, siteId: string, id: string) {
    const dues = await this.getById(tenantId, siteId, id);
    const safety = await loadAssessmentSafety(tenantId, siteId, id, dues.activeApartmentCount);
    return {
      dues,
      ...safety,
      deletableDebtCount: safety.canHardDelete ? safety.debtCount : 0,
      totalOriginalAmount: dues.totalOriginalAmount ?? "0.00",
    };
  }

  /**
   * Tahsilatsız aidat tanımı + bağlı ödenmemiş borçları kalıcı siler.
   * confirmName aidat adıyla birebir eşleşmelidir.
   */
  async purgeUnpaid(
    tenantId: string,
    siteId: string,
    id: string,
    actorUserId: string,
    confirmName: string,
  ) {
    const dues = await this.getById(tenantId, siteId, id);
    if (confirmName.trim() !== dues.name) {
      throw new HttpError(400, "Onay için aidat adını birebir yazın.");
    }

    const safety = await loadAssessmentSafety(tenantId, siteId, id);
    if (!safety.canHardDelete) {
      throw new HttpError(
        409,
        safety.blockedReason ??
          "Bu aidat tahsilat içerdiği veya kısmen ödendiği için kalıcı silinemez.",
        "DUES_HAS_COLLECTIONS",
      );
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const debts = await tx.apartmentDebt.findMany({
        where: { tenantId, duesDefinitionId: id, building: { siteId, deletedAt: null } },
        select: { id: true, originalAmount: true, remainingAmount: true, status: true },
      });

      const debtIds = debts.map((d) => d.id);
      if (debtIds.length > 0) {
        const alloc = await tx.paymentAllocation.count({
          where: { tenantId, apartmentDebtId: { in: debtIds } },
        });
        if (alloc > 0) {
          throw new HttpError(409, "Bu aidata bağlı tahsilat dağılımı bulunduğu için silinemez.");
        }
        const unsafe = debts.some(
          (d) => d.status !== "OPEN" || !d.originalAmount.equals(d.remainingAmount),
        );
        if (unsafe) {
          throw new HttpError(409, "Ödenmiş veya kısmen ödenmiş borçlar bulunduğu için silinemez.");
        }

        await tx.apartmentDebt.deleteMany({
          where: { tenantId, id: { in: debtIds }, duesDefinitionId: id },
        });
      }

      const removed = await tx.duesDefinition.deleteMany({
        where: { id, tenantId, building: { siteId } },
      });
      if (removed.count === 0) {
        throw new HttpError(404, "Aidat tanımı bulunamadı.");
      }

      return {
        deletedDebtCount: debts.length,
        totalAmount: toMoneyString(
          debts.reduce((sum, d) => sum.plus(d.originalAmount), new Prisma.Decimal(0)),
        ),
      };
    });

    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "dues.assessment.deleted",
      targetType: "DuesDefinition",
      targetId: id,
      metadata: {
        periodYear: dues.periodYear,
        periodMonth: dues.periodMonth,
        buildingId: dues.building.id,
        buildingName: dues.building.name,
        deletedDebtCount: deleted.deletedDebtCount,
        totalAmount: deleted.totalAmount,
        name: dues.name,
      },
    });

    return deleted;
  }

  async getChargeScopePreview(
    tenantId: string,
    siteId: string,
    input: { buildingId: string; periodYear: number; periodMonth: number; amount: number },
  ) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    const plan = await this.buildChargePlan({
      tenantId,
      siteId,
      buildingId: input.buildingId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: new Prisma.Decimal(input.amount),
    });
    return this.mapChargePlanSummary(plan);
  }

  async getChargePreview(tenantId: string, siteId: string, id: string) {
    const dues = await this.getById(tenantId, siteId, id);
    const plan = await this.buildChargePlan({
      tenantId,
      siteId,
      buildingId: dues.building.id,
      periodYear: dues.periodYear,
      periodMonth: dues.periodMonth,
      amount: new Prisma.Decimal(dues.amount),
      duesDefinitionId: id,
    });

    return {
      dues,
      ...this.mapChargePlanSummary(plan),
    };
  }

  async chargeApartments(tenantId: string, siteId: string, id: string) {
    const dues = await this.getById(tenantId, siteId, id);
    const planOutside = await this.buildChargePlan({
      tenantId,
      siteId,
      buildingId: dues.building.id,
      periodYear: dues.periodYear,
      periodMonth: dues.periodMonth,
      amount: new Prisma.Decimal(dues.amount),
      duesDefinitionId: id,
    });

    if (planOutside.toCharge.length === 0) {
      const periodLabel = formatDuesPeriod(dues.periodYear, dues.periodMonth);
      if (planOutside.alreadyChargedCount > 0) {
        throw new HttpError(
          409,
          `${periodLabel} dönemi için seçilen dairelerden bazılarında aidat borcu zaten bulunuyor. Borçlandırılacak yeni daire kalmadı.`,
        );
      }
      if (planOutside.exempt.length > 0) {
        throw new HttpError(
          409,
          "Seçilen dönemde tüm aktif daireler muaf; oluşturulacak borç bulunmuyor.",
        );
      }
      throw new HttpError(409, "Bu aidat için borçlandırılacak aktif daire bulunmuyor.");
    }

    try {
      const created = await prisma.$transaction(
        async (tx) => {
          await this.advisoryPeriodLock(
            tx,
            tenantId,
            dues.building.id,
            dues.periodYear,
            dues.periodMonth,
          );

          const blocked = await tx.apartmentDebt.findMany({
            where: {
              tenantId,
              OR: [
                { duesDefinitionId: id },
                {
                  type: "DUES",
                  periodYear: dues.periodYear,
                  periodMonth: dues.periodMonth,
                  status: { in: ["OPEN", "PAID"] },
                },
              ],
              apartmentId: { in: planOutside.toCharge.map((item) => item.apartmentId) },
            },
            select: { apartmentId: true },
          });
          const blockedSet = new Set(blocked.map((row) => row.apartmentId));
          const toCharge = planOutside.toCharge.filter((item) => !blockedSet.has(item.apartmentId));
          if (toCharge.length === 0) {
            throw new HttpError(
              409,
              `${formatDuesPeriod(dues.periodYear, dues.periodMonth)} dönemi için borçlandırılacak yeni daire kalmadı.`,
            );
          }

          const data = toCharge.map((item) => ({
            tenantId,
            buildingId: item.buildingId,
            apartmentId: item.apartmentId,
            duesDefinitionId: id,
            type: "DUES" as const,
            title: dues.name,
            originalAmount: item.amount,
            remainingAmount: item.amount,
            dueDate: dues.dueDate,
            periodYear: dues.periodYear,
            periodMonth: dues.periodMonth,
            description: dues.description,
            status: "OPEN" as const,
          }));

          await tx.apartmentDebt.createMany({ data });
          const totalChargeAmount = toCharge.reduce(
            (sum, item) => sum.plus(item.amount),
            new Prisma.Decimal(0),
          );
          return {
            createdCount: data.length,
            totalAmount: toMoneyString(totalChargeAmount),
            exemptCount: planOutside.exempt.length,
            discountedCount: planOutside.discounted.length,
          };
        },
        { maxWait: 15_000, timeout: 30_000 },
      );

      return {
        ...created,
        dues: await this.getById(tenantId, siteId, id),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(
          409,
          `${formatDuesPeriod(dues.periodYear, dues.periodMonth)} dönemi için seçilen dairelerden bazılarında aidat borcu zaten bulunuyor.`,
        );
      }
      throw error;
    }
  }

  async cancelOpenDebts(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);
    const safety = await loadAssessmentSafety(tenantId, siteId, id);

    if (safety.hasCollections && !safety.canSafeCancel) {
      throw new HttpError(
        409,
        safety.blockedReason ??
          "Tahsilatlı borçlar bu akışla iptal edilemez. Önce bağlı tahsilatları inceleyin.",
        "DUES_HAS_COLLECTIONS",
      );
    }

    const debts = await prisma.apartmentDebt.findMany({
      where: {
        tenantId,
        duesDefinitionId: id,
        status: "OPEN",
        building: { siteId, deletedAt: null },
      },
      select: {
        id: true,
        originalAmount: true,
        remainingAmount: true,
        _count: { select: { allocations: true } },
      },
    });

    const cancellableIds = debts
      .filter((d) => d.originalAmount.equals(d.remainingAmount) && d._count.allocations === 0)
      .map((d) => d.id);

    if (cancellableIds.length === 0) {
      throw new HttpError(
        409,
        safety.hasCollections
          ? "Bu aidata tahsilat işlendiği için doğrudan silinemez. Önce bağlı tahsilatları inceleyin veya borçlandırmayı güvenli iptal akışıyla geri alın."
          : "İptal edilebilecek açık (ödemesiz) borç bulunmuyor.",
      );
    }

    const result = await prisma.apartmentDebt.updateMany({
      where: {
        tenantId,
        id: { in: cancellableIds },
        duesDefinitionId: id,
        status: "OPEN",
        building: { siteId, deletedAt: null },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return {
      cancelledCount: result.count,
      skippedDueToPayment: debts.length - cancellableIds.length,
      dues: await this.getById(tenantId, siteId, id),
    };
  }

  private async assertBuildingActive(tenantId: string, siteId: string, buildingId: string) {
    const building = await prisma.building.findFirst({
      where: { id: buildingId, tenantId, siteId, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (!building) {
      throw new HttpError(404, "Bina bulunamadı.");
    }
  }

  private async advisoryPeriodLock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    periodYear: number,
    periodMonth: number,
  ) {
    const key = `dues:${tenantId}:${buildingId}:${periodYear}:${periodMonth}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private async assertNoActivePeriodAssessment(
    tenantId: string,
    siteId: string,
    buildingId: string,
    periodYear: number,
    periodMonth: number,
    excludeId?: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const existing = await db.duesDefinition.findFirst({
      where: {
        tenantId,
        buildingId,
        periodYear,
        periodMonth,
        deletedAt: null,
        building: { siteId, deletedAt: null },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true, building: { select: { name: true } } },
    });

    if (existing) {
      const periodLabel = formatDuesPeriod(periodYear, periodMonth);
      throw new HttpError(
        409,
        `${existing.building.name} için ${periodLabel} dönemine ait aidat borçlandırması zaten bulunuyor.`,
        "DUES_PERIOD_EXISTS",
        { existingDuesId: existing.id, existingDuesName: existing.name },
      );
    }
  }

  private mapExemptItem(
    apartment: { id: string; number: string; buildingId: string; building: { name: string } },
    exemption: ActiveExemptionRow,
  ) {
    return {
      apartmentId: apartment.id,
      number: apartment.number,
      label: `${apartment.building.name} · Daire ${apartment.number}`,
      exemptionType: exemption.exemptionType,
      reason: exemption.reason,
      reasonLabel: exemptionReasonLabel(exemption.reason),
      startDate: exemption.startDate,
      endDate: exemption.endDate,
      note: exemption.note,
    };
  }

  private async buildChargePlan(input: {
    tenantId: string;
    siteId: string;
    buildingId: string;
    periodYear: number;
    periodMonth: number;
    amount: Prisma.Decimal;
    duesDefinitionId?: string;
    tx?: Prisma.TransactionClient;
  }) {
    const db = input.tx ?? prisma;
    const apartments = await db.apartment.findMany({
      where: {
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        deletedAt: null,
        isActive: true,
        building: { siteId: input.siteId, deletedAt: null },
      },
      select: {
        id: true,
        number: true,
        buildingId: true,
        building: { select: { name: true } },
      },
      orderBy: { number: "asc" },
    });

    const chargedSet = new Set<string>();
    if (apartments.length > 0) {
      if (input.duesDefinitionId) {
        const alreadyCharged = await db.apartmentDebt.findMany({
          where: {
            tenantId: input.tenantId,
            duesDefinitionId: input.duesDefinitionId,
            apartmentId: { in: apartments.map((item) => item.id) },
          },
          select: { apartmentId: true },
        });
        for (const row of alreadyCharged) chargedSet.add(row.apartmentId);
      }

      // Aynı daire + dönem için başka tanımdan kalan aktif DUES borçlarını da engelle
      const periodDebts = await db.apartmentDebt.findMany({
        where: {
          tenantId: input.tenantId,
          apartmentId: { in: apartments.map((item) => item.id) },
          type: "DUES",
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          status: { in: ["OPEN", "PAID"] },
          ...(input.duesDefinitionId
            ? { NOT: { duesDefinitionId: input.duesDefinitionId } }
            : {}),
        },
        select: { apartmentId: true },
      });
      for (const row of periodDebts) chargedSet.add(row.apartmentId);
    }

    // Exemption lookup uses global prisma; avoid nesting it inside a short interactive tx.
    const exemptions = await findActiveExemptionsForPeriod({
      tenantId: input.tenantId,
      siteId: input.siteId,
      apartmentIds: apartments.map((item) => item.id),
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
    });

    const toCharge: Array<{
      apartmentId: string;
      buildingId: string;
      number: string;
      amount: Prisma.Decimal;
      discounted: boolean;
    }> = [];
    const exempt: Array<ReturnType<DuesDefinitionService["mapExemptItem"]>> = [];
    const discounted: Array<
      ReturnType<DuesDefinitionService["mapExemptItem"]> & { amount: string }
    > = [];
    let normalChargeCount = 0;
    let totalChargeAmount = new Prisma.Decimal(0);

    for (const apartment of apartments) {
      if (chargedSet.has(apartment.id)) continue;
      const exemption = exemptions.get(apartment.id);
      const resolved = resolveChargeAmount(input.amount, exemption);
      if (resolved.skip && resolved.exemption) {
        exempt.push(this.mapExemptItem(apartment, resolved.exemption));
        continue;
      }
      toCharge.push({
        apartmentId: apartment.id,
        buildingId: apartment.buildingId,
        number: apartment.number,
        amount: resolved.amount,
        discounted: Boolean(resolved.exemption && resolved.exemption.exemptionType !== "FULL"),
      });
      totalChargeAmount = totalChargeAmount.plus(resolved.amount);
      if (resolved.exemption && resolved.exemption.exemptionType !== "FULL") {
        discounted.push({
          ...this.mapExemptItem(apartment, resolved.exemption),
          amount: toMoneyString(resolved.amount),
        });
      } else {
        normalChargeCount += 1;
      }
    }

    return {
      apartments,
      baseAmount: input.amount,
      toCharge,
      exempt,
      discounted,
      alreadyChargedCount: chargedSet.size,
      normalChargeCount,
      totalChargeAmount,
    };
  }

  private mapChargePlanSummary(
    plan: Awaited<ReturnType<DuesDefinitionService["buildChargePlan"]>>,
  ) {
    return {
      activeApartmentCount: plan.apartments.length,
      alreadyChargedCount: plan.alreadyChargedCount,
      pendingChargeCount: plan.toCharge.length,
      normalChargeCount: plan.normalChargeCount,
      exemptCount: plan.exempt.length,
      discountedCount: plan.discounted.length,
      amountPerApartment: toMoneyString(plan.baseAmount),
      totalChargeAmount: toMoneyString(plan.totalChargeAmount),
      exemptApartments: plan.exempt,
      discountedApartments: plan.discounted,
    };
  }
}

export const duesDefinitionService = new DuesDefinitionService();
