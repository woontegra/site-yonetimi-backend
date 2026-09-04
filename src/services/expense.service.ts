import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from "../validators/expense.validators";

const expenseSelect = {
  id: true,
  title: true,
  amount: true,
  expenseDate: true,
  paymentMethod: true,
  referenceNo: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  building: { select: { id: true, name: true } },
  expenseType: { select: { id: true, name: true, isActive: true } },
  supplier: { select: { id: true, name: true, isActive: true, deletedAt: true } },
} satisfies Prisma.ExpenseSelect;

function mapExpense(row: {
  id: string;
  title: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  paymentMethod: "CASH" | "BANK_TRANSFER" | "CREDIT_CARD" | "OTHER";
  referenceNo: string | null;
  description: string | null;
  status: "COMPLETED" | "CANCELLED";
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  building: { id: string; name: string } | null;
  expenseType: { id: string; name: string; isActive: boolean };
  supplier: { id: string; name: string; isActive: boolean; deletedAt: Date | null } | null;
}) {
  return {
    id: row.id,
    title: row.title,
    amount: toMoneyString(row.amount),
    expenseDate: row.expenseDate,
    paymentMethod: row.paymentMethod,
    referenceNo: row.referenceNo,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    building: row.building,
    expenseType: row.expenseType,
    supplier: row.supplier
      ? {
          id: row.supplier.id,
          name: row.supplier.name,
          isActive: row.supplier.isActive && !row.supplier.deletedAt,
        }
      : null,
  };
}

async function assertActiveExpenseType(tenantId: string, expenseTypeId: string) {
  const type = await prisma.expenseType.findFirst({
    where: {
      id: expenseTypeId,
      tenantId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });
  if (!type) {
    throw new HttpError(400, "Aktif bir gider türü seçin.");
  }
}

async function assertBuilding(tenantId: string, siteId: string, buildingId: string) {
  await assertBuildingInSite(tenantId, siteId, buildingId);
}

async function assertActiveSupplier(tenantId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      tenantId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });
  if (!supplier) {
    throw new HttpError(400, "Aktif bir tedarikçi seçin.");
  }
}

export class ExpenseService {
  async list(tenantId: string, siteId: string, query: ListExpensesQuery) {
    const where: Prisma.ExpenseWhereInput = { tenantId, siteId };

    if (query.expenseTypeId) where.expenseTypeId = query.expenseTypeId;
    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.expenseDate = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { referenceNo: { contains: search, mode: "insensitive" } },
        { expenseType: { name: { contains: search, mode: "insensitive" } } },
        { building: { name: { contains: search, mode: "insensitive" } } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total, aggregates] = await prisma.$transaction([
      prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({
        where: { ...where, status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    return {
      items: rows.map(mapExpense),
      page: query.page,
      perPage: query.perPage,
      total,
      summary: {
        totalAmount: toMoneyString(aggregates._sum.amount ?? 0),
      },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.expense.findFirst({
      where: { id, tenantId, siteId },
      select: expenseSelect,
    });
    if (!row) throw new HttpError(404, "Gider bulunamadı.");
    return mapExpense(row);
  }

  async monthlySummary(tenantId: string, siteId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const expenses = await prisma.expense.findMany({
      where: {
        tenantId,
        siteId,
        status: "COMPLETED",
        expenseDate: { gte: start, lt: end },
      },
      select: { amount: true, expenseDate: true },
    });

    const buckets = Array.from({ length: 12 }, () => new Prisma.Decimal(0));
    for (const expense of expenses) {
      const monthIndex = expense.expenseDate.getUTCMonth();
      buckets[monthIndex] = buckets[monthIndex].add(expense.amount);
    }

    const now = new Date();
    const currentMonthTotal =
      year === now.getUTCFullYear() ? toMoneyString(buckets[now.getUTCMonth()]) : "0.00";

    return {
      year,
      months: buckets.map((total, index) => ({
        month: index + 1,
        total: toMoneyString(total),
      })),
      currentMonthTotal,
    };
  }

  async create(tenantId: string, siteId: string, input: CreateExpenseInput) {
    await assertActiveExpenseType(tenantId, input.expenseTypeId);
    if (input.buildingId) {
      await assertBuilding(tenantId, siteId, input.buildingId);
    }
    if (input.supplierId) {
      await assertActiveSupplier(tenantId, input.supplierId);
    }

    const row = await prisma.expense.create({
      data: {
        tenantId,
        siteId,
        title: input.title.trim(),
        expenseTypeId: input.expenseTypeId,
        amount: new Prisma.Decimal(input.amount),
        expenseDate: input.expenseDate,
        paymentMethod: input.paymentMethod,
        buildingId: input.buildingId,
        supplierId: input.supplierId,
        referenceNo: input.referenceNo,
        description: input.description,
        status: "COMPLETED",
      },
      select: expenseSelect,
    });

    return mapExpense(row);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateExpenseInput) {
    const current = await prisma.expense.findFirst({
      where: { id, tenantId, siteId },
      select: { id: true, status: true },
    });
    if (!current) throw new HttpError(404, "Gider bulunamadı.");
    if (current.status === "CANCELLED") {
      throw new HttpError(400, "İptal edilmiş gider düzenlenemez.");
    }

    if (input.expenseTypeId) {
      await assertActiveExpenseType(tenantId, input.expenseTypeId);
    }
    if (input.buildingId) {
      await assertBuilding(tenantId, siteId, input.buildingId);
    }
    if (input.supplierId) {
      await assertActiveSupplier(tenantId, input.supplierId);
    }

    const row = await prisma.expense.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.expenseTypeId !== undefined ? { expenseTypeId: input.expenseTypeId } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.expenseDate !== undefined ? { expenseDate: input.expenseDate } : {}),
        ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
        ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.referenceNo !== undefined ? { referenceNo: input.referenceNo } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      select: expenseSelect,
    });

    return mapExpense(row);
  }

  async cancel(tenantId: string, siteId: string, id: string) {
    const current = await prisma.expense.findFirst({
      where: { id, tenantId, siteId },
      select: { id: true, status: true },
    });
    if (!current) throw new HttpError(404, "Gider bulunamadı.");
    if (current.status === "CANCELLED") {
      throw new HttpError(400, "Gider zaten iptal edilmiş.");
    }

    const row = await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: { expenseId: id, tenantId },
        data: {
          expenseId: null,
          debitClass: "UNCLASSIFIED",
          processedAt: null,
        },
      });
      return tx.expense.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
        select: expenseSelect,
      });
    });

    return mapExpense(row);
  }
}

export const expenseService = new ExpenseService();
