import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  ASSIGNABLE_ROLES,
  defaultPermissionsForRole,
  effectivePermissions,
  isOwnerRole,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  sanitizePermissions,
  VIEW_OF,
  type PermissionCode,
} from "../permissions/catalog";
import { ACTIVATION_TTL_HOURS, issueActivationToken } from "./email/activation-token.service";
import { recordFailedDelivery, serializeDelivery } from "./email/email-delivery.service";
import { publicActivationHref, publicAppHref } from "./email/mail-provider";
import { EMAIL_ERROR_MESSAGES } from "./email/mail.types";
import { platformEmailService } from "./email/platform-email.service";
import { renderTenantWelcomeEmail } from "./email/templates";
import { writeTenantAudit } from "./tenant-audit.service";
import { HttpError } from "../utils/httpError";
import { assertRateLimit } from "../utils/rate-limit";

const OWNER_ROLES: UserRole[] = ["ORGANIZASYON_SAHIBI", "SITE_YONETICISI"];

function asPermissionList(value: unknown): PermissionCode[] {
  return sanitizePermissions(value);
}

async function countActiveOwners(tenantId: string, exceptMembershipId?: string) {
  return prisma.membership.count({
    where: {
      tenantId,
      status: "ACTIVE",
      role: { in: OWNER_ROLES },
      ...(exceptMembershipId ? { id: { not: exceptMembershipId } } : {}),
    },
  });
}

async function sendInviteMail(input: {
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  tenantName: string;
}) {
  assertRateLimit(`tenant-invite:${input.userId}`, 5, 15 * 60 * 1000);
  const originOk = Boolean(publicAppHref("/"));
  if (!originOk) {
    const failed = await recordFailedDelivery({
      type: "TENANT_WELCOME_ACTIVATION",
      recipientEmail: input.email,
      recipientName: input.fullName,
      subject: "Site Yönetimi hesabınız oluşturuldu",
      relatedTenantId: input.tenantId,
      relatedUserId: input.userId,
      safeErrorCode: "PUBLIC_APP_URL_MISSING",
      safeErrorSummary: EMAIL_ERROR_MESSAGES.PUBLIC_APP_URL_MISSING,
    });
    return serializeDelivery(failed);
  }
  const issued = await issueActivationToken(input.userId);
  const activationUrl = publicActivationHref(issued.raw);
  if (!activationUrl) {
    const failed = await recordFailedDelivery({
      type: "TENANT_WELCOME_ACTIVATION",
      recipientEmail: input.email,
      recipientName: input.fullName,
      subject: "Site Yönetimi hesabınız oluşturuldu",
      relatedTenantId: input.tenantId,
      relatedUserId: input.userId,
      safeErrorCode: "PUBLIC_APP_URL_MISSING",
      safeErrorSummary: EMAIL_ERROR_MESSAGES.PUBLIC_APP_URL_MISSING,
    });
    return serializeDelivery(failed);
  }
  const integration = await platformEmailService.getSafe();
  const rendered = renderTenantWelcomeEmail({
    managerName: input.fullName,
    tenantName: input.tenantName,
    activationUrl,
    expiresHours: ACTIVATION_TTL_HOURS,
    planLabel: null,
    supportEmail: integration?.replyToEmail || integration?.notificationEmail || null,
  });
  const delivery = await platformEmailService.dispatch({
    type: "TENANT_WELCOME_ACTIVATION",
    to: input.email,
    toName: input.fullName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    relatedTenantId: input.tenantId,
    relatedUserId: input.userId,
  });
  return serializeDelivery(delivery);
}

function serializeMember(
  membership: {
    id: string;
    role: UserRole;
    status: "INVITED" | "ACTIVE" | "DISABLED";
    allSites: boolean;
    permissions: unknown;
    invitedAt: Date | null;
    createdAt: Date;
    user: {
      id: string;
      fullName: string;
      email: string;
      isActive: boolean;
      lastLoginAt: Date | null;
    };
    siteAccesses: Array<{ site: { id: string; name: string } }>;
    activationExpiresAt?: Date | null;
  },
) {
  let displayStatus: "INVITED" | "ACTIVE" | "DISABLED" | "EXPIRED" = membership.status;
  if (membership.status === "INVITED" && membership.activationExpiresAt && membership.activationExpiresAt.getTime() < Date.now()) {
    displayStatus = "EXPIRED";
  }
  return {
    id: membership.id,
    userId: membership.user.id,
    fullName: membership.user.fullName,
    email: membership.user.email,
    role: membership.role,
    roleLabel: ROLE_LABELS[membership.role],
    status: displayStatus,
    allSites: membership.allSites,
    siteIds: membership.allSites ? null : membership.siteAccesses.map((item) => item.site.id),
    siteNames: membership.allSites ? [] : membership.siteAccesses.map((item) => item.site.name),
    permissions: effectivePermissions(membership.role, membership.permissions),
    lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
    invitedAt: membership.invitedAt?.toISOString() ?? membership.createdAt.toISOString(),
    createdAt: membership.createdAt.toISOString(),
  };
}

