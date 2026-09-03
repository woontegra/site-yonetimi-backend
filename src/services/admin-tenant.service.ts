import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { addDays, addMonths, addYears, slugifyTenantName } from "../utils/admin";
import { assertRateLimit } from "../utils/rate-limit";
import { writeAdminAudit } from "./admin-audit.service";
import { pickOwner, toSubscriptionView } from "./admin-serializers";
import { sendTenantWelcomeAndNotify } from "./email/tenant-email.service";
import {
  getTenantDeleteCounts,
  isProtectedTenant,
  permanentlyDeleteTenant,
} from "./admin-tenant-delete.service";

const tenantListSelect = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  createdAt: true,
  subscription: true,
  memberships: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  },
  _count: {
    select: {
      sites: { where: { deletedAt: null } },
      apartments: { where: { deletedAt: null } },
      memberships: true,
    },
  },
} satisfies Prisma.TenantSelect;

function serializeTenantListItem(
  tenant: Prisma.TenantGetPayload<{ select: typeof tenantListSelect }>,
) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    isActive: tenant.isActive,
    createdAt: tenant.createdAt.toISOString(),
    owner: pickOwner(tenant.memberships),
    siteCount: tenant._count.sites,
    apartmentCount: tenant._count.apartments,
    userCount: tenant._count.memberships,
    subscription: toSubscriptionView(tenant.subscription),
  };
}

