import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import type { CreateBuildingInput, ListBuildingsQuery, UpdateBuildingInput } from "../validators/building.validators";

const buildingSelect = {
  id: true,
  siteId: true,
  name: true,
  code: true,
  address: true,
  city: true,
  district: true,
  apartmentCount: true,
  floorCount: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      apartments: {
        where: { deletedAt: null },
      },
    },
  },
} as const;

function mapBuilding<T extends { _count: { apartments: number } }>(row: T) {
  const { _count, ...building } = row;
  return {
    ...building,
    registeredApartmentCount: _count.apartments,
  };
}

export class BuildingService {
  async list(tenantId: string, siteId: string, query: ListBuildingsQuery) {
    const where: Prisma.BuildingWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };

    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;

    const [items, total] = await prisma.$transaction([
      prisma.building.findMany({
        where,
        select: buildingSelect,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
      }),
      prisma.building.count({ where }),
    ]);

    return {
      items: items.map(mapBuilding),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const building = await prisma.building.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: buildingSelect,
    });

    if (!building) {
      throw new HttpError(404, "Bina bulunamadı.");
    }

    return mapBuilding(building);
  }

  async create(tenantId: string, siteId: string, input: CreateBuildingInput) {
    return mapBuilding(
      await prisma.building.create({
        data: {
          tenantId,
          siteId,
          name: input.name,
          code: input.code,
          address: input.address,
          city: input.city,
          district: input.district,
          description: input.description,
          apartmentCount: input.apartmentCount ?? null,
          floorCount: input.floorCount ?? null,
        },
        select: buildingSelect,
      }),
    );
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateBuildingInput) {
    await this.getById(tenantId, siteId, id);

    await prisma.building.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.district !== undefined ? { district: input.district } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.apartmentCount !== undefined ? { apartmentCount: input.apartmentCount } : {}),
        ...(input.floorCount !== undefined ? { floorCount: input.floorCount } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return this.getById(tenantId, siteId, id);
  }

  async remove(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);

    const result = await prisma.building.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Bina bulunamadı.");
    }
  }
}

export const buildingService = new BuildingService();
