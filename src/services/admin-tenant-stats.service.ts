import { prisma } from "../lib/prisma";
import { toSubscriptionView } from "./admin-serializers";

/**
 * Platform kullanım özeti. Finansal tutar / borç bakiyesi içermez.
 */
export class AdminTenantStatsService {
  async list(query: { page: number; perPage: number; search?: string }) {
    const where = query.search?.trim()
      ? { name: { contains: query.search.trim(), mode: "insensitive" as const } }
      : {};
    const skip = (query.page - 1) * query.perPage;
    const active7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const active30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [tenants, total] = await prisma.$transaction([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          subscription: true,
          _count: {
            select: {
              sites: { where: { deletedAt: null } },
              buildings: { where: { deletedAt: null } },
              apartments: { where: { deletedAt: null } },
              memberships: true,
              apartmentDebts: true,
              payments: true,
              bankTransactions: true,
              whatsAppIntegrations: { where: { deletedAt: null } },
            },
          },
          memberships: {
            select: {
              user: { select: { lastLoginAt: true } },
            },
          },
          whatsAppIntegrations: {
            where: { deletedAt: null },
            select: { connectionStatus: true },
            take: 1,
            orderBy: { updatedAt: "desc" },
          },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    const items = tenants.map((t) => {
      const lastLogins = t.memberships
        .map((m) => m.user.lastLoginAt)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime());
      const lastLoginAt = lastLogins[0] ?? null;
      const activeUsers7d = t.memberships.filter(
        (m) => m.user.lastLoginAt && m.user.lastLoginAt >= active7d,
      ).length;
      const activeUsers30d = t.memberships.filter(
        (m) => m.user.lastLoginAt && m.user.lastLoginAt >= active30d,
      ).length;
      const wa = t.whatsAppIntegrations[0];

      return {
        id: t.id,
        name: t.name,
        isActive: t.isActive,
        createdAt: t.createdAt.toISOString(),
        siteCount: t._count.sites,
        buildingCount: t._count.buildings,
        apartmentCount: t._count.apartments,
        userCount: t._count.memberships,
        lastLoginAt: lastLoginAt?.toISOString() ?? null,
        activeUsers7d,
        activeUsers30d,
        subscription: toSubscriptionView(t.subscription),
        usageFlags: {
          hasDebts: t._count.apartmentDebts > 0,
          hasPayments: t._count.payments > 0,
          hasBankImport: t._count.bankTransactions > 0,
          whatsappConnected: wa?.connectionStatus === "CONNECTED",
          whatsappStatus: wa?.connectionStatus ?? null,
        },
      };
    });

    return {
      items,
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }
}

export const adminTenantStatsService = new AdminTenantStatsService();
