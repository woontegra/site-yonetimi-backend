import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import type {
  CreateVisitorInput,
  ListVisitorsQuery,
  UpdateVisitorInput,
} from "../validators/visitor.validators";

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function mapVisitorListItem(row: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  visits: Array<{ checkInAt: Date }>;
  _count: { visits: number };
}) {
  const lastVisit = row.visits[0] ?? null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: fullName(row.firstName, row.lastName),
    phone: row.phone,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    visitCount: row._count.visits,
    lastVisitAt: lastVisit?.checkInAt ?? null,
  };
}

export class VisitorService {
  async list(tenantId: string, query: ListVisitorsQuery) {
    const where: Prisma.VisitorWhereInput = {
      tenantId,
      deletedAt: null,
    };

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.visitor.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { visits: true } },
          visits: {
            orderBy: { checkInAt: "desc" },
            take: 1,
            select: { checkInAt: true },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.visitor.count({ where }),
    ]);

    return {
      items: rows.map(mapVisitorListItem),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, id: string) {
    const row = await prisma.visitor.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        nationalId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { visits: true } },
        visits: {
          orderBy: { checkInAt: "desc" },
          take: 1,
          select: { checkInAt: true },
        },
      },
    });
    if (!row) throw new HttpError(404, "Misafir bulunamadı.");

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: fullName(row.firstName, row.lastName),
      phone: row.phone,
      nationalId: row.nationalId,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      visitCount: row._count.visits,
      lastVisitAt: row.visits[0]?.checkInAt ?? null,
    };
  }

  async create(tenantId: string, input: CreateVisitorInput) {
    const row = await prisma.visitor.create({
      data: {
        tenantId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone,
        nationalId: input.nationalId,
        note: input.note,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        nationalId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: fullName(row.firstName, row.lastName),
      phone: row.phone,
      nationalId: row.nationalId,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      visitCount: 0,
      lastVisitAt: null,
    };
  }

  async update(tenantId: string, id: string, input: UpdateVisitorInput) {
    const current = await prisma.visitor.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Misafir bulunamadı.");

    await prisma.visitor.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.nationalId !== undefined ? { nationalId: input.nationalId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });

    return this.getById(tenantId, id);
  }

  async softDelete(tenantId: string, id: string) {
    const current = await prisma.visitor.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        visits: { where: { status: "INSIDE" }, select: { id: true }, take: 1 },
      },
    });
    if (!current) throw new HttpError(404, "Misafir bulunamadı.");
    if (current.visits.length > 0) {
      throw new HttpError(400, "Aktif ziyareti olan misafir arşivlenemez.");
    }

    await prisma.visitor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }
}

export const visitorService = new VisitorService();
