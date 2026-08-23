import { prisma } from "../lib/prisma";
import { toSubscriptionView } from "./admin-serializers";

const EXPIRING_DAYS = 30;

export class AdminOverviewService {
  async getOverview() {
    const now = new Date();
    const expiringUntil = new Date(now.getTime() + EXPIRING_DAYS * 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      activeTenants,
      totalSites,
      totalApartments,
      totalUsers,
      trialSubscriptions,
      activeSubscriptions,
      whatsappConnected,
      expiringCount,
      recentTenants,
      expiringSubscriptions,
      errorIntegrations,
      failedMessages,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.site.count({ where: { deletedAt: null } }),
      prisma.apartment.count({ where: { deletedAt: null } }),
      prisma.user.count(),
      prisma.subscription.count({ where: { status: "TRIAL" } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.whatsAppIntegration.count({
        where: { deletedAt: null, connectionStatus: "CONNECTED" },
      }),
      prisma.subscription.count({
        where: {
          status: { in: ["TRIAL", "ACTIVE"] },
          endsAt: { gte: now, lte: expiringUntil },
        },
      }),
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          subscription: true,
        },
      }),
      prisma.subscription.findMany({
        where: {
          status: { in: ["TRIAL", "ACTIVE"] },
          endsAt: { gte: now, lte: expiringUntil },
        },
        orderBy: { endsAt: "asc" },
        take: 5,
        include: { tenant: { select: { id: true, name: true, isActive: true } } },
      }),
      prisma.whatsAppIntegration.findMany({
        where: { deletedAt: null, connectionStatus: "ERROR" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          tenantId: true,
          connectionStatus: true,
          lastError: true,
          lastCheckedAt: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.communicationMessage.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          tenantId: true,
          siteId: true,
          status: true,
          provider: true,
          channel: true,
          createdAt: true,
          tenant: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      metrics: {
        totalTenants,
        activeTenants,
        totalSites,
        totalApartments,
        totalUsers,
        trialSubscriptions,
        activeSubscriptions,
        whatsappConnected,
        expiringSubscriptions: expiringCount,
      },
      recentTenants: recentTenants.map((item) => ({
        id: item.id,
        name: item.name,
        isActive: item.isActive,
        createdAt: item.createdAt.toISOString(),
        subscription: toSubscriptionView(item.subscription),
      })),
      expiringSubscriptions: expiringSubscriptions.map((item) => ({
        ...toSubscriptionView(item)!,
        tenant: item.tenant,
      })),
      errorIntegrations: errorIntegrations.map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        tenantName: item.tenant.name,
        connectionStatus: item.connectionStatus,
        lastCheckedAt: item.lastCheckedAt?.toISOString() ?? null,
      })),
      failedMessages: failedMessages.map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        tenantName: item.tenant.name,
        siteId: item.siteId,
        siteName: item.site.name,
        status: item.status,
        provider: item.provider,
        channel: item.channel,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}

export const adminOverviewService = new AdminOverviewService();
