import type { Prisma, SiteSetupStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

const siteWhere = (siteId: string): Prisma.SiteWhereInput => ({ id: siteId, deletedAt: null });

export class AdminSiteService {
  async list(query: {
    page: number;
    perPage: number;
    search?: string;
    tenantId?: string;
    status?: "aktif" | "pasif";
    setupStatus?: SiteSetupStatus;
    city?: string;
  }) {
    const where: Prisma.SiteWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
        { tenant: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;
    if (query.setupStatus) where.setupStatus = query.setupStatus;
    if (query.city?.trim()) where.city = { contains: query.city.trim(), mode: "insensitive" };

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.site.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          name: true,
          city: true,
          district: true,
          isActive: true,
          setupStatus: true,
          createdAt: true,
          tenant: { select: { id: true, name: true, isActive: true } },
          _count: {
            select: {
              buildings: { where: { deletedAt: null } },
            },
          },
        },
      }),
      prisma.site.count({ where }),
    ]);

    const siteIds = items.map((item) => item.id);
    const [apartmentGroups, personGroups] = await Promise.all([
      prisma.apartment.groupBy({
        by: ["buildingId"],
        where: {
          deletedAt: null,
          building: { deletedAt: null, siteId: { in: siteIds } },
        },
        _count: { _all: true },
      }),
      this.personCountsBySite(siteIds),
    ]);

    const buildingSite = await prisma.building.findMany({
      where: { deletedAt: null, siteId: { in: siteIds } },
      select: { id: true, siteId: true },
    });
    const buildingToSite = new Map(buildingSite.map((item) => [item.id, item.siteId]));
    const apartmentsBySite = new Map<string, number>();
    for (const group of apartmentGroups) {
      const siteId = buildingToSite.get(group.buildingId);
      if (!siteId) continue;
      apartmentsBySite.set(siteId, (apartmentsBySite.get(siteId) ?? 0) + group._count._all);
    }

    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        city: item.city,
        district: item.district,
        isActive: item.isActive,
        setupStatus: item.setupStatus,
        createdAt: item.createdAt.toISOString(),
        tenant: item.tenant,
        buildingCount: item._count.buildings,
        apartmentCount: apartmentsBySite.get(item.id) ?? 0,
        residentCount: personGroups.get(item.id) ?? 0,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(id: string) {
    const site = await prisma.site.findFirst({
      where: siteWhere(id),
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        city: true,
        district: true,
        isActive: true,
        setupStatus: true,
        setupCompletedAt: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!site) throw new HttpError(404, "Site bulunamadı.");

    const [buildingCount, apartmentCount, residentCount, insideVisitors, assetCount] = await Promise.all([
      prisma.building.count({ where: { siteId: id, deletedAt: null } }),
      prisma.apartment.count({
        where: { deletedAt: null, building: { siteId: id, deletedAt: null } },
      }),
      prisma.person.count({
        where: {
          deletedAt: null,
          relations: {
            some: {
              isActive: true,
              apartment: { deletedAt: null, building: { siteId: id, deletedAt: null } },
            },
          },
        },
      }),
      prisma.visit.count({
        where: {
          status: "INSIDE",
          apartment: { deletedAt: null, building: { siteId: id, deletedAt: null } },
        },
      }),
      prisma.asset.count({ where: { siteId: id, deletedAt: null } }),
    ]);

    return {
      ...site,
      createdAt: site.createdAt.toISOString(),
      setupCompletedAt: site.setupCompletedAt?.toISOString() ?? null,
      counts: {
        buildings: buildingCount,
        apartments: apartmentCount,
        residents: residentCount,
        insideVisitors,
        assets: assetCount,
      },
    };
  }

  private async personCountsBySite(siteIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (siteIds.length === 0) return map;

    const relations = await prisma.apartmentPersonRelation.findMany({
      where: {
        isActive: true,
        apartment: { deletedAt: null, building: { deletedAt: null, siteId: { in: siteIds } } },
        person: { deletedAt: null },
      },
      select: {
        personId: true,
        apartment: { select: { building: { select: { siteId: true } } } },
      },
    });

    const seen = new Map<string, Set<string>>();
    for (const relation of relations) {
      const siteId = relation.apartment.building.siteId;
      if (!seen.has(siteId)) seen.set(siteId, new Set());
      seen.get(siteId)!.add(relation.personId);
    }
    for (const [siteId, persons] of seen) {
      map.set(siteId, persons.size);
    }
    return map;
  }
}

export const adminSiteService = new AdminSiteService();
