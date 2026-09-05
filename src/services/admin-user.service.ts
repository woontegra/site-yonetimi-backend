import type { MembershipStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ASSIGNABLE_ROLES, isOwnerRole } from "../permissions/catalog";
import { HttpError } from "../utils/httpError";
import { writeAdminAudit } from "./admin-audit.service";
import { toSubscriptionView } from "./admin-serializers";

const OWNER_ROLES: UserRole[] = ["SITE_YONETICISI", "ORGANIZASYON_SAHIBI", "YONETICI"];

function requireReason(reason: string | undefined): string {
  const value = reason?.trim() ?? "";
  if (value.length < 5) {
    throw new HttpError(400, "Gerekçe en az 5 karakter olmalıdır.");
  }
  return value;
}

export class AdminUserService {
  async summary() {
    const [total, active, inactive, trial] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.user.count({
        where: {
          memberships: { some: { tenant: { subscription: { plan: "DEMO" } } } },
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
          isPlatformAdmin: true,
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
          isPlatformAdmin: item.isPlatformAdmin,
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
        isPlatformAdmin: true,
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
            siteAccesses: {
              include: {
                site: {
                  select: {
                    id: true,
                    name: true,
                    isActive: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        },
        activationTokens: {
          where: { usedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, expiresAt: true, createdAt: true },
        },
      },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

    const primary = user.memberships[0] ?? null;
    const tenantId = primary?.tenantId ?? null;

    const [messageCount, activity30d, emailFailCount, pendingInvite] = await Promise.all([
      tenantId
        ? prisma.communicationMessage.count({ where: { tenantId } })
        : Promise.resolve(0),
      prisma.tenantAuditLog.count({
        where: {
          actorUserId: id,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.emailDelivery.count({
        where: { relatedUserId: id, status: "FAILED" },
      }),
      primary?.status === "INVITED"
        ? Promise.resolve(true)
        : Promise.resolve(user.activationTokens.length > 0 && !user.lastLoginAt),
    ]);

    const siteAccessRows = (primary?.siteAccesses ?? [])
      .filter((row) => !row.site.deletedAt)
      .map((row) => ({
        siteId: row.site.id,
        siteName: row.site.name,
        isActive: row.site.isActive,
      }));

    const accessBlocks: string[] = [];
    if (!user.isActive) accessBlocks.push("Hesap pasif — giriş yapamaz.");
    if (primary && primary.status === "DISABLED") {
      accessBlocks.push("Üyelik DISABLED — tenant erişimi kapalı.");
    }
    if (primary && primary.status === "INVITED") {
      accessBlocks.push("Aktivasyon bekleniyor — davet tamamlanmamış.");
    }
    if (pendingInvite && user.isActive) {
      accessBlocks.push("Aktif aktivasyon daveti var — şifre henüz belirlenmemiş olabilir.");
    }
    if (primary && !primary.tenant.isActive) {
      accessBlocks.push("Organizasyon pasif — kullanıcı giriş yapsa da tenant kilitli olabilir.");
    }
    if (primary?.tenant.subscription?.status === "SUSPENDED") {
      accessBlocks.push("Organizasyon lisansı askıda.");
    }
    if (primary?.tenant.subscription?.status === "EXPIRED") {
      accessBlocks.push("Organizasyon lisansının süresi dolmuş.");
    }

    let interventionStatus: "normal" | "passive" | "activation_pending" | "org_blocked" = "normal";
    if (!user.isActive) interventionStatus = "passive";
    else if (primary?.status === "INVITED" || (pendingInvite && !user.lastLoginAt)) {
      interventionStatus = "activation_pending";
    } else if (
      primary &&
      (!primary.tenant.isActive ||
        primary.tenant.subscription?.status === "SUSPENDED" ||
        primary.tenant.subscription?.status === "EXPIRED")
    ) {
      interventionStatus = "org_blocked";
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
      isPlatformAdmin: user.isPlatformAdmin,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      role: primary?.role ?? null,
      membershipStatus: (primary?.status as MembershipStatus | undefined) ?? null,
      activationPending: Boolean(pendingInvite),
      activationExpiresAt: user.activationTokens[0]?.expiresAt.toISOString() ?? null,
      interventionStatus,
      accessBlocks,
      tenant: primary
        ? {
            id: primary.tenant.id,
            name: primary.tenant.name,
            isActive: primary.tenant.isActive,
            siteCount: primary.tenant._count.sites,
          }
        : null,
      subscription: toSubscriptionView(primary?.tenant.subscription ?? null),
      licenseScope: "organization" as const,
      memberships: user.memberships.map((item) => ({
        id: item.id,
        tenantId: item.tenant.id,
        tenantName: item.tenant.name,
        tenantIsActive: item.tenant.isActive,
        role: item.role,
        status: item.status,
        allSites: item.allSites,
        invitedAt: item.invitedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        siteAccesses: item.siteAccesses
          .filter((s) => !s.site.deletedAt)
          .map((s) => ({
            siteId: s.site.id,
            siteName: s.site.name,
            isActive: s.site.isActive,
          })),
      })),
      primaryAccess: primary
        ? {
            membershipId: primary.id,
            allSites: primary.allSites,
            siteCount: primary.allSites
              ? primary.tenant._count.sites
              : siteAccessRows.length,
            sites: primary.allSites ? [] : siteAccessRows,
            primarySiteName: primary.allSites
              ? null
              : siteAccessRows[0]?.siteName ?? null,
          }
        : null,
      usage: {
        tenantSites: primary?.tenant._count.sites ?? 0,
        tenantMessages: messageCount,
        activityLast30d: activity30d,
        failedEmails: emailFailCount,
      },
    };
  }

  async listAccess(userId: string) {
    const detail = await this.getById(userId);
    return {
      memberships: detail.memberships,
      primaryAccess: detail.primaryAccess,
    };
  }

  async listActivity(
    userId: string,
    query: { page: number; perPage: number; search?: string },
  ) {
    await this.assertExists(userId);
    const where: Prisma.TenantAuditLogWhereInput = { actorUserId: userId };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { targetType: { contains: search, mode: "insensitive" } },
      ];
    }
    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.tenantAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          tenantId: true,
          createdAt: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.tenantAuditLog.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        targetType: item.targetType,
        targetId: item.targetId,
        tenantId: item.tenantId,
        tenantName: item.tenant.name,
        createdAt: item.createdAt.toISOString(),
        result: "success" as const,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
      coverageNote:
        "Bu liste kullanıcının tenant audit kayıtlarını gösterir. Tüm modüller audit yazmıyorsa geçmiş eksik olabilir.",
    };
  }

  async listCommunications(
    userId: string,
    query: { page: number; perPage: number },
  ) {
    await this.assertExists(userId);
    const skip = (query.page - 1) * query.perPage;
    const where = { relatedUserId: userId };
    const [items, total] = await prisma.$transaction([
      prisma.emailDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          type: true,
          subject: true,
          status: true,
          recipientEmail: true,
          safeErrorCode: true,
          safeErrorSummary: true,
          createdAt: true,
          sentAt: true,
          attempts: true,
        },
      }),
      prisma.emailDelivery.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        channel: "EMAIL" as const,
        type: item.type,
        subject: item.subject,
        status: item.status,
        recipientEmail: item.recipientEmail,
        errorCode: item.safeErrorCode,
        errorSummary: item.safeErrorSummary,
        createdAt: item.createdAt.toISOString(),
        sentAt: item.sentAt?.toISOString() ?? null,
        attemptCount: item.attempts,
      })),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async listNotes(userId: string) {
    const detail = await this.getById(userId);
    if (!detail.tenant) {
      return {
        items: [] as Array<{
          id: string;
          content: string;
          createdAt: string;
          subjectUserId: string | null;
          adminUser: { id: string; fullName: string; email: string };
        }>,
        scope: "none" as const,
      };
    }
    const items = await prisma.adminNote.findMany({
      where: {
        tenantId: detail.tenant.id,
        deletedAt: null,
        OR: [{ subjectUserId: userId }, { subjectUserId: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        content: true,
        createdAt: true,
        subjectUserId: true,
        adminUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        content: item.content,
        createdAt: item.createdAt.toISOString(),
        subjectUserId: item.subjectUserId,
        adminUser: item.adminUser,
      })),
      scope: "user_and_organization" as const,
      note:
        "Kullanıcıya bağlı notlar ve organizasyon notları gösterilir. Yalnız platform adminler görür.",
    };
  }

  async updateAccess(
    adminUserId: string,
    userId: string,
    input: {
      membershipId: string;
      role?: UserRole;
      allSites?: boolean;
      siteIds?: string[];
    },
  ) {
    const membership = await prisma.membership.findFirst({
      where: { id: input.membershipId, userId },
      include: {
        user: { select: { isPlatformAdmin: true } },
      },
    });
    if (!membership) throw new HttpError(404, "Üyelik bulunamadı.");

    const role = input.role ?? membership.role;
    if (input.role) {
      if (!ASSIGNABLE_ROLES.includes(input.role) && input.role !== "SITE_YONETICISI") {
        throw new HttpError(400, "Geçersiz rol.");
      }
    }

    if (isOwnerRole(membership.role) && input.role && !isOwnerRole(input.role)) {
      const remaining = await prisma.membership.count({
        where: {
          tenantId: membership.tenantId,
          status: { not: "DISABLED" },
          role: { in: OWNER_ROLES },
          id: { not: membership.id },
          user: { isActive: true },
        },
      });
      if (remaining < 1) {
        throw new HttpError(409, "Son organizasyon yöneticisinin rolü düşürülemez.");
      }
    }

    const allSites = input.allSites ?? membership.allSites;
    let siteIds: string[] = [];
    if (!allSites) {
      const requested = input.siteIds ?? [];
      if (requested.length === 0) {
        throw new HttpError(400, "En az bir site seçilmelidir veya tüm siteler erişimi açılmalıdır.");
      }
      const sites = await prisma.site.findMany({
        where: {
          id: { in: requested },
          tenantId: membership.tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (sites.length !== requested.length) {
        throw new HttpError(400, "Yalnız kullanıcının organizasyonuna ait siteler atanabilir.");
      }
      siteIds = sites.map((s) => s.id);
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          role,
          allSites,
          permissionVersion: { increment: 1 },
        },
      });
      await tx.membershipSiteAccess.deleteMany({ where: { membershipId: membership.id } });
      if (siteIds.length > 0) {
        await tx.membershipSiteAccess.createMany({
          data: siteIds.map((siteId) => ({ membershipId: membership.id, siteId })),
        });
      }
    });

    await writeAdminAudit({
      adminUserId,
      action: "user.access.update",
      targetType: "User",
      targetId: userId,
      tenantId: membership.tenantId,
      metadata: { membershipId: membership.id, role, allSites, siteCount: siteIds.length },
    });
    return { ok: true as const };
  }

  async listTenantSitesForUser(userId: string) {
    const detail = await this.getById(userId);
    if (!detail.tenant) return { items: [] as Array<{ id: string; name: string; isActive: boolean }> };
    const items = await prisma.site.findMany({
      where: { tenantId: detail.tenant.id, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    });
    return { items };
  }

  async updateProfile(
    adminUserId: string,
    userId: string,
    input: { fullName: string },
  ) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, memberships: { take: 1, select: { tenantId: true } } },
    });
    if (!existing) throw new HttpError(404, "Kullanıcı bulunamadı.");
    const fullName = input.fullName.trim();
    if (fullName.length < 2) throw new HttpError(400, "Ad soyad en az 2 karakter olmalıdır.");
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { fullName },
      select: { id: true, fullName: true, email: true },
    });
    await writeAdminAudit({
      adminUserId,
      action: "user.update",
      targetType: "User",
      targetId: userId,
      tenantId: existing.memberships[0]?.tenantId ?? null,
      metadata: { previous: existing.fullName, next: fullName },
    });
    return updated;
  }

  async setActive(
    adminUserId: string,
    userId: string,
    isActive: boolean,
    reason?: string,
  ) {
    if (adminUserId === userId && !isActive) {
      throw new HttpError(400, "Kendi hesabınızı pasife alamazsınız.");
    }
    const note = !isActive ? requireReason(reason) : reason?.trim() || undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        isPlatformAdmin: true,
        memberships: {
          select: { tenantId: true, role: true, status: true },
        },
      },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

    if (user.isPlatformAdmin && !isActive) {
      const otherAdmins = await prisma.user.count({
        where: { isPlatformAdmin: true, isActive: true, id: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw new HttpError(
          409,
          "Son platform yöneticisi pasife alınamaz. Önce başka bir platform yöneticisi tanımlayın.",
        );
      }
    }

    if (!isActive) {
      for (const membership of user.memberships) {
        if (!OWNER_ROLES.includes(membership.role)) continue;
        const otherOwners = await prisma.membership.count({
          where: {
            tenantId: membership.tenantId,
            role: { in: OWNER_ROLES },
            status: { not: "DISABLED" },
            user: { isActive: true, id: { not: userId } },
          },
        });
        if (otherOwners === 0) {
          throw new HttpError(
            409,
            "Bu kullanıcı organizasyondaki son aktif yöneticidir. Önce başka bir yönetici atayın.",
          );
        }
      }
    }

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
      metadata: {
        previous: user.isActive,
        next: isActive,
        ...(note ? { reason: note } : {}),
      },
    });
    return updated;
  }

  async deletePreview(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        isPlatformAdmin: true,
        memberships: { select: { tenantId: true } },
      },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

    const [
      tenantAudits,
      adminAudits,
      announcements,
      duesExemptions,
      interestApps,
      paymentsAsNone,
      emailDeliveries,
    ] = await Promise.all([
      prisma.tenantAuditLog.count({ where: { actorUserId: userId } }),
      prisma.adminAuditLog.count({ where: { adminUserId: userId } }),
      prisma.announcement.count({ where: { createdByUserId: userId } }),
      prisma.apartmentDuesExemption.count({
        where: {
          OR: [{ createdByUserId: userId }, { revokedByUserId: userId }],
        },
      }),
      prisma.interestApplication.count({ where: { appliedByUserId: userId } }),
      prisma.membership.count({ where: { userId } }),
      prisma.emailDelivery.count({ where: { relatedUserId: userId } }),
    ]);

    const blockers: string[] = [];
    if (user.isPlatformAdmin) blockers.push("Platform admin hesabı silinemez.");
    if (tenantAudits > 0) blockers.push(`${tenantAudits} tenant işlem kaydı var.`);
    if (adminAudits > 0) blockers.push(`${adminAudits} admin denetim kaydı var.`);
    if (announcements > 0) blockers.push(`${announcements} duyuru kaydı var.`);
    if (duesExemptions > 0) blockers.push("Aidat muafiyet kayıtları var.");
    if (interestApps > 0) blockers.push("Faiz uygulama kayıtları var.");
    if (paymentsAsNone > 0 && (tenantAudits > 0 || announcements > 0 || duesExemptions > 0)) {
      // membership alone shouldn't block if invited-only unused
    }
    if (tenantAudits + announcements + duesExemptions + interestApps + adminAudits > 0) {
      blockers.push("Geçmiş işlem kayıtları bulunduğu için fiziksel silme engellendi. Pasife alın.");
    }

    const canDelete =
      !user.isPlatformAdmin &&
      tenantAudits === 0 &&
      adminAudits === 0 &&
      announcements === 0 &&
      duesExemptions === 0 &&
      interestApps === 0;

    return {
      user: { id: user.id, fullName: user.fullName, email: user.email },
      canDelete,
      blockers: canDelete ? [] : [...new Set(blockers)],
      counts: {
        tenantAudits,
        adminAudits,
        announcements,
        duesExemptions,
        interestApps,
        memberships: paymentsAsNone,
        emailDeliveries,
      },
    };
  }

  async remove(adminUserId: string, userId: string, reason: string) {
    const note = requireReason(reason);
    const preview = await this.deletePreview(userId);
    if (!preview.canDelete) {
      throw new HttpError(
        409,
        preview.blockers[0] ??
          "Bu kullanıcının geçmiş işlem kayıtları bulunduğu için silinemez. Hesabı pasife alabilirsiniz.",
      );
    }
    if (adminUserId === userId) {
      throw new HttpError(400, "Kendi hesabınızı silemezsiniz.");
    }

    const membership = await prisma.membership.findFirst({
      where: { userId },
      select: { tenantId: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.userActivationToken.deleteMany({ where: { userId } });
      await tx.membershipSiteAccess.deleteMany({
        where: { membership: { userId } },
      });
      await tx.membership.deleteMany({ where: { userId } });
      await tx.emailDelivery.updateMany({
        where: { relatedUserId: userId },
        data: { relatedUserId: null },
      });
      await tx.user.delete({ where: { id: userId } });
    });

    await writeAdminAudit({
      adminUserId,
      action: "user.delete",
      targetType: "User",
      targetId: userId,
      tenantId: membership?.tenantId ?? null,
      metadata: { reason: note, email: preview.user.email },
    });
    return { ok: true as const };
  }

  private async assertExists(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");
  }
}

export const adminUserService = new AdminUserService();
