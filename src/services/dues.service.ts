import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateDuesDefinitionInput,
  ListDuesDefinitionsQuery,
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

function mapDues(row: {
  id: string;
  name: string;
  amount: Prisma.Decimal;
  periodYear: number;
  periodMonth: number;
  dueDate: Date;
  description: string | null;
  isActive: boolean;
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

    return {
      items: rows.map(mapDues),
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
    };
  }

  async create(tenantId: string, siteId: string, input: CreateDuesDefinitionInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);

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

    return mapDues(created);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateDuesDefinitionInput) {
    await this.getById(tenantId, siteId, id);

    if (input.buildingId) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
      await this.assertBuildingActive(tenantId, siteId, input.buildingId);
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

  async getChargePreview(tenantId: string, siteId: string, id: string) {
    const dues = await this.getById(tenantId, siteId, id);

    const apartments = await prisma.apartment.findMany({
      where: {
        tenantId,
        buildingId: dues.building.id,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true },
    });

    const alreadyCharged = await prisma.apartmentDebt.findMany({
      where: {
        tenantId,
        duesDefinitionId: id,
        apartmentId: { in: apartments.map((item) => item.id) },
      },
      select: { apartmentId: true },
    });

    const chargedSet = new Set(alreadyCharged.map((item) => item.apartmentId));
    const pendingCount = apartments.filter((item) => !chargedSet.has(item.id)).length;
    const amount = new Prisma.Decimal(dues.amount);

    return {
      dues,
      activeApartmentCount: apartments.length,
      alreadyChargedCount: chargedSet.size,
      pendingChargeCount: pendingCount,
      totalChargeAmount: toMoneyString(amount.mul(pendingCount)),
    };
  }

  async chargeApartments(tenantId: string, siteId: string, id: string) {
    const preview = await this.getChargePreview(tenantId, siteId, id);
    const dues = preview.dues;

    if (preview.pendingChargeCount === 0) {
      throw new HttpError(409, "Bu aidat için borçlandırılacak aktif daire kalmadı.");
    }

    const apartments = await prisma.apartment.findMany({
      where: {
        tenantId,
        buildingId: dues.building.id,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true, buildingId: true },
    });

    const alreadyCharged = await prisma.apartmentDebt.findMany({
      where: {
        tenantId,
        duesDefinitionId: id,
        apartmentId: { in: apartments.map((item) => item.id) },
      },
      select: { apartmentId: true },
    });
    const chargedSet = new Set(alreadyCharged.map((item) => item.apartmentId));
    const toCharge = apartments.filter((item) => !chargedSet.has(item.id));

    const amount = new Prisma.Decimal(dues.amount);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const data = toCharge.map((apartment) => ({
          tenantId,
          buildingId: apartment.buildingId,
          apartmentId: apartment.id,
          duesDefinitionId: id,
          type: "DUES" as const,
          title: dues.name,
          originalAmount: amount,
          remainingAmount: amount,
          dueDate: dues.dueDate,
          periodYear: dues.periodYear,
          periodMonth: dues.periodMonth,
          description: dues.description,
          status: "OPEN" as const,
        }));

        await tx.apartmentDebt.createMany({ data });
        return data.length;
      });

      return {
        createdCount: created,
        totalAmount: toMoneyString(amount.mul(created)),
        dues: await this.getById(tenantId, siteId, id),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Bu aidat için bazı dairelerde borç kaydı zaten mevcut.");
      }
      throw error;
    }
  }

  async cancelOpenDebts(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);

    const result = await prisma.apartmentDebt.updateMany({
      where: {
        tenantId,
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
}

export const duesDefinitionService = new DuesDefinitionService();
