import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertApartmentInSite, assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { resolveDueState, toMoneyString, todayUtc } from "../utils/money";
import type {
  CreateApartmentDebtInput,
  ListApartmentDebtsQuery,
  UpdateApartmentDebtInput,
} from "../validators/debt.validators";

const debtSelect = {
  id: true,
  type: true,
  title: true,
  originalAmount: true,
  remainingAmount: true,
  dueDate: true,
  periodYear: true,
  periodMonth: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  duesDefinitionId: true,
  building: {
    select: { id: true, name: true },
  },
  apartment: {
    select: {
      id: true,
      number: true,
      relations: {
        where: { isActive: true, isPrimary: true },
        select: {
          relationType: true,
          person: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  },
} as const;

function personFullName(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`.trim();
}

function mapDebt(row: {
  id: string;
  type: "DUES" | "MANUAL";
  title: string;
  originalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  dueDate: Date;
  periodYear: number | null;
  periodMonth: number | null;
  description: string | null;
  status: "OPEN" | "PAID" | "CANCELLED";
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  duesDefinitionId: string | null;
  building: { id: string; name: string };
  apartment: {
    id: string;
    number: string;
    relations: Array<{
      relationType: "OWNER" | "TENANT";
      person: { firstName: string; lastName: string };
    }>;
  };
}) {
  const primaryOwner = row.apartment.relations.find((item) => item.relationType === "OWNER");
  const primaryTenant = row.apartment.relations.find((item) => item.relationType === "TENANT");

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    originalAmount: toMoneyString(row.originalAmount),
    remainingAmount: toMoneyString(row.remainingAmount),
    dueDate: row.dueDate,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    description: row.description,
    status: row.status,
    dueState: resolveDueState(row.dueDate, row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    duesDefinitionId: row.duesDefinitionId,
    building: row.building,
    apartment: {
      id: row.apartment.id,
      number: row.apartment.number,
    },
    primaryOwnerName: primaryOwner ? personFullName(primaryOwner.person) : null,
    primaryTenantName: primaryTenant ? personFullName(primaryTenant.person) : null,
  };
}

function buildWhere(
  tenantId: string,
  siteId: string,
  query: ListApartmentDebtsQuery,
): Prisma.ApartmentDebtWhereInput {
  const where: Prisma.ApartmentDebtWhereInput = {
    tenantId,
    building: { siteId, deletedAt: null },
    apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
  };

  if (query.buildingId) where.buildingId = query.buildingId;
  if (query.apartmentId) where.apartmentId = query.apartmentId;
  if (query.duesDefinitionId) where.duesDefinitionId = query.duesDefinitionId;
  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;
  if (query.periodYear) where.periodYear = query.periodYear;
  if (query.periodMonth) where.periodMonth = query.periodMonth;

  if (query.dueFrom || query.dueTo) {
    where.dueDate = {
      ...(query.dueFrom ? { gte: query.dueFrom } : {}),
      ...(query.dueTo ? { lte: query.dueTo } : {}),
    };
  }

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { apartment: { number: { contains: search, mode: "insensitive" } } },
      { building: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  return where;
}

export class ApartmentDebtService {
  async list(tenantId: string, siteId: string, query: ListApartmentDebtsQuery) {
    const where = buildWhere(tenantId, siteId, query);
    const skip = (query.page - 1) * query.perPage;

    const [rows, total, aggregates, openCount, overdueCount, indebtedApartments] =
      await prisma.$transaction([
        prisma.apartmentDebt.findMany({
          where,
          select: debtSelect,
          orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
          skip,
          take: query.perPage,
        }),
        prisma.apartmentDebt.count({ where }),
        prisma.apartmentDebt.aggregate({
          where,
          _sum: { originalAmount: true, remainingAmount: true },
        }),
        prisma.apartmentDebt.count({
          where: { ...where, status: "OPEN", remainingAmount: { gt: 0 } },
        }),
        prisma.apartmentDebt.count({
          where: {
            ...where,
            status: "OPEN",
            remainingAmount: { gt: 0 },
            dueDate: { lt: todayUtc() },
          },
        }),
        prisma.apartmentDebt.findMany({
          where: { ...where, status: "OPEN", remainingAmount: { gt: 0 } },
          select: { apartmentId: true },
          distinct: ["apartmentId"],
        }),
      ]);

    return {
      items: rows.map(mapDebt),
      page: query.page,
      perPage: query.perPage,
      total,
      summary: {
        totalOriginalAmount: toMoneyString(aggregates._sum.originalAmount ?? 0),
        totalRemainingAmount: toMoneyString(aggregates._sum.remainingAmount ?? 0),
        openDebtCount: openCount,
        overdueDebtCount: overdueCount,
        indebtedApartmentCount: indebtedApartments.length,
      },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.apartmentDebt.findFirst({
      where: {
        id,
        tenantId,
        building: { siteId, deletedAt: null },
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: debtSelect,
    });

    if (!row) {
      throw new HttpError(404, "Borç bulunamadı.");
    }

    return mapDebt(row);
  }

  async createManual(tenantId: string, siteId: string, input: CreateApartmentDebtInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await assertApartmentInSite(tenantId, siteId, input.apartmentId);

    const apartment = await prisma.apartment.findFirst({
      where: {
        id: input.apartmentId,
        tenantId,
        buildingId: input.buildingId,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true, buildingId: true },
    });

    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı.");
    }

    const building = await prisma.building.findFirst({
      where: { id: input.buildingId, tenantId, siteId, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (!building) {
      throw new HttpError(404, "Bina bulunamadı.");
    }

    const amount = new Prisma.Decimal(input.amount);

    const created = await prisma.apartmentDebt.create({
      data: {
        tenantId,
        buildingId: input.buildingId,
        apartmentId: input.apartmentId,
        type: "MANUAL",
        title: input.title,
        originalAmount: amount,
        remainingAmount: amount,
        dueDate: input.dueDate,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        description: input.description,
        status: "OPEN",
      },
      select: debtSelect,
    });

    return mapDebt(created);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateApartmentDebtInput) {
    const current = await this.getById(tenantId, siteId, id);

    if (current.status === "CANCELLED") {
      throw new HttpError(400, "İptal edilmiş borç düzenlenemez.");
    }

    if (current.status === "PAID") {
      throw new HttpError(400, "Ödenmiş borç düzenlenemez.");
    }

    const original = new Prisma.Decimal(current.originalAmount);
    const remaining = new Prisma.Decimal(current.remainingAmount);
    const unpaid = original.equals(remaining);

    if (input.amount !== undefined && !unpaid) {
      throw new HttpError(400, "Ödeme almış borçlarda tutar değiştirilemez.");
    }

    await prisma.apartmentDebt.updateMany({
      where: { id, tenantId, status: "OPEN", building: { siteId, deletedAt: null } },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.amount !== undefined && unpaid
          ? {
              originalAmount: new Prisma.Decimal(input.amount),
              remainingAmount: new Prisma.Decimal(input.amount),
            }
          : {}),
      },
    });

    return this.getById(tenantId, siteId, id);
  }

  async cancel(tenantId: string, siteId: string, id: string) {
    const current = await this.getById(tenantId, siteId, id);

    if (current.status === "CANCELLED") {
      throw new HttpError(400, "Borç zaten iptal edilmiş.");
    }

    if (current.status === "PAID") {
      throw new HttpError(400, "Ödenmiş borç iptal edilemez.");
    }

    const original = new Prisma.Decimal(current.originalAmount);
    const remaining = new Prisma.Decimal(current.remainingAmount);
    if (!original.equals(remaining)) {
      throw new HttpError(400, "Kısmi ödeme almış borçlar bu fazda iptal edilemez.");
    }

    await prisma.apartmentDebt.updateMany({
      where: { id, tenantId, status: "OPEN", building: { siteId, deletedAt: null } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return this.getById(tenantId, siteId, id);
  }
}

export const apartmentDebtService = new ApartmentDebtService();
