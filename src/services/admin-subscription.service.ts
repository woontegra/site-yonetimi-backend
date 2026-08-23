import type { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { addDays } from "../utils/admin";
import { writeAdminAudit } from "./admin-audit.service";
import { toSubscriptionView } from "./admin-serializers";

export class AdminSubscriptionService {
  async list(query: {
    page: number;
    perPage: number;
    status?: SubscriptionStatus;
    search?: string;
  }) {
    const where: Prisma.SubscriptionWhereInput = {};
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.tenant = { name: { contains: search, mode: "insensitive" } };
    }

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.subscription.findMany({
        where,
        orderBy: { endsAt: "asc" },
        skip,
        take: query.perPage,
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              isActive: true,
              _count: { select: { sites: { where: { deletedAt: null } } } },
            },
          },
        },
      }),
      prisma.subscription.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...toSubscriptionView(item)!,
        tenant: {
          id: item.tenant.id,
          name: item.tenant.name,
          isActive: item.tenant.isActive,
          siteCount: item.tenant._count.sites,
        },
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async changePlan(adminUserId: string, tenantId: string, plan: SubscriptionPlan) {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Abonelik bulunamadı.");
    const saved = await prisma.subscription.update({
      where: { tenantId },
      data: { plan },
    });
    await writeAdminAudit({
      adminUserId,
      action: "subscription.plan_change",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: { previous: existing.plan, next: plan },
    });
    return toSubscriptionView(saved);
  }

  async setStatus(adminUserId: string, tenantId: string, status: "SUSPENDED" | "ACTIVE") {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Abonelik bulunamadı.");

    const nextStatus: SubscriptionStatus =
      status === "SUSPENDED"
        ? "SUSPENDED"
        : existing.endsAt < new Date()
          ? "EXPIRED"
          : existing.trialEndsAt && existing.trialEndsAt > new Date()
            ? "TRIAL"
            : "ACTIVE";

    const saved = await prisma.subscription.update({
      where: { tenantId },
      data: {
        status: nextStatus,
        cancelledAt: status === "SUSPENDED" ? existing.cancelledAt : null,
      },
    });
    await writeAdminAudit({
      adminUserId,
      action: status === "SUSPENDED" ? "subscription.suspend" : "subscription.reactivate",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: { previous: existing.status, next: nextStatus },
    });
    return toSubscriptionView(saved);
  }

  async setEndsAt(adminUserId: string, tenantId: string, endsAt: Date) {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Abonelik bulunamadı.");
    const saved = await prisma.subscription.update({
      where: { tenantId },
      data: {
        endsAt,
        status: existing.status === "SUSPENDED" ? "SUSPENDED" : endsAt > new Date() ? existing.status === "TRIAL" ? "TRIAL" : "ACTIVE" : "EXPIRED",
      },
    });
    await writeAdminAudit({
      adminUserId,
      action: "subscription.extend",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: {
        previousEndsAt: existing.endsAt.toISOString(),
        nextEndsAt: endsAt.toISOString(),
      },
    });
    return toSubscriptionView(saved);
  }

  extendDays(adminUserId: string, tenantId: string, days: number) {
    return this.extendFromNow(adminUserId, tenantId, days);
  }

  private async extendFromNow(adminUserId: string, tenantId: string, days: number) {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    const now = new Date();
    const base = existing && existing.endsAt > now ? existing.endsAt : now;
    const endsAt = addDays(base, days);
    if (!existing) {
      const saved = await prisma.subscription.create({
        data: {
          tenantId,
          plan: "DEMO",
          status: "TRIAL",
          startsAt: now,
          endsAt,
          trialEndsAt: endsAt,
        },
      });
      await writeAdminAudit({
        adminUserId,
        action: "subscription.extend",
        targetType: "Subscription",
        targetId: saved.id,
        tenantId,
        metadata: { days, created: true, nextEndsAt: endsAt.toISOString() },
      });
      return toSubscriptionView(saved);
    }
    return this.setEndsAt(adminUserId, tenantId, endsAt);
  }
}

export const adminSubscriptionService = new AdminSubscriptionService();
