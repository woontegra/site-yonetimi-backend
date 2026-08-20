import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/jwt";
import { HttpError } from "../utils/httpError";

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
  }>;
};

export class AuthService {
  async login(email: string, password: string): Promise<{ token: string; user: PublicUser }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          include: { tenant: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, "E-posta veya şifre hatalı.");
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new HttpError(401, "E-posta veya şifre hatalı.");
    }

    const activeMemberships = user.memberships.filter((item) => item.tenant.isActive);
    const primary = activeMemberships[0] ?? null;

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      tenantId: primary?.tenantId ?? null,
      role: primary?.role ?? null,
    });

    return {
      token,
      user: this.toPublicUser(user, activeMemberships),
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
      include: {
        memberships: { include: { tenant: true } },
      },
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
              role: "SITE_YONETICISI",
            },
          },
        },
        include: {
          memberships: { include: { tenant: true } },
        },
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
          role: "SITE_YONETICISI",
        },
      });
      user = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          memberships: { include: { tenant: true } },
        },
      });
    }

    const activeMemberships = user.memberships.filter((item) => item.tenant.isActive);
    const primary = activeMemberships.find((item) => item.tenantId === tenant.id) ?? activeMemberships[0] ?? null;

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      tenantId: primary?.tenantId ?? tenant.id,
      role: primary?.role ?? "SITE_YONETICISI",
    });

    return {
      token,
      user: this.toPublicUser(user, activeMemberships),
    };
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { tenant: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, "Oturum geçersiz.");
    }

    const activeMemberships = user.memberships.filter((item) => item.tenant.isActive);
    return this.toPublicUser(user, activeMemberships);
  }

  private toPublicUser(
    user: {
      id: string;
      email: string;
      fullName: string;
      isPlatformAdmin: boolean;
    },
    memberships: Array<{
      role: string;
      tenant: { id: string; name: string; slug: string };
    }>,
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
      })),
    };
  }
}

export const authService = new AuthService();
