import type { Prisma, WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { redactSecrets } from "../utils/admin";

export class AdminIntegrationService {
  async list(query: {
    page: number;
    perPage: number;
    search?: string;
    status?: WhatsAppConnectionStatus;
  }) {
    const where: Prisma.WhatsAppIntegrationWhereInput = { deletedAt: null };
    if (query.status) where.connectionStatus = query.status;
    const search = query.search?.trim();
    if (search) {
      where.tenant = { name: { contains: search, mode: "insensitive" } };
    }

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.whatsAppIntegration.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          tenantId: true,
          wabaId: true,
          displayPhoneNumber: true,
          connectionStatus: true,
          lastCheckedAt: true,
          lastError: true,
          updatedAt: true,
          tenant: { select: { id: true, name: true, isActive: true } },
          _count: { select: { templates: { where: { deletedAt: null } } } },
        },
      }),
      prisma.whatsAppIntegration.count({ where }),
    ]);

    const integrationIds = items.map((item) => item.id);
    const approvedGroups = await prisma.whatsAppTemplate.groupBy({
      by: ["integrationId"],
      where: {
        deletedAt: null,
        status: "APPROVED",
        integrationId: { in: integrationIds },
      },
      _count: { _all: true },
    });
    const approvedMap = new Map(
      approvedGroups.map((item) => [item.integrationId ?? "", item._count._all]),
    );

    const lastSync = await prisma.whatsAppTemplate.groupBy({
      by: ["integrationId"],
      where: { deletedAt: null, integrationId: { in: integrationIds } },
      _max: { lastSyncedAt: true },
    });
    const syncMap = new Map(
      lastSync
        .filter((item) => item.integrationId)
        .map((item) => [item.integrationId as string, item._max.lastSyncedAt]),
    );

    return {
      items: items.map((item) => ({
        id: item.id,
        tenant: item.tenant,
        connectionStatus: item.connectionStatus,
        wabaLinked: Boolean(item.wabaId),
        displayPhoneNumber: item.displayPhoneNumber,
        templateCount: item._count.templates,
        approvedTemplateCount: approvedMap.get(item.id) ?? 0,
        lastSyncedAt: syncMap.get(item.id)?.toISOString() ?? null,
        lastCheckedAt: item.lastCheckedAt?.toISOString() ?? null,
        lastError: redactSecrets(item.lastError),
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(id: string) {
    const item = await prisma.whatsAppIntegration.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        wabaId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        verifiedName: true,
        tokenLastFour: true,
        apiVersion: true,
        isActive: true,
        connectionStatus: true,
        lastCheckedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { id: true, name: true, isActive: true } },
        _count: { select: { templates: { where: { deletedAt: null } } } },
      },
    });
    if (!item) throw new HttpError(404, "Entegrasyon bulunamadı.");

    const approvedCount = await prisma.whatsAppTemplate.count({
      where: { integrationId: id, deletedAt: null, status: "APPROVED" },
    });
    const lastTemplate = await prisma.whatsAppTemplate.findFirst({
      where: { integrationId: id, deletedAt: null },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    });

    return {
      id: item.id,
      tenant: item.tenant,
      connectionStatus: item.connectionStatus,
      wabaLinked: Boolean(item.wabaId),
      phoneNumberLinked: Boolean(item.phoneNumberId),
      displayPhoneNumber: item.displayPhoneNumber,
      verifiedName: item.verifiedName,
      tokenLastFour: item.tokenLastFour,
      apiVersion: item.apiVersion,
      isActive: item.isActive,
      templateCount: item._count.templates,
      approvedTemplateCount: approvedCount,
      lastSyncedAt: lastTemplate?.lastSyncedAt.toISOString() ?? null,
      lastCheckedAt: item.lastCheckedAt?.toISOString() ?? null,
      lastError: redactSecrets(item.lastError),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}

export const adminIntegrationService = new AdminIntegrationService();
