import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import {
  countSiteRelations,
  formatSiteDeleteBlockedMessage,
} from "./site-delete-guard";
import type {
  CreateSiteInput,
  ListSitesQuery,
  UpdateSiteInput,
} from "../validators/site.validators";

const siteSelect = {
  id: true,
  name: true,
  code: true,
  address: true,
  city: true,
  district: true,
  description: true,
  isActive: true,
  setupStatus: true,
  setupCompletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class SiteService {
  async list(tenantId: string, query: ListSitesQuery) {
    const where: Prisma.SiteWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;

    const [items, total] = await prisma.$transaction([
      prisma.site.findMany({
        where,
        select: {
          ...siteSelect,
          _count: {
            select: {
              buildings: { where: { tenantId, deletedAt: null } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        skip,
        take: query.perPage,
      }),
      prisma.site.count({ where }),
    ]);

    const siteIds = items.map((s) => s.id);
    const apartments =
      siteIds.length === 0
        ? []
        : await prisma.apartment.findMany({
            where: {
              tenantId,
              deletedAt: null,
              building: { tenantId, siteId: { in: siteIds }, deletedAt: null },
            },
            select: {
              isActive: true,
              building: { select: { siteId: true } },
            },
          });

    const aptBySite = new Map<string, number>();
    const activeAptBySite = new Map<string, number>();
    for (const row of apartments) {
      const siteId = row.building.siteId;
      aptBySite.set(siteId, (aptBySite.get(siteId) ?? 0) + 1);
      if (row.isActive) {
        activeAptBySite.set(siteId, (activeAptBySite.get(siteId) ?? 0) + 1);
      }
    }

    return {
      items: items.map(({ _count, ...site }) => {
        const buildingCount = _count.buildings;
        const apartmentCount = aptBySite.get(site.id) ?? 0;
        const activeApartmentCount = activeAptBySite.get(site.id) ?? 0;
        return {
          ...site,
          buildingCount,
          apartmentCount,
          activeApartmentCount,
        };
      }),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async listActive(tenantId: string) {
    return prisma.site.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true, code: true, city: true, district: true, address: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async getById(tenantId: string, id: string) {
    const site = await prisma.site.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        ...siteSelect,
        _count: {
          select: {
            buildings: { where: { tenantId, deletedAt: null } },
          },
        },
      },
    });

    if (!site) {
      throw new HttpError(404, "Site bulunamadı.");
    }

    const [apartmentCount, activeApartmentCount] = await Promise.all([
      prisma.apartment.count({
        where: {
          tenantId,
          deletedAt: null,
          building: { tenantId, siteId: id, deletedAt: null },
        },
      }),
      prisma.apartment.count({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
          building: { tenantId, siteId: id, deletedAt: null },
        },
      }),
    ]);

    const { _count, ...rest } = site;
    return {
      ...rest,
      buildingCount: _count.buildings,
      apartmentCount,
      activeApartmentCount,
    };
  }

  async create(tenantId: string, input: CreateSiteInput) {
    return prisma.site.create({
      data: {
        tenantId,
        name: input.name,
        code: input.code,
        address: input.address,
        city: input.city,
        district: input.district,
        description: input.description,
      },
      select: siteSelect,
    });
  }

  async update(tenantId: string, id: string, input: UpdateSiteInput) {
    await this.getById(tenantId, id);

    await prisma.site.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.district !== undefined ? { district: input.district } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return this.getById(tenantId, id);
  }

  async softDelete(tenantId: string, id: string) {
    const site = await this.getById(tenantId, id);
    const blockers = await countSiteRelations(tenantId, id);

    if (blockers.length > 0) {
      throw new HttpError(
        409,
        formatSiteDeleteBlockedMessage(blockers),
        "SITE_HAS_RELATED_RECORDS",
        { counts: blockers },
      );
    }

    const result = await prisma.site.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Site bulunamadı.");
    }

    return { id: site.id };
  }
}

export const siteService = new SiteService();
