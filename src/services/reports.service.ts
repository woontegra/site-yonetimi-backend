import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { loadApartmentResidentSummaries } from "../utils/apartment-residents";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import {
  MAX_EXPORT_ROWS,
  normalizeReportDateRange,
  type ApartmentDebtsReportQuery,
  type ApartmentStatementReportQuery,
  type BankTransactionsReportQuery,
  type ExpensesReportQuery,
  type PaymentsReportQuery,
  type ReportCommonQuery,
} from "../validators/reports.validators";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi Kartı",
  OTHER: "Diğer",
};

function moneyNum(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  return Number(new Prisma.Decimal(value).toFixed(2));
}

function personFullName(person: { firstName: string; lastName: string } | null | undefined) {
  if (!person) return null;
  return `${person.firstName} ${person.lastName}`.trim();
}

function apartmentLabel(buildingName: string, number: string) {
  return `${buildingName} · Daire ${number}`;
}

function residentLines(summary: {
  activeOwners: Array<{ fullName: string }>;
  activeTenants: Array<{ fullName: string }>;
}) {
  const owner = summary.activeOwners[0]?.fullName ?? null;
  const tenant = summary.activeTenants[0]?.fullName ?? null;
  const primary = owner ?? tenant;
  return {
    ownerName: owner,
    tenantName: tenant,
    displayPerson: primary ?? "Kayıtlı kişi yok",
  };
}

async function siteMeta(tenantId: string, siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!site) throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
  return site;
}

function assertRowLimit(count: number) {
  if (count > MAX_EXPORT_ROWS) {
    throw new HttpError(
      400,
      `Rapor en fazla ${MAX_EXPORT_ROWS} satır dışa aktarabilir. Filtreyi daraltın.`,
    );
  }
}

function periodKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(key: string) {
  const [y, m] = key.split("-");
  const months = [
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
  ];
  return `${months[Number(m) - 1] ?? m} ${y}`;
}

