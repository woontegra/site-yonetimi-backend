import { prisma } from "../lib/prisma";
import { toSubscriptionView } from "./admin-serializers";

const EXPIRING_DAYS = 30;
const EXPIRING_CRITICAL_DAYS = 7;

export class AdminOverviewService {
  async getOverview() {
    const now = new Date();
    const expiringUntil = new Date(now.getTime() + EXPIRING_DAYS * 24 * 60 * 60 * 1000);
    const expiringCriticalUntil = new Date(now.getTime() + EXPIRING_CRITICAL_DAYS * 24 * 60 * 60 * 1000);
    const active30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalSites,
      totalApartments,
      totalUsers,
      activeUsers,
      inactiveUsers,
      usersActive30d,
      trialSubscriptions,
      activeSubscriptions,
      expiredSubscriptions,
      suspendedSubscriptions,
      whatsappConnected,
      whatsappError,
      expiringCount,
      expiringCriticalCount,
      tenantsWithoutUsers,
      tenantsWithoutSubscription,
      failedEmailDeliveries,
      failedMessagesCount,
      recentTenants,
      expiringSubscriptions,
      errorIntegrations,
      failedMessages,
      criticalExpiring,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.tenant.count({ where: { isActive: false } }),
      prisma.site.count({ where: { deletedAt: null } }),
      prisma.apartment.count({ where: { deletedAt: null } }),
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.user.count({ where: { lastLoginAt: { gte: active30d } } }),
      prisma.subscription.count({ where: { plan: "DEMO", status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: "EXPIRED" } }),
      prisma.subscription.count({ where: { status: "SUSPENDED" } }),
      prisma.whatsAppIntegration.count({
        where: { deletedAt: null, connectionStatus: "CONNECTED" },
      }),
      prisma.whatsAppIntegration.count({
        where: { deletedAt: null, connectionStatus: "ERROR" },
      }),
      prisma.subscription.count({
        where: {
          status: { in: ["ACTIVE"] },
          endsAt: { gte: now, lte: expiringUntil },
        },
      }),
      prisma.subscription.count({
        where: {
          status: { in: ["ACTIVE"] },
          endsAt: { gte: now, lte: expiringCriticalUntil },
        },
      }),
      prisma.tenant.count({
        where: { memberships: { none: {} } },
      }),
      prisma.tenant.count({
        where: { isActive: true, subscription: null },
      }),
      prisma.emailDelivery.count({ where: { status: "FAILED" } }),
      prisma.communicationMessage.count({ where: { status: "FAILED" } }),
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
          status: { in: ["ACTIVE"] },
          endsAt: { gte: now, lte: expiringUntil },
        },
        orderBy: { endsAt: "asc" },
        take: 8,
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
      prisma.subscription.findMany({
        where: {
          status: { in: ["ACTIVE"] },
          endsAt: { gte: now, lte: expiringCriticalUntil },
        },
        orderBy: { endsAt: "asc" },
        take: 10,
        include: { tenant: { select: { id: true, name: true, isActive: true } } },
      }),
    ]);

    const expiredButActiveTenants = await prisma.subscription.findMany({
      where: {
        status: "EXPIRED",
        tenant: { isActive: true },
      },
      take: 10,
      include: { tenant: { select: { id: true, name: true, isActive: true } } },
    });

    const alerts: Array<{
      code: string;
      severity: "warning" | "danger";
      title: string;
      description: string;
      href: string;
      count: number;
    }> = [];

    if (expiringCriticalCount > 0) {
      alerts.push({
        code: "license_expiring_7d",
        severity: "warning",
        title: "7 gün içinde süresi dolacak lisans",
        description: `${expiringCriticalCount} abonelik yakında sona erecek.`,
        href: "/app/admin/abonelikler?status=ACTIVE",
        count: expiringCriticalCount,
      });
    }
    if (expiredButActiveTenants.length > 0) {
      alerts.push({
        code: "expired_active_tenant",
        severity: "danger",
        title: "Süresi dolmuş ama aktif görünen hesap",
        description: `${expiredButActiveTenants.length} organizasyon aktif; lisansı dolmuş.`,
        href: "/app/admin/abonelikler?status=EXPIRED",
        count: expiredButActiveTenants.length,
      });
    }
    if (tenantsWithoutSubscription > 0) {
      alerts.push({
        code: "no_license",
        severity: "warning",
        title: "Lisansı olmayan aktif organizasyon",
        description: `${tenantsWithoutSubscription} aktif organizasyonda abonelik kaydı yok.`,
        href: "/app/admin/tenantlar?filter=aktif",
        count: tenantsWithoutSubscription,
      });
    }
    if (tenantsWithoutUsers > 0) {
      alerts.push({
        code: "no_users",
        severity: "warning",
        title: "Kullanıcısı olmayan organizasyon",
        description: `${tenantsWithoutUsers} organizasyonda üyelik yok.`,
        href: "/app/admin/tenantlar",
        count: tenantsWithoutUsers,
      });
    }
    if (whatsappError > 0) {
      alerts.push({
        code: "integration_error",
        severity: "danger",
        title: "Hata veren entegrasyon",
        description: `${whatsappError} WhatsApp bağlantısı hata durumunda.`,
        href: "/app/admin/entegrasyonlar?status=ERROR",
        count: whatsappError,
      });
    }
    if (failedEmailDeliveries + failedMessagesCount > 0) {
      alerts.push({
        code: "failed_messages",
        severity: "warning",
        title: "Gönderilemeyen mesaj / e-posta",
        description: `${failedEmailDeliveries} e-posta, ${failedMessagesCount} iletişim kaydı başarısız.`,
        href: "/app/admin/iletisim",
        count: failedEmailDeliveries + failedMessagesCount,
      });
    }

    return {
      metrics: {
        totalTenants,
        activeTenants,
        suspendedTenants,
        totalSites,
        totalApartments,
        totalUsers,
        activeUsers,
        inactiveUsers,
        usersActive30d,
        trialSubscriptions,
        activeSubscriptions,
        expiredSubscriptions,
        suspendedSubscriptions,
        whatsappConnected,
        whatsappError,
        expiringSubscriptions: expiringCount,
        expiringCritical7d: expiringCriticalCount,
        tenantsWithoutUsers,
        tenantsWithoutSubscription,
        failedEmailDeliveries,
        failedMessages: failedMessagesCount,
      },
      alerts,
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
      criticalExpiring: criticalExpiring.map((item) => ({
        ...toSubscriptionView(item)!,
        tenant: item.tenant,
      })),
      expiredButActive: expiredButActiveTenants.map((item) => ({
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
