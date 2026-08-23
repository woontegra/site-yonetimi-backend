import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "../validators/supplier.validators";

function mapSupplier(row: {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    taxNumber: row.taxNumber,
    taxOffice: row.taxOffice,
    city: row.city,
    district: row.district,
    address: row.address,
    note: row.note,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export class SupplierService {
  async list(tenantId: string, query: ListSuppliersQuery) {
    const where: Prisma.SupplierWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;
    if (query.city) where.city = { contains: query.city, mode: "insensitive" };

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { contactPerson: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { taxNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.supplier.findMany({
        where,
        orderBy: [{ name: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.supplier.count({ where }),
    ]);

    return {
      items: rows.map(mapSupplier),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, id: string) {
    const row = await prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) throw new HttpError(404, "Tedarikçi bulunamadı.");

    const [completedAgg, cancelledCount] = await prisma.$transaction([
      prisma.expense.aggregate({
        where: { tenantId, supplierId: id, status: "COMPLETED" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.expense.count({
        where: { tenantId, supplierId: id, status: "CANCELLED" },
      }),
    ]);

    return {
      ...mapSupplier(row),
      summary: {
        completedExpenseCount: completedAgg._count._all,
        completedExpenseTotal: toMoneyString(completedAgg._sum.amount ?? 0),
        cancelledExpenseCount: cancelledCount,
      },
    };
  }

  async create(tenantId: string, input: CreateSupplierInput) {
    const row = await prisma.supplier.create({
      data: {
        tenantId,
        name: input.name.trim(),
        contactPerson: input.contactPerson,
        phone: input.phone,
        email: input.email?.toLowerCase(),
        taxNumber: input.taxNumber,
        taxOffice: input.taxOffice,
        city: input.city,
        district: input.district,
        address: input.address,
        note: input.note,
        isActive: true,
      },
    });
    return mapSupplier(row);
  }

  async update(tenantId: string, id: string, input: UpdateSupplierInput) {
    const current = await prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Tedarikçi bulunamadı.");

    const row = await prisma.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.contactPerson !== undefined ? { contactPerson: input.contactPerson } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined
          ? { email: input.email ? input.email.toLowerCase() : null }
          : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
        ...(input.taxOffice !== undefined ? { taxOffice: input.taxOffice } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.district !== undefined ? { district: input.district } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return mapSupplier(row);
  }

  async softDelete(tenantId: string, id: string) {
    const current = await prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Tedarikçi bulunamadı.");

    await prisma.supplier.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return { ok: true };
  }
}

export const supplierService = new SupplierService();
