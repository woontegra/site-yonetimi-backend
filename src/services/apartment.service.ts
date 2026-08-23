import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import type {
  CreateApartmentInput,
  ListApartmentsQuery,
  UpdateApartmentInput,
} from "../validators/apartment.validators";

const apartmentSelect = {
  id: true,
  number: true,
  floor: true,
  roomType: true,
  squareMeters: true,
  hasBalcony: true,
  isActive: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  building: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export class ApartmentService {
  async list(tenantId: string, siteId: string, query: ListApartmentsQuery) {
    const where: Prisma.ApartmentWhereInput = {
      tenantId,
      deletedAt: null,
      building: {
        siteId,
        deletedAt: null,
      },
    };

    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.floor) where.floor = query.floor;
    if (query.roomType) where.roomType = query.roomType;
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: "insensitive" } },
        { building: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.apartment.findMany({
        where,
        select: apartmentSelect,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
      }),
      prisma.apartment.count({ where }),
    ]);

    return {
      items,
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const apartment = await prisma.apartment.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        building: { siteId, deletedAt: null },
      },
      select: apartmentSelect,
    });

    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı.");
    }

    return apartment;
  }

  async create(tenantId: string, siteId: string, input: CreateApartmentInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    await this.assertUniqueNumber(input.buildingId, input.number);

    try {
      return await prisma.apartment.create({
        data: {
          tenantId,
          buildingId: input.buildingId,
          number: input.number,
          floor: input.floor ?? null,
          roomType: input.roomType ?? null,
          squareMeters: input.squareMeters,
          hasBalcony: input.hasBalcony ?? null,
          description: input.description,
        },
        select: apartmentSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
      }
      throw error;
    }
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateApartmentInput) {
    const current = await this.getById(tenantId, siteId, id);
    const buildingId = input.buildingId ?? current.building.id;
    const number = input.number ?? current.number;

    if (input.buildingId && input.buildingId !== current.building.id) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
      await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    }

    await this.assertUniqueNumber(buildingId, number, id);

    try {
      await prisma.apartment.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: {
          ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(input.floor !== undefined ? { floor: input.floor } : {}),
          ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
          ...(input.squareMeters !== undefined ? { squareMeters: input.squareMeters } : {}),
          ...(input.hasBalcony !== undefined ? { hasBalcony: input.hasBalcony } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
      }
      throw error;
    }

    return this.getById(tenantId, siteId, id);
  }

  async remove(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);

    const result = await prisma.apartment.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Daire bulunamadı.");
    }
  }

  private async assertBuildingActive(tenantId: string, siteId: string, buildingId: string) {
    const building = await prisma.building.findFirst({
      where: {
        id: buildingId,
        tenantId,
        siteId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });

    if (!building) {
      throw new HttpError(404, "Bina bulunamadı.");
    }
  }

  private async assertUniqueNumber(buildingId: string, number: string, excludeId?: string) {
    const existing = await prisma.apartment.findFirst({
      where: {
        buildingId,
        number,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
    }
  }
}

export const apartmentService = new ApartmentService();