export class AdminTenantService {
  async list(query: {
    page: number;
    perPage: number;
    search?: string;
    filter?: "aktif" | "pasif" | "deneme" | "lisansli";
  }) {
    const where: Prisma.TenantWhereInput = {};
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        {
          memberships: {
            some: {
              user: {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ];
    }

    if (query.filter === "aktif") where.isActive = true;
    if (query.filter === "pasif") where.isActive = false;
    if (query.filter === "deneme") where.subscription = { status: "TRIAL" };
    if (query.filter === "lisansli") where.subscription = { status: "ACTIVE" };

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: tenantListSelect,
      }),
      prisma.tenant.count({ where }),
    ]);

    return {
      items: items.map(serializeTenantListItem),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async create(
    adminUserId: string,
    input: {
      name: string;
      managerFullName: string;
      managerEmail: string;
      plan?: "DEMO" | "PROFESSIONAL";
      trialDays?: number;
      licenseTerm?: "1m" | "3m" | "6m" | "1y" | "custom";
      endsAt?: Date;
    },
  ) {
    assertRateLimit(`tenant-create:${adminUserId}`, 20, 15 * 60 * 1000);
    const name = input.name.trim();
    const managerFullName = input.managerFullName.trim();
    const managerEmail = input.managerEmail.trim().toLowerCase();
    const plan = input.plan ?? "DEMO";

    const existingUser = await prisma.user.findUnique({ where: { email: managerEmail } });
    if (existingUser) {
      throw new HttpError(400, "Bu e-posta adresi ile bir kullanıcı zaten kayıtlı.");
    }

    const slug = await this.uniqueSlug(slugifyTenantName(name));
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const now = new Date();
    const paid = plan === "PROFESSIONAL";
    const trialDays = paid ? null : (input.trialDays ?? 7);
    let endsAt: Date;
    if (paid) {
      const term = input.licenseTerm ?? "1y";
      if (term === "custom") {
        if (!input.endsAt) throw new HttpError(400, "Özel bitiş tarihi zorunludur.");
        endsAt = input.endsAt;
      } else if (term === "1m") endsAt = addMonths(now, 1);
      else if (term === "3m") endsAt = addMonths(now, 3);
      else if (term === "6m") endsAt = addMonths(now, 6);
      else endsAt = addYears(now, 1);
    } else {
      endsAt = addDays(now, trialDays ?? 7);
    }

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, slug, isActive: true },
      });
      const user = await tx.user.create({
        data: {
          email: managerEmail,
          fullName: managerFullName,
          passwordHash,
          isActive: false,
        },
      });
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "SITE_YONETICISI" },
      });
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan,
          status: paid ? "ACTIVE" : "TRIAL",
          startsAt: now,
          endsAt,
          trialEndsAt: paid ? null : endsAt,
        },
      });
      return { tenantId: tenant.id, userId: user.id };
    });

    await writeAdminAudit({
      adminUserId,
      action: "tenant.create",
      targetType: "Tenant",
      targetId: created.tenantId,
      tenantId: created.tenantId,
      metadata: {
        plan,
        trialDays,
        licenseTerm: paid ? (input.licenseTerm ?? "1y") : null,
        endsAt: endsAt.toISOString(),
        managerEmailMasked: managerEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
      },
    });

    let emails: Awaited<ReturnType<typeof sendTenantWelcomeAndNotify>> | null = null;
    try {
      emails = await sendTenantWelcomeAndNotify({
        adminUserId,
        tenantId: created.tenantId,
        userId: created.userId,
      });
    } catch {
      emails = null;
    }

    const tenant = await this.getById(created.tenantId);
    return {
      tenant,
      emails: {
        welcome: emails?.welcome ?? null,
        platformNotification: emails?.platformNotification ?? null,
      },
    };
  }

  async getById(id: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        ...tenantListSelect,
        updatedAt: true,
      },
    });
    if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");

    const [whatsapp, usage, emailIntegration, isProtected, recordCounts] = await Promise.all([
      prisma.whatsAppIntegration.findFirst({
        where: { tenantId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          connectionStatus: true,
          wabaId: true,
          displayPhoneNumber: true,
          lastCheckedAt: true,
          lastError: true,
        },
      }),
      this.usageCounts(id),
      prisma.platformEmailIntegration.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { isActive: true, status: true },
      }),
      isProtectedTenant(id),
      getTenantDeleteCounts(id),
    ]);

    const emailConnected = Boolean(emailIntegration?.isActive && emailIntegration.status === "READY");
    const whatsappConnected = whatsapp?.connectionStatus === "CONNECTED";

    return {
      ...serializeTenantListItem(tenant),
      updatedAt: tenant.updatedAt.toISOString(),
      isProtected,
      whatsapp: whatsapp
        ? {
            id: whatsapp.id,
            connectionStatus: whatsapp.connectionStatus,
            wabaLinked: Boolean(whatsapp.wabaId),
            displayPhoneNumber: whatsapp.displayPhoneNumber,
            lastCheckedAt: whatsapp.lastCheckedAt?.toISOString() ?? null,
          }
        : null,
      email: {
        connected: emailConnected,
        status: emailIntegration?.status ?? null,
      },
      integrationSummary: {
        whatsappConnected,
        emailConnected,
        connectedCount: Number(whatsappConnected) + Number(emailConnected),
      },
      usage,
      recordCounts,
    };
  }

  async permanentlyDelete(adminUserId: string, tenantId: string, confirmName: string) {
    await permanentlyDeleteTenant(adminUserId, tenantId, confirmName);
    return { ok: true as const };
  }

  async listSites(tenantId: string) {
    await this.assertExists(tenantId);
    const items = await prisma.site.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        city: true,
        district: true,
        isActive: true,
        setupStatus: true,
        createdAt: true,
        _count: {
          select: {
            buildings: { where: { deletedAt: null } },
          },
        },
      },
    });
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      city: item.city,
      district: item.district,
      isActive: item.isActive,
      setupStatus: item.setupStatus,
      buildingCount: item._count.buildings,
      createdAt: item.createdAt.toISOString(),
    }));
  }

  async listUsers(tenantId: string) {
    await this.assertExists(tenantId);
    const memberships = await prisma.membership.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
    });
    return memberships.map((item) => ({
      id: item.user.id,
      fullName: item.user.fullName,
      email: item.user.email,
      role: item.role,
      isActive: item.user.isActive,
      lastLoginAt: item.user.lastLoginAt?.toISOString() ?? null,
      createdAt: item.user.createdAt.toISOString(),
    }));
  }

  async listNotes(tenantId: string) {
    await this.assertExists(tenantId);
    const items = await prisma.adminNote.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { adminUser: { select: { id: true, fullName: true, email: true } } },
    });
    return items.map((item) => ({
      id: item.id,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      adminUser: item.adminUser,
    }));
  }

  async addNote(adminUserId: string, tenantId: string, content: string) {
    await this.assertExists(tenantId);
    const note = await prisma.adminNote.create({
      data: { tenantId, adminUserId, content: content.trim() },
      include: { adminUser: { select: { id: true, fullName: true, email: true } } },
    });
    await writeAdminAudit({
      adminUserId,
      action: "admin_note.create",
      targetType: "AdminNote",
      targetId: note.id,
      tenantId,
    });
    return {
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
      adminUser: note.adminUser,
    };
  }

  async setActive(adminUserId: string, tenantId: string, isActive: boolean) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive },
    });
    await writeAdminAudit({
      adminUserId,
      action: isActive ? "tenant.activate" : "tenant.deactivate",
      targetType: "Tenant",
      targetId: tenantId,
      tenantId,
      metadata: { previous: tenant.isActive, next: isActive },
    });
    return { id: updated.id, isActive: updated.isActive };
  }

  async extendSubscription(
    adminUserId: string,
    tenantId: string,
    input: {
      days?: number;
      endsAt?: Date;
      plan?: SubscriptionPlan;
      trialDays?: number;
    },
  ) {
    await this.assertExists(tenantId);
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    const now = new Date();

    if (input.trialDays != null) {
      const endsAt = addDays(now, input.trialDays);
      const saved = await prisma.subscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          plan: input.plan ?? existing?.plan ?? "DEMO",
          status: "TRIAL",
          startsAt: existing?.startsAt ?? now,
          endsAt,
          trialEndsAt: endsAt,
        },
        update: {
          status: "TRIAL",
          plan: input.plan ?? existing?.plan ?? "DEMO",
          endsAt,
          trialEndsAt: endsAt,
          cancelledAt: null,
        },
      });
      await writeAdminAudit({
        adminUserId,
        action: "subscription.trial",
        targetType: "Subscription",
        targetId: saved.id,
        tenantId,
        metadata: { days: input.trialDays, endsAt: endsAt.toISOString() },
      });
      return toSubscriptionView(saved);
    }

    const baseEnd = existing && existing.endsAt > now ? existing.endsAt : now;
    const endsAt = input.endsAt ?? addDays(baseEnd, input.days ?? 7);
    const nextStatus = this.statusAfterExtend(existing?.status ?? "TRIAL", endsAt);
    const saved = await prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        plan: input.plan ?? "DEMO",
        status: nextStatus,
        startsAt: now,
        endsAt,
        trialEndsAt: nextStatus === "TRIAL" ? endsAt : null,
      },
      update: {
        endsAt,
        status: nextStatus,
        cancelledAt: null,
        ...(input.plan ? { plan: input.plan } : {}),
      },
    });
    await writeAdminAudit({
      adminUserId,
      action: "subscription.extend",
      targetType: "Subscription",
      targetId: saved.id,
      tenantId,
      metadata: {
        days: input.days ?? null,
        previousEndsAt: existing?.endsAt.toISOString() ?? null,
        nextEndsAt: endsAt.toISOString(),
      },
    });
    return toSubscriptionView(saved);
  }

  private statusAfterExtend(current: SubscriptionStatus, endsAt: Date): SubscriptionStatus {
    if (current === "SUSPENDED") return "SUSPENDED";
    if (current === "CANCELLED" || current === "EXPIRED") {
      return endsAt > new Date() ? "ACTIVE" : "EXPIRED";
    }
    if (current === "TRIAL") return "TRIAL";
    return endsAt > new Date() ? "ACTIVE" : "EXPIRED";
  }

  private async usageCounts(tenantId: string) {
    const [sites, apartments, users, persons, messages] = await Promise.all([
      prisma.site.count({ where: { tenantId, deletedAt: null } }),
      prisma.apartment.count({ where: { tenantId, deletedAt: null } }),
      prisma.membership.count({ where: { tenantId } }),
      prisma.person.count({ where: { tenantId, deletedAt: null } }),
      prisma.communicationMessage.count({ where: { tenantId } }),
    ]);
    return { sites, apartments, users, persons, messages };
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let n = 2;
    while (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${n}`.slice(0, 60);
      n += 1;
    }
    return slug;
  }

  private async assertExists(id: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");
  }
}

export const adminTenantService = new AdminTenantService();
