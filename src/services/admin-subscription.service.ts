import type { Prisma, Subscription, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { LICENSE_ANNUAL_DAYS, LICENSE_DEMO_DAYS } from "../config/license.config";
import { HttpError } from "../utils/httpError";
import { writeAdminAudit } from "./admin-audit.service";
import {
  assertLicenseVersion,
  priceForPlan,
  toLicenseView,
  addCalendarDaysEndOfDay,
  extendBaseDate,
  endOfDayFrom,
  resolveEffectiveStatus,
} from "./entitlement.service";

function assertOptimistic(count: number) {
  if (count === 0) {
    throw new HttpError(
      409,
      "Lisans ön izlemeden sonra değişti. Bilgileri yenileyin.",
      "LICENSE_VERSION_CONFLICT",
    );
  }
}

function requireReason(reason: string | undefined): string {
  const value = reason?.trim() ?? "";
  if (value.length < 5) {
    throw new HttpError(400, "Gerekçe en az 5 karakter olmalıdır.");
  }
  return value;
}

function snapshotOf(sub: Subscription) {
  return {
    plan: sub.plan,
    status: sub.status,
    startsAt: sub.startsAt.toISOString(),
    endsAt: sub.endsAt.toISOString(),
    netPrice: Number(sub.netPrice),
    vatRate: Number(sub.vatRate),
    vatAmount: Number(sub.vatAmount),
    grossPrice: Number(sub.grossPrice),
    currency: sub.currency,
    version: sub.version,
  };
}

async function writeHistory(input: {
  tx?: Prisma.TransactionClient;
  subscriptionId: string;
  tenantId: string;
  action: string;
  previousValues: unknown;
  newValues: unknown;
  reason: string;
  performedById: string;
  price?: { netPrice: number; vatRate: number; vatAmount: number; grossPrice: number; currency: string };
}) {
  const db = input.tx ?? prisma;
  await db.subscriptionHistory.create({
    data: {
      subscriptionId: input.subscriptionId,
      tenantId: input.tenantId,
      action: input.action,
      previousValues: input.previousValues as Prisma.InputJsonValue,
      newValues: input.newValues as Prisma.InputJsonValue,
      reason: input.reason,
      performedById: input.performedById,
      netPrice: input.price?.netPrice,
      vatRate: input.price?.vatRate,
      vatAmount: input.price?.vatAmount,
      grossPrice: input.price?.grossPrice,
      currency: input.price?.currency ?? "TRY",
    },
  });
}

export class AdminSubscriptionService {
  async summary() {
    const now = new Date();
    const in30 = addCalendarDaysEndOfDay(now, 30);
    const [total, activeDemo, activeAnnual, expiringSoon, expired, suspended, cancelled, tenants, withSub] =
      await Promise.all([
        prisma.subscription.count(),
        prisma.subscription.count({
          where: { plan: "DEMO", status: { notIn: ["SUSPENDED", "CANCELLED"] }, endsAt: { gt: now } },
        }),
        prisma.subscription.count({
          where: { plan: "ANNUAL", status: { notIn: ["SUSPENDED", "CANCELLED"] }, endsAt: { gt: now } },
        }),
        prisma.subscription.count({
          where: {
            status: { notIn: ["SUSPENDED", "CANCELLED"] },
            endsAt: { gt: now, lte: in30 },
          },
        }),
        prisma.subscription.count({
          where: {
            OR: [
              { status: "EXPIRED" },
              { status: { in: ["ACTIVE"] }, endsAt: { lte: now } },
            ],
          },
        }),
        prisma.subscription.count({ where: { status: "SUSPENDED" } }),
        prisma.subscription.count({ where: { status: "CANCELLED" } }),
        prisma.tenant.count(),
        prisma.subscription.count(),
      ]);
    return {
      total,
      activeDemo,
      activeAnnual,
      expiringSoon,
      expired,
      suspended,
      cancelled,
      withoutLicense: Math.max(0, tenants - withSub),
    };
  }

  async list(query: {
    page: number;
    perPage: number;
    status?: SubscriptionStatus | "EXPIRING" | "NONE";
    plan?: SubscriptionPlan;
    search?: string;
    from?: Date;
    to?: Date;
  }) {
    if (query.status === "NONE") {
      const where: Prisma.TenantWhereInput = { subscription: null };
      const search = query.search?.trim();
      if (search) where.name = { contains: search, mode: "insensitive" };
      const skip = (query.page - 1) * query.perPage;
      const [items, total] = await prisma.$transaction([
        prisma.tenant.findMany({
          where,
          orderBy: { name: "asc" },
          skip,
          take: query.perPage,
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: { select: { sites: { where: { deletedAt: null } }, memberships: true } },
          },
        }),
        prisma.tenant.count({ where }),
      ]);
      return {
        items: items.map((t) => ({
          id: null as string | null,
          tenant: {
            id: t.id,
            name: t.name,
            isActive: t.isActive,
            siteCount: t._count.sites,
            userCount: t._count.memberships,
          },
          subscription: null,
        })),
        page: query.page,
        perPage: query.perPage,
        total,
      };
    }

    const where: Prisma.SubscriptionWhereInput = {};
    if (query.plan) where.plan = query.plan;
    const now = new Date();
    if (query.status === "EXPIRING") {
      where.status = { notIn: ["SUSPENDED", "CANCELLED"] };
      where.endsAt = { gt: now, lte: addCalendarDaysEndOfDay(now, 30) };
    } else if (query.status === "EXPIRED") {
      where.OR = [{ status: "EXPIRED" }, { status: "ACTIVE", endsAt: { lte: now } }];
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.from || query.to) {
      where.endsAt = {
        ...(typeof where.endsAt === "object" && where.endsAt ? where.endsAt : {}),
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    const search = query.search?.trim();
    if (search) where.tenant = { name: { contains: search, mode: "insensitive" } };

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
              _count: { select: { sites: { where: { deletedAt: null } }, memberships: true } },
            },
          },
          history: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { performedBy: { select: { id: true, fullName: true, email: true } } },
          },
        },
      }),
      prisma.subscription.count({ where }),
    ]);

    return {
      items: items.map((item) => {
        const last = item.history[0] ?? null;
        return {
          ...toLicenseView(item),
          tenant: {
            id: item.tenant.id,
            name: item.tenant.name,
            isActive: item.tenant.isActive,
            siteCount: item.tenant._count.sites,
            userCount: item.tenant._count.memberships,
          },
          lastAction: last
            ? {
                action: last.action,
                createdAt: last.createdAt.toISOString(),
                performedBy: last.performedBy,
                reason: last.reason,
              }
            : null,
        };
      }),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getByTenantId(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        _count: { select: { sites: { where: { deletedAt: null } }, memberships: true } },
        subscription: true,
      },
    });
    if (!tenant) throw new HttpError(404, "Organizasyon bulunamadı.");
    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt.toISOString(),
        siteCount: tenant._count.sites,
        userCount: tenant._count.memberships,
      },
      subscription: tenant.subscription ? toLicenseView(tenant.subscription) : null,
    };
  }

  async listHistory(tenantId: string, query: { page: number; perPage: number }) {
    const skip = (query.page - 1) * query.perPage;
    const where = { tenantId };
    const [items, total] = await prisma.$transaction([
      prisma.subscriptionHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        include: { performedBy: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.subscriptionHistory.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        previousValues: item.previousValues,
        newValues: item.newValues,
        reason: item.reason,
        netPrice: item.netPrice != null ? Number(item.netPrice) : null,
        vatRate: item.vatRate != null ? Number(item.vatRate) : null,
        vatAmount: item.vatAmount != null ? Number(item.vatAmount) : null,
        grossPrice: item.grossPrice != null ? Number(item.grossPrice) : null,
        currency: item.currency,
        createdAt: item.createdAt.toISOString(),
        performedBy: item.performedBy,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async startDemo(
    adminUserId: string,
    tenantId: string,
    input: { days?: number; startsAt?: Date; reason: string; expectedVersion?: number },
  ) {
    const reason = requireReason(input.reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (existing && resolveEffectiveStatus(existing) === "ACTIVE") {
      throw new HttpError(409, "Organizasyonun zaten aktif bir lisansı bulunuyor.");
    }
    const days = input.days ?? LICENSE_DEMO_DAYS;
    const startsAt = input.startsAt ?? new Date();
    const endsAt = addCalendarDaysEndOfDay(startsAt, days);
    const price = priceForPlan("DEMO");

    const saved = await prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.subscription.update({
            where: { tenantId },
            data: {
              plan: "DEMO",
              status: "ACTIVE",
              startsAt,
              endsAt,
              ...price,
              activatedAt: startsAt,
              suspendedAt: null,
              cancelledAt: null,
              version: { increment: 1 },
              lastModifiedByPlatformAdminId: adminUserId,
              createdByPlatformAdminId: existing.createdByPlatformAdminId ?? adminUserId,
            },
          })
        : await tx.subscription.create({
            data: {
              tenantId,
              plan: "DEMO",
              status: "ACTIVE",
              startsAt,
              endsAt,
              ...price,
              activatedAt: startsAt,
              createdByPlatformAdminId: adminUserId,
              lastModifiedByPlatformAdminId: adminUserId,
            },
          });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "DEMO_STARTED",
        previousValues: existing ? snapshotOf(existing) : null,
        newValues: snapshotOf(row),
        reason,
        performedById: adminUserId,
        price,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action: "subscription.demo_start",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: { days, endsAt: endsAt.toISOString(), reason },
    });
    return toLicenseView(saved);
  }

  async extendDemo(
    adminUserId: string,
    tenantId: string,
    input: { days: number; reason: string; expectedVersion?: number; expectedUpdatedAt?: string },
  ) {
    const reason = requireReason(input.reason);
    if (input.days < 1 || input.days > 365) {
      throw new HttpError(400, "Gün sayısı 1–365 arasında olmalıdır.");
    }
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Lisans bulunamadı.");
    if (existing.plan !== "DEMO") {
      throw new HttpError(400, "Yalnız demo lisansına gün eklenebilir.");
    }
    if (existing.status === "CANCELLED") {
      throw new HttpError(400, "İptal edilmiş lisans uzatılamaz. Önce yeniden etkinleştirin.");
    }
    assertLicenseVersion(existing, {
      version: input.expectedVersion,
      updatedAt: input.expectedUpdatedAt,
    });

    const now = new Date();
    const previousEndsAt = existing.endsAt;
    const base = extendBaseDate(existing.endsAt, now);
    const endsAt = addCalendarDaysEndOfDay(base, input.days);
    const price = priceForPlan("DEMO");

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { tenantId, version: existing.version },
        data: {
          endsAt,
          status: "ACTIVE",
          suspendedAt: null,
          version: { increment: 1 },
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      assertOptimistic(updated.count);
      const row = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "DEMO_EXTENDED",
        previousValues: snapshotOf(existing),
        newValues: snapshotOf(row),
        reason,
        performedById: adminUserId,
        price,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action: "subscription.extend",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: {
        days: input.days,
        previousEndsAt: previousEndsAt.toISOString(),
        nextEndsAt: endsAt.toISOString(),
        reason,
      },
    });
    return toLicenseView(saved);
  }

  async convertToAnnual(
    adminUserId: string,
    tenantId: string,
    input: {
      reason: string;
      netPrice?: number;
      expectedVersion?: number;
      expectedUpdatedAt?: string;
      paymentNote?: "PAID" | "PENDING" | "COMPLIMENTARY";
    },
  ) {
    const reason = requireReason(input.reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Lisans bulunamadı.");
    if (existing.plan === "ANNUAL" && resolveEffectiveStatus(existing) === "ACTIVE") {
      throw new HttpError(409, "Organizasyonun zaten aktif bir yıllık lisansı bulunuyor.");
    }
    assertLicenseVersion(existing, {
      version: input.expectedVersion,
      updatedAt: input.expectedUpdatedAt,
    });

    const now = new Date();
    const price =
      input.netPrice != null && input.netPrice !== priceForPlan("ANNUAL").netPrice
        ? (() => {
            requireReason(reason);
            return priceForPlan("ANNUAL", input.netPrice);
          })()
        : priceForPlan("ANNUAL", input.netPrice);

    if (input.netPrice != null && input.netPrice !== priceForPlan("ANNUAL").netPrice) {
      // custom price already has reason
    }

    const startsAt = now;
    const base =
      existing.plan === "DEMO" && existing.endsAt.getTime() > now.getTime()
        ? existing.endsAt
        : now;
    const endsAt = addCalendarDaysEndOfDay(base, LICENSE_ANNUAL_DAYS);

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { tenantId, version: existing.version },
        data: {
          plan: "ANNUAL",
          status: "ACTIVE",
          startsAt,
          endsAt,
          ...price,
          activatedAt: startsAt,
          suspendedAt: null,
          cancelledAt: null,
          version: { increment: 1 },
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      assertOptimistic(updated.count);
      const row = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "CONVERT_TRIAL_TO_ANNUAL",
        previousValues: snapshotOf(existing),
        newValues: { ...snapshotOf(row), paymentNote: input.paymentNote ?? null },
        reason,
        performedById: adminUserId,
        price,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action: "subscription.convert_annual",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: {
        previousEndsAt: existing.endsAt.toISOString(),
        nextEndsAt: endsAt.toISOString(),
        price,
        reason,
        paymentNote: input.paymentNote ?? null,
      },
    });
    return toLicenseView(saved);
  }

  async startAnnual(
    adminUserId: string,
    tenantId: string,
    input: {
      reason: string;
      startsAt?: Date;
      endsAt?: Date;
      netPrice?: number;
      paymentNote?: "PAID" | "PENDING" | "COMPLIMENTARY";
    },
  ) {
    const reason = requireReason(input.reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (existing && resolveEffectiveStatus(existing) === "ACTIVE") {
      throw new HttpError(409, "Organizasyonun zaten aktif bir lisansı bulunuyor.");
    }
    const startsAt = input.startsAt ?? new Date();
    const endsAt = input.endsAt
      ? endOfDayFrom(input.endsAt)
      : addCalendarDaysEndOfDay(startsAt, LICENSE_ANNUAL_DAYS);
    const price = priceForPlan("ANNUAL", input.netPrice);

    const saved = await prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.subscription.update({
            where: { tenantId },
            data: {
              plan: "ANNUAL",
              status: "ACTIVE",
              startsAt,
              endsAt,
              ...price,
              activatedAt: startsAt,
              suspendedAt: null,
              cancelledAt: null,
              version: { increment: 1 },
              lastModifiedByPlatformAdminId: adminUserId,
            },
          })
        : await tx.subscription.create({
            data: {
              tenantId,
              plan: "ANNUAL",
              status: "ACTIVE",
              startsAt,
              endsAt,
              ...price,
              activatedAt: startsAt,
              createdByPlatformAdminId: adminUserId,
              lastModifiedByPlatformAdminId: adminUserId,
            },
          });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "ANNUAL_STARTED",
        previousValues: existing ? snapshotOf(existing) : null,
        newValues: { ...snapshotOf(row), paymentNote: input.paymentNote ?? null },
        reason,
        performedById: adminUserId,
        price,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action: "subscription.annual_start",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: { endsAt: endsAt.toISOString(), price, reason },
    });
    return toLicenseView(saved);
  }

  async renewAnnual(
    adminUserId: string,
    tenantId: string,
    input: {
      reason: string;
      expectedVersion?: number;
      expectedUpdatedAt?: string;
      paymentNote?: "PAID" | "PENDING" | "COMPLIMENTARY";
    },
  ) {
    const reason = requireReason(input.reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Lisans bulunamadı.");
    if (existing.plan !== "ANNUAL") {
      throw new HttpError(400, "Yalnız yıllık lisans yenilenebilir.");
    }
    if (existing.status === "SUSPENDED") {
      throw new HttpError(400, "Askıdaki lisans yenilenemez. Önce askıyı kaldırın.");
    }
    if (existing.status === "CANCELLED") {
      throw new HttpError(400, "İptal edilmiş lisans sessizce yenilenemez. Yeniden etkinleştirin.");
    }
    assertLicenseVersion(existing, {
      version: input.expectedVersion,
      updatedAt: input.expectedUpdatedAt,
    });

    const now = new Date();
    const previousEndsAt = existing.endsAt;
    const base = extendBaseDate(existing.endsAt, now);
    const endsAt = addCalendarDaysEndOfDay(base, LICENSE_ANNUAL_DAYS);
    const price = {
      netPrice: Number(existing.netPrice) || priceForPlan("ANNUAL").netPrice,
      vatRate: Number(existing.vatRate) || priceForPlan("ANNUAL").vatRate,
      vatAmount: Number(existing.vatAmount) || priceForPlan("ANNUAL").vatAmount,
      grossPrice: Number(existing.grossPrice) || priceForPlan("ANNUAL").grossPrice,
      currency: existing.currency || "TRY",
    };

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { tenantId, version: existing.version },
        data: {
          endsAt,
          status: "ACTIVE",
          version: { increment: 1 },
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      assertOptimistic(updated.count);
      const row = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "ANNUAL_RENEWED",
        previousValues: snapshotOf(existing),
        newValues: { ...snapshotOf(row), paymentNote: input.paymentNote ?? null },
        reason,
        performedById: adminUserId,
        price,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action: "subscription.renew",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: {
        previousEndsAt: previousEndsAt.toISOString(),
        nextEndsAt: endsAt.toISOString(),
        price,
        reason,
      },
    });
    return toLicenseView(saved);
  }

  async setCustomEndsAt(
    adminUserId: string,
    tenantId: string,
    endsAtInput: Date,
    reason: string,
    expected?: { version?: number; updatedAt?: string },
  ) {
    const note = requireReason(reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Lisans bulunamadı.");
    assertLicenseVersion(existing, expected);
    const endsAt = endOfDayFrom(endsAtInput);
    const nextStatus: SubscriptionStatus =
      existing.status === "SUSPENDED"
        ? "SUSPENDED"
        : existing.status === "CANCELLED"
          ? "CANCELLED"
          : endsAt.getTime() > Date.now()
            ? "ACTIVE"
            : "EXPIRED";

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { tenantId, version: existing.version },
        data: {
          endsAt,
          status: nextStatus,
          version: { increment: 1 },
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      assertOptimistic(updated.count);
      const row = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action: "CUSTOM_ENDS_AT",
        previousValues: snapshotOf(existing),
        newValues: snapshotOf(row),
        reason: note,
        performedById: adminUserId,
      });
      return row;
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
        reason: note,
      },
    });
    return toLicenseView(saved);
  }

  async setStatus(
    adminUserId: string,
    tenantId: string,
    status: "SUSPENDED" | "ACTIVE" | "CANCELLED",
    reason: string,
  ) {
    const note = requireReason(reason);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!existing) throw new HttpError(404, "Lisans bulunamadı.");

    let nextStatus: SubscriptionStatus = status;
    if (status === "ACTIVE") {
      nextStatus = existing.endsAt.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
    }

    const saved = await prisma.$transaction(async (tx) => {
      const row = await tx.subscription.update({
        where: { tenantId },
        data: {
          status: nextStatus,
          suspendedAt: status === "SUSPENDED" ? new Date() : null,
          cancelledAt: status === "CANCELLED" ? new Date() : status === "ACTIVE" ? null : existing.cancelledAt,
          version: { increment: 1 },
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      await writeHistory({
        tx,
        subscriptionId: row.id,
        tenantId,
        action:
          status === "SUSPENDED"
            ? "SUSPENDED"
            : status === "CANCELLED"
              ? "CANCELLED"
              : "REACTIVATED",
        previousValues: snapshotOf(existing),
        newValues: snapshotOf(row),
        reason: note,
        performedById: adminUserId,
      });
      return row;
    });

    await writeAdminAudit({
      adminUserId,
      action:
        status === "SUSPENDED"
          ? "subscription.suspend"
          : status === "CANCELLED"
            ? "subscription.cancel"
            : "subscription.reactivate",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: { previous: existing.status, next: nextStatus, reason: note },
    });
    return toLicenseView(saved);
  }

  /** Geriye dönük: plan değişimi yalnız DEMO↔ANNUAL dönüşümlerine yönlendirir. */
  async changePlan(adminUserId: string, tenantId: string, plan: SubscriptionPlan, reason: string) {
    if (plan === "ANNUAL") {
      return this.convertToAnnual(adminUserId, tenantId, { reason });
    }
    return this.startDemo(adminUserId, tenantId, { reason, days: LICENSE_DEMO_DAYS });
  }

  async setEndsAt(adminUserId: string, tenantId: string, endsAt: Date, reason: string) {
    return this.setCustomEndsAt(adminUserId, tenantId, endsAt, reason);
  }

  extendDays(adminUserId: string, tenantId: string, days: number, reason: string) {
    return this.extendDemo(adminUserId, tenantId, { days, reason });
  }
}

export const adminSubscriptionService = new AdminSubscriptionService();
