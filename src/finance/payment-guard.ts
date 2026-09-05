import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { formatPeriodLabel } from "../utils/dues-period";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import { planFifoAllocations, type OpenDebtForPlan } from "./allocation";
import {
  CONFIRMABLE_WARNING_CODES,
  FinanceIssueCode,
  FinanceIssueSeverity,
} from "./codes";
import {
  emptyFinanceCheck,
  finalizeFinanceCheck,
  type DebtBalanceSnapshot,
  type FinanceCheckResult,
  type FinanceIssue,
  type ProposedAllocationLine,
} from "./types";

export type PaymentGuardInput = {
  apartmentId: string;
  personId?: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: "CASH" | "BANK_TRANSFER" | "CREDIT_CARD" | "OTHER";
  referenceNo?: string;
  description?: string;
  /** Gönderilmezse FIFO plan otomatik üretilir. */
  allocations?: Array<{ apartmentDebtId: string; amount: number }>;
  bankTransactionId?: string;
  /** Preview sonrası kalan bakiyeler. */
  expectedRemainings?: DebtBalanceSnapshot[];
  confirmedWarningCodes?: string[];
};

function moneyTr(value: Prisma.Decimal | string | number): string {
  const n = Number(toMoneyString(value));
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

async function loadOpenDebts(
  tenantId: string,
  siteId: string,
  apartmentId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OpenDebtForPlan[]> {
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

async function findSuspectedDuplicates(
  tenantId: string,
  siteId: string,
  input: PaymentGuardInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<FinanceIssue[]> {
  const issues: FinanceIssue[] = [];
  const amount = new Prisma.Decimal(input.amount);
  const dayStart = new Date(
    Date.UTC(
      input.paymentDate.getUTCFullYear(),
      input.paymentDate.getUTCMonth(),
      input.paymentDate.getUTCDate(),
    ),
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  if (input.bankTransactionId) {
    const linked = await client.bankTransaction.findFirst({
      where: {
        id: input.bankTransactionId,
        tenantId,
        paymentId: { not: null },
        bankAccount: { siteId, deletedAt: null },
      },
      select: { id: true, paymentId: true },
    });
    if (linked?.paymentId) {
      issues.push({
        code: FinanceIssueCode.BANK_TX_ALREADY_PROCESSED,
        severity: FinanceIssueSeverity.BLOCK,
        title: "Banka hareketi işlenmiş",
        message: "Bu banka hareketi daha önce tahsilata aktarıldı.",
        bankTransactionId: linked.id,
        paymentId: linked.paymentId,
      });
    }
  }

  const sameDay = await client.payment.findMany({
    where: {
      tenantId,
      apartmentId: input.apartmentId,
      status: "COMPLETED",
      cancelledAt: null,
      amount,
      paymentDate: { gte: dayStart, lt: dayEnd },
      apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
    },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      referenceNo: true,
      description: true,
      bankTransaction: { select: { id: true, referenceNo: true } },
      allocations: {
        select: {
          amount: true,
          apartmentDebt: {
            select: { title: true, periodYear: true, periodMonth: true },
          },
        },
      },
    },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  for (const row of sameDay) {
    const sameReference =
      Boolean(input.referenceNo) &&
      Boolean(row.referenceNo) &&
      input.referenceNo!.trim().toLocaleLowerCase("tr") ===
        row.referenceNo!.trim().toLocaleLowerCase("tr");
    const sameMethod = row.paymentMethod === input.paymentMethod;
    const periodSummary = row.allocations
      .map((alloc) => {
        const debt = alloc.apartmentDebt;
        if (debt.periodYear != null && debt.periodMonth != null) {
          return formatPeriodLabel(debt.periodYear, debt.periodMonth);
        }
        return debt.title;
      })
      .join(", ");

    if (sameReference || (sameMethod && Boolean(row.bankTransaction))) {
      issues.push({
        code: FinanceIssueCode.DUPLICATE_PAYMENT_EXACT,
        severity: FinanceIssueSeverity.BLOCK,
        title: "Mükerrer tahsilat",
        message: `Aynı daire, tarih ve tutarda kayıtlı tahsilat bulundu${
          periodSummary ? ` (${periodSummary})` : ""
        }.`,
        paymentId: row.id,
        apartmentId: input.apartmentId,
        amount: toMoneyString(row.amount),
        details: {
          paymentDate: row.paymentDate.toISOString(),
          referenceNo: row.referenceNo,
          paymentMethod: row.paymentMethod,
          periods: periodSummary,
        },
      });
    } else {
      issues.push({
        code: FinanceIssueCode.DUPLICATE_PAYMENT_SUSPECTED,
        severity: FinanceIssueSeverity.WARNING,
        title: "Muhtemel mükerrer tahsilat",
        message:
          "Bu daire için aynı tarih ve tutarda başka bir tahsilat bulunuyor. Mevcut tahsilatı kontrol etmeden devam etmeyin.",
        paymentId: row.id,
        apartmentId: input.apartmentId,
        amount: toMoneyString(row.amount),
        details: {
          paymentDate: row.paymentDate.toISOString(),
          referenceNo: row.referenceNo,
          paymentMethod: row.paymentMethod,
          periods: periodSummary || null,
          source: row.bankTransaction ? "BANKA" : "MANUEL",
        },
      });
    }
  }

  return issues;
}

export async function evaluatePaymentCreate(
  tenantId: string,
  siteId: string,
  input: PaymentGuardInput,
  options?: { client?: Prisma.TransactionClient | typeof prisma },
): Promise<FinanceCheckResult> {
  const client = options?.client ?? prisma;
  const issues: FinanceIssue[] = [];
  const amount = new Prisma.Decimal(input.amount);

  if (!amount.isFinite() || amount.lte(0)) {
    issues.push({
      code: FinanceIssueCode.INVALID_AMOUNT,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Geçersiz tutar",
      message: "Tahsilat tutarı sıfır veya negatif olamaz.",
      amount: toMoneyString(amount),
    });
    return finalizeFinanceCheck({ ...emptyFinanceCheck(), issues });
  }

  const apartment = await client.apartment.findFirst({
    where: {
      id: input.apartmentId,
      tenantId,
      deletedAt: null,
      building: { siteId, deletedAt: null },
    },
    select: {
      id: true,
      isActive: true,
      number: true,
      building: { select: { name: true } },
    },
  });

  if (!apartment) {
    issues.push({
      code: FinanceIssueCode.APARTMENT_NOT_FOUND,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Daire bulunamadı",
      message: "Seçilen daire bu siteye ait değil veya silinmiş.",
      apartmentId: input.apartmentId,
    });
    return finalizeFinanceCheck({ ...emptyFinanceCheck(), issues });
  }

  if (!apartment.isActive) {
    issues.push({
      code: FinanceIssueCode.APARTMENT_INACTIVE,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Daire pasif",
      message: "Pasif daireye tahsilat kaydedilemez.",
      apartmentId: apartment.id,
    });
  }

  const openDebts = await loadOpenDebts(tenantId, siteId, input.apartmentId, client);
  const openTotal = openDebts.reduce(
    (sum, debt) => sum.add(debt.remainingAmount),
    new Prisma.Decimal(0),
  );
  const debtSnapshot: DebtBalanceSnapshot[] = openDebts.map((debt) => ({
    apartmentDebtId: debt.id,
    remainingAmount: toMoneyString(debt.remainingAmount),
  }));

  if (openDebts.length === 0) {
    issues.push({
      code: FinanceIssueCode.NO_OPEN_DEBT,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Açık borç yok",
      message: "Bu dairenin açık borcu bulunmuyor. Tahsilat kaydedilemez.",
      apartmentId: apartment.id,
    });
    return finalizeFinanceCheck({
      ...emptyFinanceCheck({
        apartmentLabel: `${apartment.building.name} · Daire ${apartment.number}`,
        openDebtTotal: "0.00",
      }),
      issues,
      debtSnapshot,
    });
  }

  if (amount.gt(openTotal)) {
    const excess = amount.sub(openTotal);
    issues.push({
      code: FinanceIssueCode.OVERPAYMENT_NO_CREDIT,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Tutar açık borcu aşıyor",
      message: `Ödeme tutarı dairenin açık borcundan ${moneyTr(excess)} ₺ fazla. Fazla tutar için avans bakiyesi desteklenmediğinden işlem kaydedilemez.`,
      apartmentId: apartment.id,
      amount: toMoneyString(excess),
    });
  }

  if (input.expectedRemainings?.length) {
    const byId = new Map(openDebts.map((debt) => [debt.id, debt]));
    for (const expected of input.expectedRemainings) {
      const current = byId.get(expected.apartmentDebtId);
      if (!current) {
        issues.push({
          code: FinanceIssueCode.BALANCE_CHANGED_SINCE_PREVIEW,
          severity: FinanceIssueSeverity.BLOCK,
          title: "Borç bakiyesi değişti",
          message: "Borç bakiyesi ön izlemeden sonra değişti. Dağıtımı yeniden kontrol edin.",
          debtId: expected.apartmentDebtId,
        });
        continue;
      }
      if (!current.remainingAmount.equals(new Prisma.Decimal(expected.remainingAmount))) {
        issues.push({
          code: FinanceIssueCode.BALANCE_CHANGED_SINCE_PREVIEW,
          severity: FinanceIssueSeverity.BLOCK,
          title: "Borç bakiyesi değişti",
          message: "Borç bakiyesi ön izlemeden sonra değişti. Dağıtımı yeniden kontrol edin.",
          debtId: current.id,
          amount: toMoneyString(current.remainingAmount),
        });
      }
    }
  }

  let proposedAllocation: ProposedAllocationLine[] = [];

  if (input.allocations && input.allocations.length > 0) {
    const allocationTotal = input.allocations.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.amount)),
      new Prisma.Decimal(0),
    );
    if (!allocationTotal.equals(amount)) {
      issues.push({
        code: FinanceIssueCode.ALLOCATION_SUM_MISMATCH,
        severity: FinanceIssueSeverity.BLOCK,
        title: "Dağıtım tutarı uyuşmuyor",
        message: "Dağıtım tutarları ödeme tutarına eşit olmalıdır.",
        amount: toMoneyString(allocationTotal),
      });
    }

    const unique = new Set(input.allocations.map((item) => item.apartmentDebtId));
    if (unique.size !== input.allocations.length) {
      issues.push({
        code: FinanceIssueCode.DEBT_ALLOCATION_OVERFLOW,
        severity: FinanceIssueSeverity.BLOCK,
        title: "Geçersiz dağıtım",
        message: "Aynı borç birden fazla kez dağıtılamaz.",
      });
    }

    const debtMap = new Map(openDebts.map((debt) => [debt.id, debt]));
    for (const line of input.allocations) {
      const debt = debtMap.get(line.apartmentDebtId);
      const allocAmount = new Prisma.Decimal(line.amount);
      if (!debt) {
        // Maybe PAID already
        const paid = await client.apartmentDebt.findFirst({
          where: {
            id: line.apartmentDebtId,
            tenantId,
            apartmentId: input.apartmentId,
          },
          select: {
            id: true,
            status: true,
            title: true,
            periodYear: true,
            periodMonth: true,
            remainingAmount: true,
          },
        });
        if (paid?.status === "PAID" || (paid && paid.remainingAmount.lte(0))) {
          issues.push({
            code: FinanceIssueCode.DEBT_ALREADY_PAID,
            severity: FinanceIssueSeverity.BLOCK,
            title: "Borç tamamen ödenmiş",
            message: `${paid.title} tamamen ödenmiş.`,
            debtId: paid.id,
            period:
              paid.periodYear != null && paid.periodMonth != null
                ? formatPeriodLabel(paid.periodYear, paid.periodMonth)
                : null,
            amount: "0.00",
          });
        } else {
          issues.push({
            code: FinanceIssueCode.DEBT_NOT_OPEN,
            severity: FinanceIssueSeverity.BLOCK,
            title: "Borç açık değil",
            message: "Dağıtım yalnızca aynı dairenin açık borçlarına yapılabilir.",
            debtId: line.apartmentDebtId,
          });
        }
        continue;
      }

      if (allocAmount.gt(debt.remainingAmount)) {
        issues.push({
          code: FinanceIssueCode.DEBT_ALLOCATION_OVERFLOW,
          severity: FinanceIssueSeverity.BLOCK,
          title: "Borç bakiyesi aşıldı",
          message: `${debt.title} için dağıtım tutarı kalan bakiyeyi aşıyor.`,
          debtId: debt.id,
          period:
            debt.periodYear != null && debt.periodMonth != null
              ? formatPeriodLabel(debt.periodYear, debt.periodMonth)
              : null,
          amount: toMoneyString(allocAmount),
        });
      }

      const after = debt.remainingAmount.sub(allocAmount);
      proposedAllocation.push({
        apartmentDebtId: debt.id,
        title: debt.title,
        periodYear: debt.periodYear,
        periodMonth: debt.periodMonth,
        periodLabel:
          debt.periodYear != null && debt.periodMonth != null
            ? formatPeriodLabel(debt.periodYear, debt.periodMonth)
            : null,
        amount: toMoneyString(allocAmount),
        remainingBefore: toMoneyString(debt.remainingAmount),
        remainingAfter: toMoneyString(after.lt(0) ? 0 : after),
      });
    }
  } else {
    const plan = planFifoAllocations(amount, openDebts);
    proposedAllocation = plan.lines;
    if (plan.remainder.gt(0) && amount.lte(openTotal)) {
      // Should not happen if amount <= openTotal
    }
  }

  if (proposedAllocation.length > 1) {
    issues.push({
      code: FinanceIssueCode.MULTI_PERIOD_ALLOCATION,
      severity: FinanceIssueSeverity.INFO,
      title: "Birden fazla borca dağıtım",
      message: `${moneyTr(amount)} ₺ ödeme en eski açık borçlardan başlanarak ${proposedAllocation.length} döneme dağıtılacaktır.`,
      amount: toMoneyString(amount),
      details: {
        periods: proposedAllocation.map((line) => ({
          title: line.title,
          periodLabel: line.periodLabel,
          amount: line.amount,
        })),
      },
    });
  }

  const duplicateIssues = await findSuspectedDuplicates(tenantId, siteId, input, client);
  issues.push(...duplicateIssues);

  const confirmed = new Set(input.confirmedWarningCodes ?? []);
  const unresolvedWarnings = issues.filter(
    (issue) =>
      issue.severity === "WARNING" &&
      CONFIRMABLE_WARNING_CODES.has(issue.code) &&
      !confirmed.has(issue.code),
  );

  // Confirmed codes that are not confirmable are ignored; BLOCK never cleared.
  const filteredIssues = issues.filter((issue) => {
    if (issue.severity !== "WARNING") return true;
    if (!CONFIRMABLE_WARNING_CODES.has(issue.code)) return true;
    return !confirmed.has(issue.code);
  });

  // Keep INFO about confirmation still needed in summary
  void unresolvedWarnings;

  return finalizeFinanceCheck({
    allowed: true,
    requiresConfirmation: false,
    issues: filteredIssues,
    summary: {
      apartmentLabel: `${apartment.building.name} · Daire ${apartment.number}`,
      openDebtTotal: toMoneyString(openTotal),
      paymentAmount: toMoneyString(amount),
      allocationCount: proposedAllocation.length,
      debtsFullyCovered: proposedAllocation.filter((line) => line.remainingAfter === "0.00").length,
    },
    proposedAllocation,
    debtSnapshot,
  });
}

export function assertPaymentCheckAllowed(
  check: FinanceCheckResult,
  confirmedWarningCodes?: string[],
): void {
  const confirmed = new Set(confirmedWarningCodes ?? []);
  const blocks = check.issues.filter((issue) => issue.severity === "BLOCK");
  if (blocks.length > 0) {
    throw new HttpError(
      400,
      blocks[0]!.message,
      blocks[0]!.code,
      { check },
    );
  }

  const warnings = check.issues.filter(
    (issue) =>
      issue.severity === "WARNING" &&
      CONFIRMABLE_WARNING_CODES.has(issue.code) &&
      !confirmed.has(issue.code),
  );
  if (warnings.length > 0) {
    throw new HttpError(
      409,
      warnings[0]!.message,
      "FINANCE_CHECK_REQUIRES_CONFIRMATION",
      { check },
    );
  }
}

export async function evaluatePaymentCancel(
  tenantId: string,
  siteId: string,
  paymentId: string,
): Promise<FinanceCheckResult> {
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      tenantId,
      apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
    },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      status: true,
      referenceNo: true,
      paymentMethod: true,
      apartment: {
        select: {
          id: true,
          number: true,
          building: { select: { name: true } },
          relations: {
            where: { isActive: true, endDate: null },
            select: {
              relationType: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      person: { select: { firstName: true, lastName: true } },
      bankTransaction: { select: { id: true, matchStatus: true } },
      allocations: {
        select: {
          amount: true,
          apartmentDebt: {
            select: {
              id: true,
              title: true,
              status: true,
              remainingAmount: true,
              originalAmount: true,
              periodYear: true,
              periodMonth: true,
            },
          },
        },
      },
    },
  });

  const issues: FinanceIssue[] = [];
  if (!payment) {
    issues.push({
      code: FinanceIssueCode.PAYMENT_NOT_FOUND,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Tahsilat bulunamadı",
      message: "Tahsilat bulunamadı.",
      paymentId,
    });
    return finalizeFinanceCheck({ ...emptyFinanceCheck(), issues });
  }

  if (payment.status === "CANCELLED") {
    issues.push({
      code: FinanceIssueCode.PAYMENT_ALREADY_CANCELLED,
      severity: FinanceIssueSeverity.BLOCK,
      title: "Zaten iptal edilmiş",
      message: "Tahsilat zaten iptal edilmiş.",
      paymentId: payment.id,
    });
  }

  const reopenLines = payment.allocations.map((alloc) => {
    const debt = alloc.apartmentDebt;
    const nextRemaining = debt.remainingAmount.add(alloc.amount);
    const capped = nextRemaining.gt(debt.originalAmount) ? debt.originalAmount : nextRemaining;
    return {
      debtId: debt.id,
      title: debt.title,
      periodLabel:
        debt.periodYear != null && debt.periodMonth != null
          ? formatPeriodLabel(debt.periodYear, debt.periodMonth)
          : null,
      restoredAmount: toMoneyString(alloc.amount),
      remainingAfterCancel: toMoneyString(capped),
      willReopen: capped.gt(0),
    };
  });

  const openDebtIncrease = payment.allocations.reduce(
    (sum, alloc) => sum.add(alloc.amount),
    new Prisma.Decimal(0),
  );

  issues.push({
    code: FinanceIssueCode.CANCEL_IMPACT,
    severity: FinanceIssueSeverity.INFO,
    title: "İptal etkisi",
    message: `Bu tahsilat iptal edilirse dairenin açık borcu ${moneyTr(openDebtIncrease)} ₺ artacaktır.`,
    paymentId: payment.id,
    amount: toMoneyString(openDebtIncrease),
    details: { reopenLines },
  });

  const residents = payment.apartment.relations
    .map((relation) => {
      const role = relation.relationType === "OWNER" ? "Malik" : "Kiracı";
      return `${relation.person.firstName} ${relation.person.lastName}`.trim() + ` · ${role}`;
    })
    .join(" · ");

  return finalizeFinanceCheck({
    allowed: true,
    requiresConfirmation: false,
    issues,
    summary: {
      paymentAmount: toMoneyString(payment.amount),
      paymentDate: payment.paymentDate.toISOString(),
      paymentMethod: payment.paymentMethod,
      referenceNo: payment.referenceNo,
      apartmentLabel: `${payment.apartment.building.name} · Daire ${payment.apartment.number}`,
      residentSummary: residents || null,
      payerName: payment.person
        ? `${payment.person.firstName} ${payment.person.lastName}`.trim()
        : null,
      bankTransactionId: payment.bankTransaction?.id ?? null,
      reopenLines,
      openDebtIncrease: toMoneyString(openDebtIncrease),
    },
    proposedAllocation: [],
    debtSnapshot: [],
  });
}