export class ReportsService {
  async financialSummary(tenantId: string, siteId: string, query: ReportCommonQuery) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);

    const apartmentScope: Prisma.ApartmentWhereInput = {
      tenantId,
      deletedAt: null,
      building: {
        siteId,
        deletedAt: null,
        ...(query.buildingId ? { id: query.buildingId } : {}),
      },
      ...(query.apartmentId ? { id: query.apartmentId } : {}),
    };

    const debtCreatedWhere: Prisma.ApartmentDebtWhereInput = {
      tenantId,
      status: { not: "CANCELLED" },
      apartment: apartmentScope,
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const paymentWhere: Prisma.PaymentWhereInput = {
      tenantId,
      status: "COMPLETED",
      apartment: apartmentScope,
      ...(dateFrom || dateTo
        ? {
            paymentDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      tenantId,
      siteId,
      status: "COMPLETED",
      ...(query.buildingId ? { buildingId: query.buildingId } : {}),
      ...(dateFrom || dateTo
        ? {
            expenseDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const openDebtWhere: Prisma.ApartmentDebtWhereInput = {
      tenantId,
      status: "OPEN",
      apartment: apartmentScope,
    };

    const [accrualAgg, paymentAgg, expenseAgg, openDebtAgg, paymentsByMethod, debts, payments, expenses] =
      await Promise.all([
        prisma.apartmentDebt.aggregate({
          where: debtCreatedWhere,
          _sum: { originalAmount: true },
          _count: { _all: true },
        }),
        prisma.payment.aggregate({
          where: paymentWhere,
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.expense.aggregate({
          where: expenseWhere,
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.apartmentDebt.aggregate({
          where: openDebtWhere,
          _sum: { remainingAmount: true },
        }),
        prisma.payment.groupBy({
          by: ["paymentMethod"],
          where: paymentWhere,
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.apartmentDebt.findMany({
          where: debtCreatedWhere,
          select: { createdAt: true, originalAmount: true },
        }),
        prisma.payment.findMany({
          where: paymentWhere,
          select: { paymentDate: true, amount: true },
        }),
        prisma.expense.findMany({
          where: expenseWhere,
          select: { expenseDate: true, amount: true },
        }),
      ]);

    const accrualTotal = moneyNum(accrualAgg._sum.originalAmount);
    const collectionTotal = moneyNum(paymentAgg._sum.amount);
    const expenseTotal = moneyNum(expenseAgg._sum.amount);
    const openDebtTotal = moneyNum(openDebtAgg._sum.remainingAmount);
    const collectionRate = accrualTotal > 0 ? (collectionTotal / accrualTotal) * 100 : null;
    const collectionVsExpense = collectionTotal - expenseTotal;

    const monthlyMap = new Map<
      string,
      { accrual: number; collection: number; expense: number }
    >();
    for (const row of debts) {
      const key = periodKey(row.createdAt);
      const cur = monthlyMap.get(key) ?? { accrual: 0, collection: 0, expense: 0 };
      cur.accrual += moneyNum(row.originalAmount);
      monthlyMap.set(key, cur);
    }
    for (const row of payments) {
      const key = periodKey(row.paymentDate);
      const cur = monthlyMap.get(key) ?? { accrual: 0, collection: 0, expense: 0 };
      cur.collection += moneyNum(row.amount);
      monthlyMap.set(key, cur);
    }
    for (const row of expenses) {
      const key = periodKey(row.expenseDate);
      const cur = monthlyMap.get(key) ?? { accrual: 0, collection: 0, expense: 0 };
      cur.expense += moneyNum(row.amount);
      monthlyMap.set(key, cur);
    }

    const monthly = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => ({
        periodKey: key,
        periodLabel: periodLabel(key),
        accrual: toMoneyString(values.accrual),
        collection: toMoneyString(values.collection),
        expense: toMoneyString(values.expense),
        accrualNum: values.accrual,
        collectionNum: values.collection,
        expenseNum: values.expense,
      }));

    return {
      site,
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId ?? null,
        apartmentId: query.apartmentId ?? null,
      },
      definitions: {
        accrual: "İlgili dönemde oluşturulan borçların (tahakkuk) toplamı.",
        collection: "İlgili dönemde kaydedilmiş, iptal edilmemiş ödemelerin toplamı.",
        expense: "İlgili dönemde kaydedilmiş, iptal edilmemiş giderlerin toplamı.",
        openDebt: "Seçili site kapsamındaki halen ödenmemiş borç bakiyesi.",
      },
      summary: {
        accrualTotal: toMoneyString(accrualTotal),
        collectionTotal: toMoneyString(collectionTotal),
        expenseTotal: toMoneyString(expenseTotal),
        openDebtTotal: toMoneyString(openDebtTotal),
        collectionRate: collectionRate == null ? null : Number(collectionRate.toFixed(1)),
        collectionVsExpense: toMoneyString(collectionVsExpense),
        accrualCount: accrualAgg._count._all,
        collectionCount: paymentAgg._count._all,
        expenseCount: expenseAgg._count._all,
        accrualTotalNum: accrualTotal,
        collectionTotalNum: collectionTotal,
        expenseTotalNum: expenseTotal,
        openDebtTotalNum: openDebtTotal,
        collectionVsExpenseNum: collectionVsExpense,
      },
      paymentMethods: paymentsByMethod.map((row) => ({
        method: row.paymentMethod,
        methodLabel: PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
        amount: toMoneyString(row._sum.amount ?? 0),
        amountNum: moneyNum(row._sum.amount),
        count: row._count._all,
      })),
      monthly,
      generatedAt: new Date().toISOString(),
    };
  }

  async apartmentDebts(tenantId: string, siteId: string, query: ApartmentDebtsReportQuery) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);
    const now = new Date();

    const apartments = await prisma.apartment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        building: {
          siteId,
          deletedAt: null,
          ...(query.buildingId ? { id: query.buildingId } : {}),
        },
        ...(query.apartmentId ? { id: query.apartmentId } : {}),
      },
      select: {
        id: true,
        number: true,
        building: { select: { id: true, name: true } },
        debts: {
          where: {
            status: { not: "CANCELLED" },
            ...(dateFrom || dateTo
              ? {
                  OR: [
                    {
                      createdAt: {
                        ...(dateFrom ? { gte: dateFrom } : {}),
                        ...(dateTo ? { lte: dateTo } : {}),
                      },
                    },
                    {
                      dueDate: {
                        ...(dateFrom ? { gte: dateFrom } : {}),
                        ...(dateTo ? { lte: dateTo } : {}),
                      },
                    },
                    { status: "OPEN" },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            type: true,
            originalAmount: true,
            remainingAmount: true,
            dueDate: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ building: { name: "asc" } }, { number: "asc" }],
    });

    const residents = await loadApartmentResidentSummaries(
      tenantId,
      siteId,
      apartments.map((a) => a.id),
    );

    const rows = apartments.map((apt) => {
      const debts = apt.debts;
      const totalDebt = debts.reduce((s, d) => s + moneyNum(d.originalAmount), 0);
      const remaining = debts
        .filter((d) => d.status === "OPEN")
        .reduce((s, d) => s + moneyNum(d.remainingAmount), 0);
      const remainingPrincipal = debts
        .filter((d) => d.status === "OPEN" && d.type !== "INTEREST")
        .reduce((s, d) => s + moneyNum(d.remainingAmount), 0);
      const remainingInterest = debts
        .filter((d) => d.status === "OPEN" && d.type === "INTEREST")
        .reduce((s, d) => s + moneyNum(d.remainingAmount), 0);
      const paid = debts.reduce(
        (s, d) => s + (moneyNum(d.originalAmount) - moneyNum(d.remainingAmount)),
        0,
      );
      const overdue = debts
        .filter((d) => d.status === "OPEN" && d.dueDate < now)
        .reduce((s, d) => s + moneyNum(d.remainingAmount), 0);
      const openDebts = debts.filter((d) => d.status === "OPEN");
      const oldestOpen = openDebts
        .slice()
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      const people = residentLines(
        residents.get(apt.id) ?? { activeOwners: [], activeTenants: [] },
      );

      let statusLabel = "Kapalı";
      if (remaining > 0 && overdue > 0) statusLabel = "Gecikmiş";
      else if (remaining > 0) statusLabel = "Açık";

      return {
        apartmentId: apt.id,
        buildingId: apt.building.id,
        buildingName: apt.building.name,
        apartmentNumber: apt.number,
        apartmentLabel: apartmentLabel(apt.building.name, apt.number),
        ownerName: people.ownerName,
        tenantName: people.tenantName,
        displayPerson: people.displayPerson,
        totalDebt: toMoneyString(totalDebt),
        paid: toMoneyString(paid),
        remaining: toMoneyString(remaining),
        remainingPrincipal: toMoneyString(remainingPrincipal),
        remainingInterest: toMoneyString(remainingInterest),
        overdue: toMoneyString(overdue),
        oldestOpenDueDate: oldestOpen?.dueDate.toISOString() ?? null,
        statusLabel,
        totalDebtNum: totalDebt,
        paidNum: paid,
        remainingNum: remaining,
        remainingPrincipalNum: remainingPrincipal,
        remainingInterestNum: remainingInterest,
        overdueNum: overdue,
      };
    });

    const filtered = rows.filter((row) => {
      if (query.debtFilter === "with_debt") return row.remainingNum > 0;
      if (query.debtFilter === "overdue") return row.overdueNum > 0;
      if (query.debtFilter === "closed") return row.remainingNum <= 0;
      return true;
    });

    assertRowLimit(filtered.length);

    const summary = {
      indebtedApartmentCount: filtered.filter((r) => r.remainingNum > 0).length,
      openDebtTotal: toMoneyString(filtered.reduce((s, r) => s + r.remainingNum, 0)),
      openPrincipalTotal: toMoneyString(filtered.reduce((s, r) => s + r.remainingPrincipalNum, 0)),
      openInterestTotal: toMoneyString(filtered.reduce((s, r) => s + r.remainingInterestNum, 0)),
      overdueTotal: toMoneyString(filtered.reduce((s, r) => s + r.overdueNum, 0)),
      collectedTotal: toMoneyString(filtered.reduce((s, r) => s + r.paidNum, 0)),
      openDebtTotalNum: filtered.reduce((s, r) => s + r.remainingNum, 0),
      overdueTotalNum: filtered.reduce((s, r) => s + r.overdueNum, 0),
      collectedTotalNum: filtered.reduce((s, r) => s + r.paidNum, 0),
    };

    return {
      site,
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId ?? null,
        apartmentId: query.apartmentId ?? null,
        debtFilter: query.debtFilter,
      },
      summary,
      items: filtered,
      generatedAt: new Date().toISOString(),
    };
  }

  async payments(tenantId: string, siteId: string, query: PaymentsReportQuery) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);
    const includeCancelled = Boolean(query.includeCancelled);

    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(includeCancelled ? {} : { status: "COMPLETED" }),
      apartment: {
        deletedAt: null,
        building: {
          siteId,
          deletedAt: null,
          ...(query.buildingId ? { id: query.buildingId } : {}),
        },
        ...(query.apartmentId ? { id: query.apartmentId } : {}),
      },
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(dateFrom || dateTo
        ? {
            paymentDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const count = await prisma.payment.count({ where });
    assertRowLimit(count);

    const rows = await prisma.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        paymentMethod: true,
        description: true,
        referenceNo: true,
        status: true,
        apartment: {
          select: {
            id: true,
            number: true,
            building: { select: { id: true, name: true } },
          },
        },
        person: { select: { id: true, firstName: true, lastName: true } },
        bankTransaction: { select: { id: true } },
        allocations: {
          select: {
            id: true,
            amount: true,
            apartmentDebt: {
              select: {
                id: true,
                title: true,
                dueDate: true,
                periodYear: true,
                periodMonth: true,
                type: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const residents = await loadApartmentResidentSummaries(
      tenantId,
      siteId,
      rows.map((r) => r.apartment.id),
    );

    const items = rows.map((row) => {
      const people = residentLines(
        residents.get(row.apartment.id) ?? { activeOwners: [], activeTenants: [] },
      );
      const payer = personFullName(row.person) ?? people.displayPerson;
      return {
        id: row.id,
        paymentDate: row.paymentDate.toISOString(),
        apartmentLabel: apartmentLabel(row.apartment.building.name, row.apartment.number),
        buildingName: row.apartment.building.name,
        apartmentNumber: row.apartment.number,
        personName: payer,
        amount: toMoneyString(row.amount),
        amountNum: moneyNum(row.amount),
        paymentMethod: row.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
        description: row.description,
        referenceNo: row.referenceNo,
        source: row.bankTransaction ? "Banka ekstresi" : "Manuel",
        createdByUser: null as string | null,
        status: row.status,
        statusLabel: row.status === "COMPLETED" ? "Tamamlandı" : "İptal",
        allocations: row.allocations.map((a) => ({
          id: a.id,
          amount: toMoneyString(a.amount),
          amountNum: moneyNum(a.amount),
          debtTitle: a.apartmentDebt.title,
          dueDate: a.apartmentDebt.dueDate.toISOString(),
          periodYear: a.apartmentDebt.periodYear,
          periodMonth: a.apartmentDebt.periodMonth,
          type: a.apartmentDebt.type,
        })),
      };
    });

    const completed = items.filter((i) => i.status === "COMPLETED");
    const summary = {
      totalAmount: toMoneyString(completed.reduce((s, i) => s + i.amountNum, 0)),
      totalAmountNum: completed.reduce((s, i) => s + i.amountNum, 0),
      count: completed.length,
      cancelledCount: items.filter((i) => i.status === "CANCELLED").length,
    };

    return {
      site,
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId ?? null,
        apartmentId: query.apartmentId ?? null,
        paymentMethod: query.paymentMethod ?? null,
        includeCancelled,
      },
      summary,
      items,
      generatedAt: new Date().toISOString(),
      notes: {
        createdByUser:
          "Payment modelinde işlemi yapan kullanıcı alanı bulunmadığı için bu kolon boş bırakılır.",
      },
    };
  }

  async expenses(tenantId: string, siteId: string, query: ExpensesReportQuery) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);

    const where: Prisma.ExpenseWhereInput = {
      tenantId,
      siteId,
      ...(query.status ? { status: query.status } : { status: "COMPLETED" }),
      ...(query.buildingId ? { buildingId: query.buildingId } : {}),
      ...(query.expenseTypeId ? { expenseTypeId: query.expenseTypeId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(dateFrom || dateTo
        ? {
            expenseDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const count = await prisma.expense.count({ where });
    assertRowLimit(count);

    const [rows, byType] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          amount: true,
          expenseDate: true,
          paymentMethod: true,
          referenceNo: true,
          description: true,
          status: true,
          expenseType: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          building: { select: { id: true, name: true } },
          bankTransaction: {
            select: {
              id: true,
              bankAccount: { select: { bankName: true, accountName: true } },
            },
          },
        },
      }),
      prisma.expense.groupBy({
        by: ["expenseTypeId"],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const typeNames = await prisma.expenseType.findMany({
      where: { tenantId, id: { in: byType.map((t) => t.expenseTypeId) } },
      select: { id: true, name: true },
    });
    const typeNameMap = new Map(typeNames.map((t) => [t.id, t.name]));

    const items = rows.map((row) => {
      const bank = row.bankTransaction?.bankAccount;
      return {
        id: row.id,
        expenseDate: row.expenseDate.toISOString(),
        expenseTypeName: row.expenseType.name,
        title: row.title,
        description: row.description,
        supplierName: row.supplier?.name ?? null,
        amount: toMoneyString(row.amount),
        amountNum: moneyNum(row.amount),
        paymentMethod: row.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
        bankInfo: bank ? `${bank.bankName} / ${bank.accountName}` : null,
        referenceNo: row.referenceNo,
        buildingName: row.building?.name ?? null,
        createdByUser: null as string | null,
        status: row.status,
        statusLabel: row.status === "COMPLETED" ? "Tamamlandı" : "İptal",
      };
    });

    const total = items.reduce((s, i) => s + i.amountNum, 0);
    const topType = byType
      .slice()
      .sort((a, b) => moneyNum(b._sum.amount) - moneyNum(a._sum.amount))[0];
    const monthKeys = new Set(items.map((i) => periodKey(new Date(i.expenseDate))));
    const monthCount = Math.max(1, monthKeys.size);

    return {
      site,
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId ?? null,
        expenseTypeId: query.expenseTypeId ?? null,
        supplierId: query.supplierId ?? null,
        paymentMethod: query.paymentMethod ?? null,
        status: query.status ?? "COMPLETED",
      },
      summary: {
        totalAmount: toMoneyString(total),
        totalAmountNum: total,
        count: items.length,
        topExpenseType: topType
          ? typeNameMap.get(topType.expenseTypeId) ?? "—"
          : "—",
        monthlyAverage: toMoneyString(total / monthCount),
        monthlyAverageNum: total / monthCount,
      },
      items,
      generatedAt: new Date().toISOString(),
      notes: {
        createdByUser:
          "Expense modelinde işlemi yapan kullanıcı alanı bulunmadığı için bu kolon boş bırakılır.",
      },
    };
  }

  async bankTransactions(tenantId: string, siteId: string, query: BankTransactionsReportQuery) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);

    const where: Prisma.BankTransactionWhereInput = {
      tenantId,
      bankAccount: {
        tenantId,
        siteId,
        deletedAt: null,
        ...(query.bankAccountId ? { id: query.bankAccountId } : {}),
      },
      ...(query.direction ? { direction: query.direction } : {}),
      ...(dateFrom || dateTo
        ? {
            transactionDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    if (query.matchFilter === "matched") {
      where.matchStatus = { in: ["MATCHED", "PROCESSED", "SUGGESTED"] };
      where.status = "ACTIVE";
    } else if (query.matchFilter === "unmatched") {
      where.matchStatus = "UNMATCHED";
      where.status = "ACTIVE";
    } else if (query.matchFilter === "to_payment") {
      where.paymentId = { not: null };
    } else if (query.matchFilter === "to_expense") {
      where.expenseId = { not: null };
    } else if (query.matchFilter === "ignored") {
      where.status = "IGNORED";
    }

    if (query.buildingId || query.apartmentId) {
      where.matchedApartment = {
        deletedAt: null,
        ...(query.apartmentId ? { id: query.apartmentId } : {}),
        ...(query.buildingId
          ? { building: { id: query.buildingId, siteId, deletedAt: null } }
          : { building: { siteId, deletedAt: null } }),
      };
    }

    const count = await prisma.bankTransaction.count({ where });
    assertRowLimit(count);

    const rows = await prisma.bankTransaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        transactionDate: true,
        direction: true,
        amount: true,
        description: true,
        referenceNo: true,
        senderName: true,
        status: true,
        matchStatus: true,
        debitClass: true,
        paymentId: true,
        expenseId: true,
        bankAccount: { select: { id: true, bankName: true, accountName: true } },
        matchedApartment: {
          select: {
            id: true,
            number: true,
            building: { select: { name: true } },
          },
        },
        matchedPerson: { select: { firstName: true, lastName: true } },
      },
    });

    const MATCH_LABELS: Record<string, string> = {
      UNMATCHED: "Eşleşmedi",
      SUGGESTED: "Öneri",
      MATCHED: "Eşleşti",
      PROCESSED: "İşlendi",
    };

    const items = rows.map((row) => {
      const isCredit = row.direction === "CREDIT";
      const amount = moneyNum(row.amount);
      let confidence = "—";
      if (row.matchStatus === "MATCHED" || row.matchStatus === "PROCESSED") confidence = "Yüksek";
      else if (row.matchStatus === "SUGGESTED") confidence = "Orta";

      let linkLabel: string | null = null;
      if (row.paymentId) linkLabel = "Tahsilat";
      else if (row.expenseId) linkLabel = "Gider";
      else if (row.status === "IGNORED") linkLabel = "Hariç tutuldu";

      return {
        id: row.id,
        transactionDate: row.transactionDate.toISOString(),
        bankAccountLabel: `${row.bankAccount.bankName} / ${row.bankAccount.accountName}`,
        description: row.description,
        referenceNo: row.referenceNo,
        senderName: row.senderName,
        direction: row.direction,
        incoming: isCredit ? toMoneyString(amount) : null,
        outgoing: !isCredit ? toMoneyString(amount) : null,
        incomingNum: isCredit ? amount : 0,
        outgoingNum: !isCredit ? amount : 0,
        apartmentLabel: row.matchedApartment
          ? apartmentLabel(row.matchedApartment.building.name, row.matchedApartment.number)
          : null,
        personName: personFullName(row.matchedPerson),
        confidence,
        matchStatus: row.matchStatus,
        matchStatusLabel: MATCH_LABELS[row.matchStatus] ?? row.matchStatus,
        status: row.status,
        statusLabel: row.status === "IGNORED" ? "Hariç" : "Aktif",
        linkLabel,
        isCollection: Boolean(row.paymentId && isCredit),
      };
    });

    return {
      site,
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId ?? null,
        apartmentId: query.apartmentId ?? null,
        bankAccountId: query.bankAccountId ?? null,
        direction: query.direction ?? null,
        matchFilter: query.matchFilter,
      },
      summary: {
        incomingTotal: toMoneyString(items.reduce((s, i) => s + i.incomingNum, 0)),
        outgoingTotal: toMoneyString(items.reduce((s, i) => s + i.outgoingNum, 0)),
        count: items.length,
        collectionLinkedCount: items.filter((i) => i.isCollection).length,
      },
      items,
      generatedAt: new Date().toISOString(),
      notes: {
        debit:
          "Giden (DEBIT) hareketler bu raporda görünür; tahsilat toplamına dahil edilmez.",
      },
    };
  }

  async apartmentStatement(
    tenantId: string,
    siteId: string,
    query: ApartmentStatementReportQuery,
  ) {
    const site = await siteMeta(tenantId, siteId);
    const { dateFrom, dateTo } = normalizeReportDateRange(query.dateFrom, query.dateTo);

    const apartment = await prisma.apartment.findFirst({
      where: {
        id: query.apartmentId,
        tenantId,
        deletedAt: null,
        building: {
          id: query.buildingId,
          siteId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        number: true,
        building: { select: { id: true, name: true } },
      },
    });
    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı veya seçili siteye ait değil.");
    }

    const residents = await loadApartmentResidentSummaries(tenantId, siteId, [apartment.id]);
    const people = residentLines(
      residents.get(apartment.id) ?? { activeOwners: [], activeTenants: [] },
    );

    const debts = await prisma.apartmentDebt.findMany({
      where: {
        tenantId,
        apartmentId: apartment.id,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        type: true,
        title: true,
        originalAmount: true,
        createdAt: true,
        dueDate: true,
        periodYear: true,
        periodMonth: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const allocations = await prisma.paymentAllocation.findMany({
      where: {
        tenantId,
        apartmentDebt: { apartmentId: apartment.id },
        payment: { status: "COMPLETED" },
      },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        payment: {
          select: {
            id: true,
            paymentDate: true,
            description: true,
            paymentMethod: true,
            amount: true,
          },
        },
        apartmentDebt: {
          select: { id: true, title: true, dueDate: true, type: true },
        },
      },
      orderBy: { payment: { paymentDate: "asc" } },
    });

    type Move = {
      sortAt: Date;
      date: Date;
      type: "DEBT" | "PAYMENT";
      debtKind: "PRINCIPAL" | "INTEREST" | null;
      description: string;
      debit: number;
      credit: number;
      paymentId?: string;
      debtId?: string;
    };

    const openingCutoff = dateFrom ?? new Date(0);
    let opening = 0;
    for (const d of debts) {
      if (d.createdAt < openingCutoff) opening += moneyNum(d.originalAmount);
    }
    for (const a of allocations) {
      if (a.payment.paymentDate < openingCutoff) opening -= moneyNum(a.amount);
    }

    const moves: Move[] = [];
    for (const d of debts) {
      if (dateFrom && d.createdAt < dateFrom) continue;
      if (dateTo && d.createdAt > dateTo) continue;
      moves.push({
        sortAt: d.createdAt,
        date: d.createdAt,
        type: "DEBT",
        debtKind: d.type === "INTEREST" ? "INTEREST" : "PRINCIPAL",
        description: d.title,
        debit: moneyNum(d.originalAmount),
        credit: 0,
        debtId: d.id,
      });
    }
    for (const a of allocations) {
      if (dateFrom && a.payment.paymentDate < dateFrom) continue;
      if (dateTo && a.payment.paymentDate > dateTo) continue;
      const method = PAYMENT_METHOD_LABELS[a.payment.paymentMethod] ?? a.payment.paymentMethod;
      moves.push({
        sortAt: a.payment.paymentDate,
        date: a.payment.paymentDate,
        type: "PAYMENT",
        debtKind: a.apartmentDebt.type === "INTEREST" ? "INTEREST" : "PRINCIPAL",
        description: `Tahsilat → ${a.apartmentDebt.title} (${method})${
          a.payment.description ? ` — ${a.payment.description}` : ""
        }`,
        debit: 0,
        credit: moneyNum(a.amount),
        paymentId: a.payment.id,
        debtId: a.apartmentDebt.id,
      });
    }

    moves.sort((a, b) => {
      const t = a.sortAt.getTime() - b.sortAt.getTime();
      if (t !== 0) return t;
      if (a.type === b.type) return 0;
      return a.type === "DEBT" ? -1 : 1;
    });

    assertRowLimit(moves.length + 1);

    let balance = opening;
    const items = moves.map((m) => {
      balance += m.debit - m.credit;
      const typeLabel =
        m.type === "PAYMENT"
          ? "Tahsilat"
          : m.debtKind === "INTEREST"
            ? "Gecikme Faizi"
            : "Borç / Tahakkuk";
      return {
        date: m.date.toISOString(),
        type: m.type,
        debtKind: m.debtKind,
        typeLabel,
        description: m.description,
        debit: m.debit ? toMoneyString(m.debit) : null,
        credit: m.credit ? toMoneyString(m.credit) : null,
        balance: toMoneyString(balance),
        debitNum: m.debit,
        creditNum: m.credit,
        balanceNum: balance,
        paymentId: m.paymentId ?? null,
        debtId: m.debtId ?? null,
      };
    });

    return {
      site,
      apartment: {
        id: apartment.id,
        label: apartmentLabel(apartment.building.name, apartment.number),
        buildingName: apartment.building.name,
        apartmentNumber: apartment.number,
        ownerName: people.ownerName,
        tenantName: people.tenantName,
        displayPerson: people.displayPerson,
      },
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        buildingId: query.buildingId,
        apartmentId: query.apartmentId,
      },
      summary: {
        openingBalance: toMoneyString(opening),
        openingBalanceNum: opening,
        closingBalance: toMoneyString(balance),
        closingBalanceNum: balance,
        periodDebit: toMoneyString(items.reduce((s, i) => s + i.debitNum, 0)),
        periodCredit: toMoneyString(items.reduce((s, i) => s + i.creditNum, 0)),
      },
      items,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const reportsService = new ReportsService();