export class TenantUserService {
  catalog() {
    return {
      roles: ASSIGNABLE_ROLES.map((role) => ({
        value: role,
        label: ROLE_LABELS[role],
        permissions: defaultPermissionsForRole(role),
      })),
      groups: PERMISSION_GROUPS,
      viewOf: VIEW_OF,
    };
  }

  async list(tenantId: string) {
    const memberships = await prisma.membership.findMany({
      where: { tenantId },
      include: {
        user: true,
        siteAccesses: { include: { site: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    const tokens = await prisma.userActivationToken.findMany({
      where: {
        userId: { in: memberships.map((item) => item.userId) },
        usedAt: null,
      },
      select: { userId: true, expiresAt: true },
    });
    const expiryByUser = new Map(tokens.map((item) => [item.userId, item.expiresAt]));
    const items = memberships.map((item) =>
      serializeMember({
        ...item,
        activationExpiresAt: expiryByUser.get(item.userId) ?? null,
      }),
    );
    return {
      summary: {
        total: items.length,
        active: items.filter((item) => item.status === "ACTIVE").length,
        invited: items.filter((item) => item.status === "INVITED" || item.status === "EXPIRED").length,
        disabled: items.filter((item) => item.status === "DISABLED").length,
      },
      items,
    };
  }

  async invite(
    actor: { userId: string; role: UserRole; permissions: string[] },
    tenantId: string,
    input: {
      fullName: string;
      email: string;
      role: UserRole;
      allSites: boolean;
      siteIds: string[];
      permissions: string[];
    },
  ) {
    if (!actor.permissions.includes("users.invite") && !actor.permissions.includes("users.manage")) {
      throw new HttpError(403, "Kullanıcı davet etme yetkiniz yok.");
    }
    if (!ASSIGNABLE_ROLES.includes(input.role) && input.role !== "SITE_YONETICISI") {
      throw new HttpError(400, "Geçersiz rol.");
    }
    if (isOwnerRole(input.role) && !isOwnerRole(actor.role)) {
      throw new HttpError(403, "Organizasyon sahibi yalnızca mevcut sahip tarafından atanabilir.");
    }

    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!fullName || !email) throw new HttpError(400, "Ad soyad ve e-posta gerekli.");

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: existingUser.id, tenantId } },
      });
      if (existingMembership) {
        throw new HttpError(400, "Bu e-posta bu hesapta zaten kayıtlı.");
      }
    }

