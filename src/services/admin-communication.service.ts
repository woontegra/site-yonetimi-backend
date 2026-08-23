import type { CommunicationMessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { maskPhone, redactSecrets } from "../utils/admin";

export class AdminCommunicationService {

  async list(query: {
    page: number;
    perPage: number;
    tenantId?: string;
    siteId?: string;
    provider?: string;
    status?: CommunicationMessageStatus;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.CommunicationMessageWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.siteId) where.siteId = query.siteId;
    if (query.provider) where.provider = { equals: query.provider, mode: "insensitive" };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const skip = (query.page - 1) * query.perPage;
    const [items, total, sent, delivered, read, failed] = await Promise.all([
      prisma.communicationMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          tenantId: true,
          siteId: true,
          channel: true,
          status: true,
          provider: true,
          toPhone: true,
          createdAt: true,
          sentAt: true,
          tenant: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      }),
      prisma.communicationMessage.count({ where }),
      prisma.communicationMessage.count({ where: { ...where, status: "SENT" } }),
      prisma.communicationMessage.count({ where: { ...where, status: "DELIVERED" } }),
      prisma.communicationMessage.count({ where: { ...where, status: "READ" } }),
      prisma.communicationMessage.count({ where: { ...where, status: "FAILED" } }),
    ]);

    return {
      summary: { sent, delivered, read, failed },
      items: items.map((item) => ({
        id: item.id,
        tenant: item.tenant,
        site: item.site,
        channel: item.channel,
        status: item.status,
        provider: item.provider,
        toPhoneMasked: maskPhone(item.toPhone),
        createdAt: item.createdAt.toISOString(),
        sentAt: item.sentAt?.toISOString() ?? null,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(id: string) {
    const item = await prisma.communicationMessage.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        siteId: true,
        channel: true,
        status: true,
        provider: true,
        toPhone: true,
        errorMessage: true,
        createdAt: true,
        sentAt: true,
        tenant: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        batch: { select: { id: true, channel: true } },
      },
    });
    if (!item) throw new HttpError(404, "Mesaj bulunamadı.");

    return {
      id: item.id,
      tenant: item.tenant,
      site: item.site,
      channel: item.channel,
      status: item.status,
      provider: item.provider,
      toPhoneMasked: maskPhone(item.toPhone),
      template: item.batch?.channel ?? item.channel,
      errorSummary: redactSecrets(item.errorMessage),
      errorAt: item.status === "FAILED" ? item.createdAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
      sentAt: item.sentAt?.toISOString() ?? null,
    };
  }
}

export const adminCommunicationService = new AdminCommunicationService();
