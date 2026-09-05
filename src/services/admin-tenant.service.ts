import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { LICENSE_ANNUAL_DAYS, LICENSE_DEMO_DAYS } from "../config/license.config";
import { HttpError } from "../utils/httpError";
import { slugifyTenantName } from "../utils/admin";
import { assertRateLimit } from "../utils/rate-limit";
import { writeAdminAudit } from "./admin-audit.service";
import { pickOwner, toSubscriptionView } from "./admin-serializers";
import { sendTenantWelcomeAndNotify } from "./email/tenant-email.service";
import {
  getTenantDeleteCounts,
  isProtectedTenant,
  permanentlyDeleteTenant,
} from "./admin-tenant-delete.service";
import { adminSubscriptionService } from "./admin-subscription.service";
import { addCalendarDaysEndOfDay, endOfDayFrom, priceForPlan } from "./entitlement.service";

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
    if (query.filter === "deneme") where.subscription = { plan: "DEMO", status: { notIn: ["CANCELLED"] } };
    if (query.filter === "lisansli") where.subscription = { plan: "ANNUAL", status: { notIn: ["CANCELLED"] } };

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
      plan?: "DEMO" | "ANNUAL";
      trialDays?: number;
      annualDays?: number;
      endsAt?: Date;
      startsAt?: Date;
      netPrice?: number;
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
    const startsAt = input.startsAt ?? new Date();
    const demoDays = input.trialDays ?? LICENSE_DEMO_DAYS;
    const annualDays = input.annualDays ?? LICENSE_ANNUAL_DAYS;
    const endsAt =
      input.endsAt != null
        ? endOfDayFrom(input.endsAt)
        : plan === "ANNUAL"
          ? addCalendarDaysEndOfDay(startsAt, annualDays)
          : addCalendarDaysEndOfDay(startsAt, demoDays);
    const price = priceForPlan(plan, input.netPrice);

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
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: "SITE_YONETICISI",
          status: "INVITED",
          invitedAt: new Date(),
        },
      });
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan,
          status: "ACTIVE",
          startsAt,
          endsAt,
          ...price,
          activatedAt: startsAt,
          createdByPlatformAdminId: adminUserId,
          lastModifiedByPlatformAdminId: adminUserId,
        },
      });
      const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: sub.id,
          tenantId: tenant.id,
          action: plan === "ANNUAL" ? "ANNUAL_STARTED" : "DEMO_STARTED",
          previousValues: undefined,
          newValues: {
            plan,
            status: "ACTIVE",
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            ...price,
          },
          reason: "Organizasyon oluşturulurken lisans tanımlandı.",
          performedById: adminUserId,
          netPrice: price.netPrice,
          vatRate: price.vatRate,
          vatAmount: price.vatAmount,
          grossPrice: price.grossPrice,
          currency: price.currency,
        },
      });
      return { tenantId: tenant.id, userId: user.id, subscriptionId: sub.id };
    });

    await writeAdminAudit({
      adminUserId,
      action: "tenant.create",
      targetType: "Tenant",
      targetId: created.tenantId,
      tenantId: created.tenantId,
      metadata: {
        plan,
        trialDays: plan === "DEMO" ? demoDays : null,
        annualDays: plan === "ANNUAL" ? annualDays : null,
        endsAt: endsAt.toISOString(),
        price,
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
    } catch (err) {
      // Organizasyon kaydı korunur; e-posta hatası ayrı delivery/audit ile izlenir.
      console.warn(
        "[tenant.create] Aktivasyon e-postası gönderilemedi:",
        err instanceof Error ? err.message : "unknown",
      );
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

  async listNotes(tenantId: string, options?: { subjectUserId?: string | null }) {
    await this.assertExists(tenantId);
    const where: { tenantId: string; deletedAt: null; subjectUserId?: string | null } = {
      tenantId,
      deletedAt: null,
    };
    if (options && "subjectUserId" in options) {
      where.subjectUserId = options.subjectUserId ?? null;
    }
    const items = await prisma.adminNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { adminUser: { select: { id: true, fullName: true, email: true } } },
    });
    return items.map((item) => ({
      id: item.id,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      subjectUserId: item.subjectUserId,
      adminUser: item.adminUser,
    }));
  }

  async addNote(
    adminUserId: string,
    tenantId: string,
    content: string,
    options?: { subjectUserId?: string | null },
  ) {
    await this.assertExists(tenantId);
    if (options?.subjectUserId) {
      const subject = await prisma.user.findUnique({
        where: { id: options.subjectUserId },
        select: { id: true },
      });
      if (!subject) throw new HttpError(404, "Hedef kullanıcı bulunamadı.");
    }
    const note = await prisma.adminNote.create({
      data: {
        tenantId,
        adminUserId,
        content: content.trim(),
        subjectUserId: options?.subjectUserId ?? null,
      },
      include: { adminUser: { select: { id: true, fullName: true, email: true } } },
    });
    await writeAdminAudit({
      adminUserId,
      action: "admin_note.create",
      targetType: "AdminNote",
      targetId: note.id,
      tenantId,
      metadata: options?.subjectUserId ? { subjectUserId: options.subjectUserId } : undefined,
    });
    return {
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
      subjectUserId: note.subjectUserId,
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
      reason: string;
    },
  ) {
    await this.assertExists(tenantId);
    if (input.trialDays != null) {
      return adminSubscriptionService.extendDemo(adminUserId, tenantId, {
        days: input.trialDays,
        reason: input.reason,
      });
    }
    if (input.endsAt) {
      return adminSubscriptionService.setCustomEndsAt(
        adminUserId,
        tenantId,
        input.endsAt,
        input.reason,
      );
    }
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (existing?.plan === "ANNUAL") {
      return adminSubscriptionService.setCustomEndsAt(
        adminUserId,
        tenantId,
        addCalendarDaysEndOfDay(
          existing.endsAt.getTime() > Date.now() ? existing.endsAt : new Date(),
          input.days ?? LICENSE_ANNUAL_DAYS,
        ),
        input.reason,
      );
    }
    return adminSubscriptionService.extendDemo(adminUserId, tenantId, {
      days: input.days ?? LICENSE_DEMO_DAYS,
      reason: input.reason,
    });
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

  private async assertExists(id: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");
  }
}

export const adminTenantService = new AdminTenantService();
