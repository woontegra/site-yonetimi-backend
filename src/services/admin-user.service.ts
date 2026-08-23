import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { writeAdminAudit } from "./admin-audit.service";
import { toSubscriptionView } from "./admin-serializers";

export class AdminUserService {
  async summary() {
    const [total, active, inactive, trial] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.user.count({
        where: {
          memberships: { some: { tenant: { subscription: { status: "TRIAL" } } } },
        },
      }),
    ]);
    return { total, active, inactive, trial };
  }

  async list(query: {
    page: number;
    perPage: number;
    search?: string;
    status?: "aktif" | "pasif";
    tenantId?: string;
  }) {
    const where: Prisma.UserWhereInput = {};
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;
    if (query.tenantId) where.memberships = { some: { tenantId: query.tenantId } };

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          memberships: {
            orderBy: { createdAt: "asc" },
            include: {
              tenant: {
                select: {
                  id: true,
                  name: true,
                  isActive: true,
                  subscription: true,
                },
              },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      items: items.map((item) => {
        const primary = item.memberships[0] ?? null;
        return {
          id: item.id,
          fullName: item.fullName,
          email: item.email,
          isActive: item.isActive,
          lastLoginAt: item.lastLoginAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          role: primary?.role ?? null,
          tenant: primary
            ? { id: primary.tenant.id, name: primary.tenant.name, isActive: primary.tenant.isActive }
            : null,
          subscription: toSubscriptionView(primary?.tenant.subscription ?? null),
        };
      }),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                isActive: true,
                subscription: true,
                _count: { select: { sites: { where: { deletedAt: null } } } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

    const primary = user.memberships[0] ?? null;
    const messageCount = primary
      ? await prisma.communicationMessage.count({ where: { tenantId: primary.tenantId } })
      : 0;

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      role: primary?.role ?? null,
      tenant: primary
        ? {
            id: primary.tenant.id,
            name: primary.tenant.name,
            isActive: primary.tenant.isActive,
            siteCount: primary.tenant._count.sites,
          }
        : null,
      subscription: toSubscriptionView(primary?.tenant.subscription ?? null),
      memberships: user.memberships.map((item) => ({
        tenantId: item.tenant.id,
        tenantName: item.tenant.name,
        role: item.role,
      })),
      usage: {
        sites: primary?.tenant._count.sites ?? 0,
        messages: messageCount,
      },
    };
  }

  async setActive(adminUserId: string, userId: string, isActive: boolean) {
    if (adminUserId === userId && !isActive) {
      throw new HttpError(400, "Kendi hesabınızı pasife alamazsınız.");
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, isPlatformAdmin: true, memberships: { take: 1 } },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
    await writeAdminAudit({
      adminUserId,
      action: isActive ? "user.activate" : "user.deactivate",
      targetType: "User",
      targetId: userId,
      tenantId: user.memberships[0]?.tenantId ?? null,
      metadata: { previous: user.isActive, next: isActive },
    });
    return updated;
  }
}

export const adminUserService = new AdminUserService();
