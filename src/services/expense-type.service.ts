import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateExpenseTypeInput,
  ListExpenseTypesQuery,
  UpdateExpenseTypeInput,
} from "../validators/expense.validators";

function mapType(row: {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  _count?: { expenses: number };
}) {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    expenseCount: row._count?.expenses ?? 0,
  };
}

export class ExpenseTypeService {
  async list(tenantId: string, query: ListExpenseTypesQuery) {
    const where: Prisma.ExpenseTypeWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.activeOnly) where.isActive = true;
    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }

    const rows = await prisma.expenseType.findMany({
      where,
      include: { _count: { select: { expenses: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return { items: rows.map(mapType) };
  }

  async create(tenantId: string, input: CreateExpenseTypeInput) {
    const existing = await prisma.expenseType.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        name: { equals: input.name.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, "Bu gider türü zaten mevcut.");
    }

    const maxSort = await prisma.expenseType.aggregate({
      where: { tenantId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const row = await prisma.expenseType.create({
      data: {
        tenantId,
        name: input.name.trim(),
        sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        isActive: true,
      },
      include: { _count: { select: { expenses: true } } },
    });

    return mapType(row);
  }

  async update(tenantId: string, id: string, input: UpdateExpenseTypeInput) {
    const current = await prisma.expenseType.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Gider türü bulunamadı.");

    if (input.name) {
      const duplicate = await prisma.expenseType.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          id: { not: id },
          name: { equals: input.name.trim(), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicate) throw new HttpError(409, "Bu gider türü zaten mevcut.");
    }

    const row = await prisma.expenseType.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      include: { _count: { select: { expenses: true } } },
    });

    return mapType(row);
  }

  async softDelete(tenantId: string, id: string) {
    const current = await prisma.expenseType.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { expenses: true } },
      },
    });
    if (!current) throw new HttpError(404, "Gider türü bulunamadı.");

    if (current._count.expenses > 0) {
      const row = await prisma.expenseType.update({
        where: { id },
        data: { isActive: false },
        include: { _count: { select: { expenses: true } } },
      });
      return { expenseType: mapType(row), deactivated: true as const };
    }

    const row = await prisma.expenseType.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
      include: { _count: { select: { expenses: true } } },
    });

    return { expenseType: mapType(row), deactivated: false as const };
  }
}

export const expenseTypeService = new ExpenseTypeService();