    const permissions = isOwnerRole(input.role) ? [] : sanitizePermissions(input.permissions);
    if (!isOwnerRole(actor.role)) {
      for (const code of permissions) {
        if (!actor.permissions.includes(code)) {
          throw new HttpError(403, "Sahip olmadığınız bir yetkiyi başkasına veremezsiniz.");
        }
      }
    }
    const siteIds = input.allSites ? [] : await this.assertSites(tenantId, input.siteIds);

    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const created = await prisma.$transaction(async (tx) => {
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            fullName,
            passwordHash,
            isActive: false,
          },
        }));
      if (existingUser && existingUser.fullName !== fullName && !existingUser.isActive) {
        await tx.user.update({ where: { id: user.id }, data: { fullName } });
      }
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId,
          role: input.role,
          status: existingUser?.isActive ? "ACTIVE" : "INVITED",
          allSites: input.allSites,
          permissions,
          invitedAt: new Date(),
          siteAccesses: siteIds.length
            ? { create: siteIds.map((siteId) => ({ siteId })) }
            : undefined,
        },
      });
      return { user, membership };
    });

    let invite = null;
    if (!created.user.isActive) {
      invite = await sendInviteMail({
        userId: created.user.id,
        email,
        fullName: created.user.fullName,
        tenantId,
        tenantName: tenant.name,
      });
    }

    await writeTenantAudit({
      tenantId,
      actorUserId: actor.userId,
      action: "user.invited",
      targetType: "Membership",
      targetId: created.membership.id,
      metadata: {
        role: input.role,
        emailMasked: email.replace(/(^.).*(@.*$)/, "$1***$2"),
        inviteStatus: invite?.status ?? "SKIPPED_ACTIVE_USER",
      },
    });

    return {
      membershipId: created.membership.id,
      existingUser: Boolean(existingUser),
      invite,
    };
  }

  async resendInvite(actorUserId: string, tenantId: string, membershipId: string) {
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      include: { user: true, tenant: true },
    });
    if (!membership) throw new HttpError(404, "Üyelik bulunamadı.");
    if (membership.user.isActive && membership.status === "ACTIVE") {
      throw new HttpError(400, "Bu kullanıcı hesabını zaten etkinleştirmiş.");
    }
    const invite = await sendInviteMail({
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      tenantId,
      tenantName: membership.tenant.name,
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { invitedAt: new Date(), status: "INVITED" },
    });
    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "user.invite.resent",
      targetType: "Membership",
      targetId: membership.id,
      metadata: { inviteStatus: invite.status },
    });
    return { invite };
  }

  async update(
    actor: { userId: string; role: UserRole; permissions: string[] },
    tenantId: string,
    membershipId: string,
    input: {
      role?: UserRole;
      allSites?: boolean;
      siteIds?: string[];
      permissions?: string[];
    },
  ) {
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw new HttpError(404, "Üyelik bulunamadı.");
    this.assertCanMutate(actor, membership);

    const role = input.role ?? membership.role;
    if (input.role && !ASSIGNABLE_ROLES.includes(input.role) && input.role !== "SITE_YONETICISI") {
      throw new HttpError(400, "Geçersiz rol.");
    }
    if (input.role && isOwnerRole(input.role) && !isOwnerRole(actor.role)) {
      throw new HttpError(403, "Organizasyon sahibi rolü verilemez.");
    }
    if (isOwnerRole(membership.role) && input.role && !isOwnerRole(input.role)) {
      const remaining = await countActiveOwners(tenantId, membership.id);
      if (remaining < 1) throw new HttpError(400, "Son organizasyon sahibi düşürülemez.");
    }
    if (!actor.permissions.includes("users.manage") && (input.permissions || input.role)) {
      throw new HttpError(403, "Rol ve yetki değiştirme yetkiniz yok.");
    }

    const granted = new Set(actor.permissions);
    const nextPermissions = isOwnerRole(role)
      ? []
      : sanitizePermissions(input.permissions ?? membership.permissions);
    if (!isOwnerRole(actor.role)) {
      for (const code of nextPermissions) {
        if (!granted.has(code)) {
          throw new HttpError(403, "Sahip olmadığınız bir yetkiyi başkasına veremezsiniz.");
        }
      }
    }

    const allSites = input.allSites ?? membership.allSites;
    const siteIds = allSites ? [] : await this.assertSites(tenantId, input.siteIds ?? []);

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          role,
          allSites,
          permissions: nextPermissions,
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

    await writeTenantAudit({
      tenantId,
      actorUserId: actor.userId,
      action: "user.updated",
      targetType: "Membership",
      targetId: membership.id,
      metadata: { role, allSites },
    });
    return { ok: true };
  }

  async setStatus(
    actor: { userId: string; role: UserRole },
    tenantId: string,
    membershipId: string,
    status: "ACTIVE" | "DISABLED",
  ) {
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw new HttpError(404, "Üyelik bulunamadı.");
    this.assertCanMutate(actor, membership);
    if (status === "DISABLED" && isOwnerRole(membership.role) && membership.status === "ACTIVE") {
      const remaining = await countActiveOwners(tenantId, membership.id);
      if (remaining < 1) throw new HttpError(400, "Son organizasyon sahibi pasife alınamaz.");
    }
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status, permissionVersion: { increment: 1 } },
    });
    await writeTenantAudit({
      tenantId,
      actorUserId: actor.userId,
      action: status === "DISABLED" ? "user.disabled" : "user.enabled",
      targetType: "Membership",
      targetId: membership.id,
    });
    return { ok: true };
  }

  async remove(actor: { userId: string; role: UserRole }, tenantId: string, membershipId: string) {
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw new HttpError(404, "Üyelik bulunamadı.");
    this.assertCanMutate(actor, membership);
    if (isOwnerRole(membership.role) && membership.status === "ACTIVE") {
      const remaining = await countActiveOwners(tenantId, membership.id);
      if (remaining < 1) throw new HttpError(400, "Son organizasyon sahibi kaldırılamaz.");
    }
    await prisma.membership.delete({ where: { id: membership.id } });
    await writeTenantAudit({
      tenantId,
      actorUserId: actor.userId,
      action: "user.membership.removed",
      targetType: "Membership",
      targetId: membershipId,
    });
    return { ok: true };
  }

  private assertCanMutate(
    actor: { userId: string; role: UserRole },
    target: { userId: string; role: UserRole },
  ) {
    if (target.userId === actor.userId) {
      throw new HttpError(400, "Kendi üyeliğiniz üzerinde bu işlemi yapamazsınız.");
    }
    if (isOwnerRole(target.role) && !isOwnerRole(actor.role)) {
      throw new HttpError(403, "Organizasyon sahibi yalnızca başka bir sahip tarafından yönetilebilir.");
    }
  }

  private async assertSites(tenantId: string, siteIds: string[]) {
    const unique = [...new Set(siteIds.filter(Boolean))];
    if (unique.length === 0) throw new HttpError(400, "En az bir site seçin veya tüm siteleri açın.");
    const count = await prisma.site.count({
      where: { tenantId, id: { in: unique }, deletedAt: null },
    });
    if (count !== unique.length) throw new HttpError(400, "Seçilen sitelerin bir kısmı bu hesaba ait değil.");
    return unique;
  }
}

export const tenantUserService = new TenantUserService();
