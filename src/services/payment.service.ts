import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertApartmentInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type { CreatePaymentInput, ListPaymentsQuery } from "../validators/payment.validators";

const paymentSelect = {
  id: true,
  amount: true,
  paymentDate: true,
  paymentMethod: true,
  referenceNo: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  apartment: {
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true } },
    },
  },
  person: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  allocations: {
    select: {
      id: true,
      amount: true,
      apartmentDebt: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          type: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.PaymentSelect;

function personName(person: { firstName: string; lastName: string } | null | undefined) {
  if (!person) return null;
  return `${person.firstName} ${person.lastName}`.trim();
}

function incomeLabel(allocations: Array<{ apartmentDebt: { type: string } }>) {
  if (allocations.length > 1) return "Toplu Tahsilat";
  if (allocations[0]?.apartmentDebt.type === "DUES") return "Aidat Tahsilatı";
  return "Borç Tahsilatı";
}

function mapPayment(row: {
  id: string;
  amount: Prisma.Decimal;
  paymentDate: Date;
  paymentMethod: "CASH" | "BANK_TRANSFER" | "CREDIT_CARD" | "OTHER";
  referenceNo: string | null;
  description: string | null;
  status: "COMPLETED" | "CANCELLED";
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  apartment: {
    id: string;
    number: string;
    building: { id: string; name: string };
  };
  person: { id: string; firstName: string; lastName: string } | null;
  allocations: Array<{
    id: string;
    amount: Prisma.Decimal;
    apartmentDebt: {
      id: string;
      title: string;
      dueDate: Date;
      type: string;
      status: string;
    };
  }>;
}) {
  return {
    id: row.id,
    title: incomeLabel(row.allocations),
    amount: toMoneyString(row.amount),
    paymentDate: row.paymentDate,
    paymentMethod: row.paymentMethod,
    referenceNo: row.referenceNo,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    apartment: {
      id: row.apartment.id,
      number: row.apartment.number,
    },
    building: row.apartment.building,
    person: row.person
      ? {
          id: row.person.id,
          fullName: personName(row.person)!,
        }
      : null,
    allocations: row.allocations.map((item) => ({
      id: item.id,
      amount: toMoneyString(item.amount),
      debt: {
        id: item.apartmentDebt.id,
        title: item.apartmentDebt.title,
        dueDate: item.apartmentDebt.dueDate,
        type: item.apartmentDebt.type,
        status: item.apartmentDebt.status,
      },
    })),
  };
}

export class PaymentService {
  async list(tenantId: string, siteId: string, query: ListPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
    };

    if (query.apartmentId) where.apartmentId = query.apartmentId;
    if (query.buildingId) {
      where.apartment = {
        deletedAt: null,
        buildingId: query.buildingId,
        building: { siteId, deletedAt: null },
      };
    }
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status) where.status = query.status;
    if (query.apartmentDebtId) {
      where.allocations = { some: { apartmentDebtId: query.apartmentDebtId, tenantId } };
    }
    if (query.dateFrom || query.dateTo) {
      where.paymentDate = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { referenceNo: { contains: search, mode: "insensitive" } },
        { apartment: { number: { contains: search, mode: "insensitive" } } },
        { apartment: { building: { name: { contains: search, mode: "insensitive" } } } },
        { person: { firstName: { contains: search, mode: "insensitive" } } },
        { person: { lastName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total, aggregates] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        select: paymentSelect,
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where: { ...where, status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    return {
      items: rows.map(mapPayment),
      page: query.page,
      perPage: query.perPage,
      total,
      summary: {
        totalAmount: toMoneyString(aggregates._sum.amount ?? 0),
      },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.payment.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: paymentSelect,
    });

    if (!row) {
      throw new HttpError(404, "Tahsilat bulunamadı.");
    }

    return mapPayment(row);
  }

  async monthlySummary(tenantId: string, siteId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const payments = await prisma.payment.findMany({
      where: {
        tenantId,
        status: "COMPLETED",
        paymentDate: { gte: start, lt: end },
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: { amount: true, paymentDate: true },
    });

    const months = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      total: "0.00",
    }));

    const buckets = Array.from({ length: 12 }, () => new Prisma.Decimal(0));
    for (const payment of payments) {
      const monthIndex = payment.paymentDate.getUTCMonth();
      buckets[monthIndex] = buckets[monthIndex].add(payment.amount);
    }

    const now = new Date();
    const currentMonthTotal =
      year === now.getUTCFullYear() ? toMoneyString(buckets[now.getUTCMonth()]) : "0.00";

    return {
      year,
      months: months.map((item, index) => ({
        month: item.month,
        total: toMoneyString(buckets[index]),
      })),
      currentMonthTotal,
    };
  }

  /**
   * Mevcut bir Prisma transaction içinde Payment + allocation + borç güncellemesi uygular.
   * Banka process gibi dış işlemlerle aynı atomic boundary'yi paylaşmak için kullanılır.
   */
  async createWithinTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    input: CreatePaymentInput,
  ): Promise<string> {
    const paymentAmount = new Prisma.Decimal(input.amount);
    const allocationTotal = input.allocations.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.amount)),
      new Prisma.Decimal(0),
    );

    if (!allocationTotal.equals(paymentAmount)) {
      throw new HttpError(400, "Dağıtım tutarları ödeme tutarına eşit olmalıdır.");
    }

    const apartment = await tx.apartment.findFirst({
      where: {
        id: input.apartmentId,
        tenantId,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı.");
    }

    if (input.personId) {
      const person = await tx.person.findFirst({
        where: { id: input.personId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!person) {
        throw new HttpError(404, "Kişi bulunamadı.");
      }
    }

    const debtIds = input.allocations.map((item) => item.apartmentDebtId);
    const uniqueDebtIds = new Set(debtIds);
    if (uniqueDebtIds.size !== debtIds.length) {
      throw new HttpError(400, "Aynı borç birden fazla kez dağıtılamaz.");
    }

    const debts = await tx.apartmentDebt.findMany({
      where: {
        id: { in: debtIds },
        tenantId,
        apartmentId: input.apartmentId,
        status: "OPEN",
      },
      select: {
        id: true,
        remainingAmount: true,
        status: true,
      },
    });

    if (debts.length !== debtIds.length) {
      throw new HttpError(400, "Dağıtım yalnızca aynı dairenin açık borçlarına yapılabilir.");
    }

    const debtMap = new Map(debts.map((item) => [item.id, item]));

    for (const allocation of input.allocations) {
      const debt = debtMap.get(allocation.apartmentDebtId)!;
      const allocAmount = new Prisma.Decimal(allocation.amount);
      if (allocAmount.gt(debt.remainingAmount)) {
        throw new HttpError(400, "Ödeme tutarı kalan borç tutarını aşamaz.");
      }
    }

    const payment = await tx.payment.create({
      data: {
        tenantId,
        apartmentId: input.apartmentId,
        personId: input.personId,
        amount: paymentAmount,
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        referenceNo: input.referenceNo,
        description: input.description,
        status: "COMPLETED",
      },
      select: { id: true },
    });

    for (const allocation of input.allocations) {
      const debt = debtMap.get(allocation.apartmentDebtId)!;
      const allocAmount = new Prisma.Decimal(allocation.amount);
      const nextRemaining = debt.remainingAmount.sub(allocAmount);

      await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: payment.id,
          apartmentDebtId: allocation.apartmentDebtId,
          amount: allocAmount,
        },
      });

      await tx.apartmentDebt.update({
        where: { id: allocation.apartmentDebtId },
        data: {
          remainingAmount: nextRemaining,
          status: nextRemaining.equals(0) ? "PAID" : "OPEN",
        },
      });

      debt.remainingAmount = nextRemaining;
    }

    return payment.id;
  }

  async create(tenantId: string, siteId: string, input: CreatePaymentInput, idempotencyKey?: string) {
    await assertApartmentInSite(tenantId, siteId, input.apartmentId);

    if (idempotencyKey) {
      const existing = await prisma.paymentIdempotencyKey.findUnique({
        where: { tenantId_key: { tenantId, key: idempotencyKey } },
      });
      if (existing) {
        return this.getById(tenantId, siteId, existing.paymentId);
      }
    }

    try {
      const paymentId = await prisma.$transaction(async (tx) => {
        const id = await this.createWithinTransaction(tx, tenantId, siteId, input);
        if (idempotencyKey) {
          await tx.paymentIdempotencyKey.create({
            data: {
              tenantId,
              key: idempotencyKey,
              paymentId: id,
            },
          });
        }
        return id;
      });

      return this.getById(tenantId, siteId, paymentId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && idempotencyKey) {
        const existing = await prisma.paymentIdempotencyKey.findUnique({
          where: { tenantId_key: { tenantId, key: idempotencyKey } },
        });
        if (existing) return this.getById(tenantId, siteId, existing.paymentId);
      }
      throw error;
    }
  }

  async cancel(tenantId: string, siteId: string, id: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: {
        id: true,
        status: true,
        allocations: {
          select: {
            apartmentDebtId: true,
            amount: true,
          },
        },
        bankTransaction: { select: { id: true } },
      },
    });

    if (!payment) {
      throw new HttpError(404, "Tahsilat bulunamadı.");
    }

    if (payment.status === "CANCELLED") {
      throw new HttpError(400, "Tahsilat zaten iptal edilmiş.");
    }

    await prisma.$transaction(async (tx) => {
      for (const allocation of payment.allocations) {
        const debt = await tx.apartmentDebt.findFirst({
          where: { id: allocation.apartmentDebtId, tenantId },
          select: { id: true, remainingAmount: true, originalAmount: true, status: true },
        });

        if (!debt || debt.status === "CANCELLED") continue;

        const nextRemaining = debt.remainingAmount.add(allocation.amount);
        const capped = nextRemaining.gt(debt.originalAmount) ? debt.originalAmount : nextRemaining;

        await tx.apartmentDebt.update({
          where: { id: debt.id },
          data: {
            remainingAmount: capped,
            status: capped.gt(0) ? "OPEN" : "PAID",
          },
        });
      }

      await tx.payment.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      });

      if (payment.bankTransaction) {
        await tx.bankTransaction.update({
          where: { id: payment.bankTransaction.id },
          data: {
            paymentId: null,
            matchStatus: "MATCHED",
            processedAt: null,
          },
        });
      }
    });

    return this.getById(tenantId, siteId, id);
  }
}

export const paymentService = new PaymentService();
