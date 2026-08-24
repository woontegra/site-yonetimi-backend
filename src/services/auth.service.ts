import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/jwt";
import { effectivePermissions } from "../permissions/catalog";
import { grantPlatformAdminIfListed } from "./platform-admin.service";
import { HttpError } from "../utils/httpError";

const membershipInclude = {
  tenant: true,
  siteAccesses: { select: { siteId: true } },
} as const;

type MembershipWithAccess = {
  tenantId: string;
  role: UserRole;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  allSites: boolean;
  permissions: unknown;
  tenant: { id: string; name: string; slug: string; isActive: boolean };
  siteAccesses: Array<{ siteId: string }>;
};

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    permissions: string[];
    allSites: boolean;
    siteIds: string[] | null;
  }>;
};

function usableMemberships(items: MembershipWithAccess[]) {
  return items.filter((item) => item.tenant.isActive && item.status === "ACTIVE");
}

export class AuthService {
  async login(email: string, password: string): Promise<{ token: string; user: PublicUser }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { memberships: { include: membershipInclude } },
    });

    if (!user) {
      throw new HttpError(401, "E-posta veya şifre hatalı.");
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new HttpError(401, "E-posta veya şifre hatalı.");
    }
    if (!user.isActive) {
      throw new HttpError(403, "Hesabınız henüz etkinleştirilmedi veya pasif.");
    }

    await grantPlatformAdminIfListed(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: { include: membershipInclude } },
    });

    const activeMemberships = usableMemberships(refreshed.memberships);
    if (activeMemberships.length === 0) {
      throw new HttpError(403, "Bu hesap için aktif bir üyelik bulunmuyor.");
    }
    const primary = activeMemberships[0];

    const token = signAccessToken({
      sub: refreshed.id,
      email: refreshed.email,
      tenantId: primary.tenantId,
      role: primary.role,
    });

    return {
      token,
      user: this.toPublicUser(refreshed, activeMemberships),
    };
  }

  async previewSession(): Promise<{ token: string; user: PublicUser }> {
    const tenant = await prisma.tenant.upsert({
      where: { slug: "dev-site" },
      update: {},
      create: {
        name: "Geliştirme Sitesi",
        slug: "dev-site",
      },
    });

    const email = "yonetici@site.com";
    let user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: membershipInclude } },
    });

    if (!user) {
      const passwordHash = await bcrypt.hash("local-dev", 10);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: "Yönetici",
          memberships: {
            create: {
              tenantId: tenant.id,
              role: "ORGANIZASYON_SAHIBI",
              status: "ACTIVE",
              allSites: true,
            },
          },
        },
        include: { memberships: { include: membershipInclude } },
      });
    } else {
      await prisma.membership.upsert({
        where: {
          userId_tenantId: {
            userId: user.id,
            tenantId: tenant.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          tenantId: tenant.id,
          role: "ORGANIZASYON_SAHIBI",
          status: "ACTIVE",
          allSites: true,
        },
      });
      user = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { memberships: { include: membershipInclude } },
      });
    }

    await grantPlatformAdminIfListed(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: { include: membershipInclude } },
    });

    const activeMemberships = usableMemberships(refreshed.memberships);
    const primary = activeMemberships.find((item) => item.tenantId === tenant.id) ?? activeMemberships[0] ?? null;

    const token = signAccessToken({
      sub: refreshed.id,
      email: refreshed.email,
      tenantId: primary?.tenantId ?? tenant.id,
      role: primary?.role ?? "ORGANIZASYON_SAHIBI",
    });

    return {
      token,
      user: this.toPublicUser(refreshed, activeMemberships),
    };
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: membershipInclude } },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, "Oturum geçersiz.");
    }

    await grantPlatformAdminIfListed(user.email);
    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: { include: membershipInclude } },
    });

    return this.toPublicUser(refreshed, usableMemberships(refreshed.memberships));
  }

  private toPublicUser(
    user: {
      id: string;
      email: string;
      fullName: string;
      isPlatformAdmin: boolean;
    },
    memberships: MembershipWithAccess[],
  ): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
      tenants: memberships.map((item) => ({
        id: item.tenant.id,
        name: item.tenant.name,
        slug: item.tenant.slug,
        role: item.role,
        permissions: effectivePermissions(item.role, item.permissions),
        allSites: item.allSites,
        siteIds: item.allSites ? null : item.siteAccesses.map((access) => access.siteId),
      })),
    };
  }
}

export const authService = new AuthService();
