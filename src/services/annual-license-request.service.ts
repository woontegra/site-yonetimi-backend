import type { AnnualLicenseRequest, AnnualLicenseRequestStatus, Prisma, Subscription } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { computeLicensePrice, LICENSE_ANNUAL_DAYS } from "../config/license.config";
import { addCalendarDaysEndOfDay } from "../utils/license-dates";
import { HttpError } from "../utils/httpError";
import { writeAdminAudit } from "./admin-audit.service";
import { writeTenantAudit } from "./tenant-audit.service";
import { adminSubscriptionService } from "./admin-subscription.service";
import { toLicenseView } from "./entitlement.service";
import { platformEmailService } from "./email/platform-email.service";
import { renderAnnualLicenseRequestEmail } from "./email/templates";
import { publicAppHref } from "./email/mail-provider";
import { formatDateTimeTr } from "../utils/admin";
import { assertRateLimit } from "../utils/rate-limit";

const OPEN_STATUSES: AnnualLicenseRequestStatus[] = ["PENDING", "CONTACTED"];

function dec(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : Number(value);
}

export function projectedAnnualEndsAt(subscription: Subscription | null, now = new Date()): Date {
  if (!subscription) return addCalendarDaysEndOfDay(now, LICENSE_ANNUAL_DAYS);
  const base =
    subscription.plan === "DEMO" && subscription.endsAt.getTime() > now.getTime()
      ? subscription.endsAt
      : now;
  return addCalendarDaysEndOfDay(base, LICENSE_ANNUAL_DAYS);
}

function serializeRequest(row: AnnualLicenseRequest & {
  tenant?: { id: string; name: string } | null;
  requestedByUser?: { id: string; fullName: string; email: string } | null;
  processedByAdmin?: { id: string; fullName: string; email: string } | null;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status,
    note: row.note,
    netPrice: dec(row.netPriceSnapshot),
    vatRate: dec(row.vatRateSnapshot),
    vatAmount: dec(row.vatAmountSnapshot),
    grossPrice: dec(row.grossPriceSnapshot),
    currency: row.currency,
    organizationName: row.organizationNameSnapshot,
    requesterName: row.requesterNameSnapshot,
    requesterEmail: row.requesterEmailSnapshot,
    requesterPhone: row.requesterPhoneSnapshot,
    currentPlan: row.currentPlanSnapshot,
    currentEndsAt: row.currentEndsAtSnapshot?.toISOString() ?? null,
    currentSubscriptionId: row.currentSubscriptionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    adminNote: row.adminNote,
    tenant: row.tenant ? { id: row.tenant.id, name: row.tenant.name } : undefined,
    requestedBy: row.requestedByUser
      ? {
          id: row.requestedByUser.id,
          fullName: row.requestedByUser.fullName,
          email: row.requestedByUser.email,
        }
      : undefined,
    processedBy: row.processedByAdmin
      ? {
          id: row.processedByAdmin.id,
          fullName: row.processedByAdmin.fullName,
          email: row.processedByAdmin.email,
        }
      : null,
  };
}

export async function getAnnualLicenseOffer(userId: string, tenantId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { id: true, status: true },
  });
  if (!membership || membership.status === "DISABLED") {
    throw new HttpError(403, "Bu organizasyon için lisans teklifini görüntüleme yetkiniz yok.", "FORBIDDEN_TENANT");
  }

  const [user, tenant, subscription, openRequest] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, isPlatformAdmin: true, isActive: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
    prisma.subscription.findUnique({ where: { tenantId } }),
    prisma.annualLicenseRequest.findFirst({
      where: { tenantId, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user?.isActive) throw new HttpError(401, "Oturum geçersiz.");
  if (!tenant) throw new HttpError(400, "Organizasyon bağlamı gerekli.", "ORGANIZATION_CONTEXT_REQUIRED");

  const price = computeLicensePrice();
  const now = new Date();
  const projectedEndsAt = projectedAnnualEndsAt(subscription, now);
  const license = subscription ? toLicenseView(subscription, now) : null;
  const remainingDemoDaysPreserved =
    Boolean(subscription && subscription.plan === "DEMO" && subscription.endsAt.getTime() > now.getTime());

  return {
    product: {
      code: "ANNUAL" as const,
      name: "Yıllık Lisans",
      billingPeriod: "year" as const,
      netPrice: price.netPrice,
      vatRate: price.vatRate,
      vatAmount: price.vatAmount,
      grossPrice: price.grossPrice,
      currency: price.currency,
      monthlyNetApprox: Math.round((price.netPrice / 12) * 100) / 100,
    },
    organization: { id: tenant.id, name: tenant.name },
    requester: { id: user.id, fullName: user.fullName, email: user.email, phone: null as string | null },
    license,
    projectedEndsAt: projectedEndsAt.toISOString(),
    remainingDemoDaysPreserved,
    openRequest: openRequest ? serializeRequest(openRequest) : null,
    support: {
      email: process.env.LICENSE_SUPPORT_EMAIL?.trim() || process.env.SUPPORT_EMAIL?.trim() || null,
      renewalUrl: process.env.LICENSE_RENEWAL_URL?.trim() || null,
      whatsapp:
        process.env.LICENSE_SUPPORT_WHATSAPP?.trim() ||
        process.env.SALES_WHATSAPP?.trim() ||
        null,
    },
    features: [
      "Aidat ve borçlandırma yönetimi",
      "Tahsilat takibi",
      "Banka ekstresi içe aktarma ve eşleştirme",
      "Gider yönetimi",
      "Gecikme faizi kararları",
      "Daire hesap ekstreleri",
      "PDF ve Excel raporları",
      "Kullanıcı ve yetki yönetimi",
      "Duyurular",
      "WhatsApp entegrasyonu (mevcut koşullarla)",
      "Site, bina, daire ve sakin yönetimi",
      "Organizasyondaki tüm kullanıcı ve siteler",
    ],
  };
}

export async function createAnnualLicenseRequest(
  userId: string,
  tenantId: string,
  input: { note?: string | null },
) {
  assertRateLimit(`annual-license-request:${tenantId}`, 8, 60 * 60 * 1000);

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { id: true, status: true },
  });
  if (!membership || membership.status === "DISABLED") {
    throw new HttpError(403, "Bu organizasyon adına talep oluşturma yetkiniz yok.", "FORBIDDEN_TENANT");
  }

  const existingOpen = await prisma.annualLicenseRequest.findFirst({
    where: { tenantId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (existingOpen) {
    throw new HttpError(
      409,
      "Bu organizasyon için değerlendirmede olan bir yıllık lisans talebi bulunuyor.",
      "ANNUAL_LICENSE_REQUEST_OPEN",
    );
  }

  const [user, tenant, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, isActive: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
    prisma.subscription.findUnique({ where: { tenantId } }),
  ]);

  if (!user?.isActive) throw new HttpError(401, "Oturum geçersiz.");
  if (!tenant) throw new HttpError(400, "Organizasyon bağlamı gerekli.", "ORGANIZATION_CONTEXT_REQUIRED");

  if (subscription && subscription.plan === "ANNUAL") {
    const view = toLicenseView(subscription);
    if (view.status === "ACTIVE" && view.remainingDays > 30) {
      throw new HttpError(409, "Organizasyonun zaten aktif bir yıllık lisansı bulunuyor.");
    }
  }

  const price = computeLicensePrice();
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;

  const created = await prisma.annualLicenseRequest.create({
    data: {
      tenantId,
      requestedByUserId: userId,
      currentSubscriptionId: subscription?.id ?? null,
      status: "PENDING",
      netPriceSnapshot: price.netPrice,
      vatRateSnapshot: price.vatRate,
      vatAmountSnapshot: price.vatAmount,
      grossPriceSnapshot: price.grossPrice,
      currency: price.currency,
      note,
      organizationNameSnapshot: tenant.name,
      requesterNameSnapshot: user.fullName,
      requesterEmailSnapshot: user.email,
      requesterPhoneSnapshot: null,
      currentPlanSnapshot: subscription?.plan ?? null,
      currentEndsAtSnapshot: subscription?.endsAt ?? null,
    },
  });

  await writeTenantAudit({
    tenantId,
    actorUserId: userId,
    action: "license.annual_request.created",
    targetType: "AnnualLicenseRequest",
    targetId: created.id,
    metadata: {
      status: created.status,
      netPrice: price.netPrice,
      grossPrice: price.grossPrice,
    },
  });

  // Bildirim — talep oluşturulmasını engellemez.
  try {
    const integration = await platformEmailService.getSafe();
    const to = integration?.notificationEmail?.trim();
    if (to) {
      const adminUrl =
        publicAppHref(`/app/admin/abonelikler?tab=requests&requestId=${created.id}`) ||
        "/app/admin/abonelikler?tab=requests";
      const rendered = renderAnnualLicenseRequestEmail({
        requestId: created.id,
        tenantName: tenant.name,
        requesterName: user.fullName,
        requesterEmail: user.email,
        currentPlan: subscription?.plan ?? null,
        currentEndsAtLabel: subscription ? formatDateTimeTr(subscription.endsAt) : null,
        netPrice: price.netPrice,
        vatAmount: price.vatAmount,
        grossPrice: price.grossPrice,
        note,
        adminUrl,
      });
      await platformEmailService.dispatch({
        type: "ANNUAL_LICENSE_REQUEST_NOTIFICATION",
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        relatedTenantId: tenantId,
        relatedUserId: userId,
      });
    }
  } catch {
    // swallow — talep kaydı asıl kaynak
  }

  return serializeRequest(created);
}

export async function listAdminAnnualLicenseRequests(query: {
  page: number;
  perPage: number;
  status?: AnnualLicenseRequestStatus | "open" | "";
  search?: string;
}) {
  const page = Math.max(1, query.page);
  const perPage = Math.min(Math.max(query.perPage, 1), 50);
  const where: Prisma.AnnualLicenseRequestWhereInput = {};

  if (query.status === "open") {
    where.status = { in: OPEN_STATUSES };
  } else if (query.status) {
    where.status = query.status;
  }

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { organizationNameSnapshot: { contains: search, mode: "insensitive" } },
      { requesterNameSnapshot: { contains: search, mode: "insensitive" } },
      { requesterEmailSnapshot: { contains: search, mode: "insensitive" } },
      { tenant: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, items, counts] = await Promise.all([
    prisma.annualLicenseRequest.count({ where }),
    prisma.annualLicenseRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        tenant: { select: { id: true, name: true } },
        requestedByUser: { select: { id: true, fullName: true, email: true } },
        processedByAdmin: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.annualLicenseRequest.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const summary = {
    pending: 0,
    contacted: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const row of counts) {
    if (row.status === "PENDING") summary.pending = row._count._all;
    if (row.status === "CONTACTED") summary.contacted = row._count._all;
    if (row.status === "APPROVED") summary.approved = row._count._all;
    if (row.status === "REJECTED") summary.rejected = row._count._all;
    if (row.status === "CANCELLED") summary.cancelled = row._count._all;
  }

  return {
    page,
    perPage,
    total,
    summary,
    items: items.map((item) => serializeRequest(item)),
  };
}

export async function getAdminAnnualLicenseRequest(id: string) {
  const row = await prisma.annualLicenseRequest.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true } },
      requestedByUser: { select: { id: true, fullName: true, email: true } },
      processedByAdmin: { select: { id: true, fullName: true, email: true } },
    },
  });
  if (!row) throw new HttpError(404, "Lisans talebi bulunamadı.");

  const subscription = await prisma.subscription.findUnique({ where: { tenantId: row.tenantId } });
  const now = new Date();
  return {
    request: serializeRequest(row),
    license: subscription ? toLicenseView(subscription, now) : null,
    conversionPreview: {
      projectedEndsAt: projectedAnnualEndsAt(subscription, now).toISOString(),
      remainingDemoDaysPreserved: Boolean(
        subscription && subscription.plan === "DEMO" && subscription.endsAt.getTime() > now.getTime(),
      ),
      price: computeLicensePrice(),
    },
  };
}

async function loadOpenOrThrow(id: string) {
  const row = await prisma.annualLicenseRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Lisans talebi bulunamadı.");
  return row;
}

export async function markAnnualLicenseRequestContacted(
  adminUserId: string,
  id: string,
  input: { adminNote?: string | null },
) {
  const row = await loadOpenOrThrow(id);
  if (row.status !== "PENDING" && row.status !== "CONTACTED") {
    throw new HttpError(409, "Bu talep üzerinde iletişim durumu güncellenemez.");
  }
  const updated = await prisma.annualLicenseRequest.update({
    where: { id },
    data: {
      status: "CONTACTED",
      adminNote: input.adminNote?.trim() ? input.adminNote.trim().slice(0, 2000) : row.adminNote,
      processedByAdminId: adminUserId,
    },
  });
  await writeAdminAudit({
    adminUserId,
    action: "license_request.contacted",
    targetType: "AnnualLicenseRequest",
    targetId: id,
    tenantId: row.tenantId,
    metadata: { previousStatus: row.status, nextStatus: "CONTACTED" },
  });
  return serializeRequest(updated);
}

export async function rejectAnnualLicenseRequest(
  adminUserId: string,
  id: string,
  input: { reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new HttpError(400, "Gerekçe gerekli.");
  const row = await loadOpenOrThrow(id);
  if (!OPEN_STATUSES.includes(row.status)) {
    throw new HttpError(409, "Bu talep reddedilemez.");
  }
  const updated = await prisma.annualLicenseRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      adminNote: reason.slice(0, 2000),
      processedByAdminId: adminUserId,
      processedAt: new Date(),
    },
  });
  await writeAdminAudit({
    adminUserId,
    action: "license_request.rejected",
    targetType: "AnnualLicenseRequest",
    targetId: id,
    tenantId: row.tenantId,
    metadata: { previousStatus: row.status, reason },
  });
  return serializeRequest(updated);
}

export async function cancelAnnualLicenseRequest(
  adminUserId: string,
  id: string,
  input: { reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new HttpError(400, "Gerekçe gerekli.");
  const row = await loadOpenOrThrow(id);
  if (!OPEN_STATUSES.includes(row.status)) {
    throw new HttpError(409, "Bu talep iptal edilemez.");
  }
  const updated = await prisma.annualLicenseRequest.update({
    where: { id },
    data: {
      status: "CANCELLED",
      adminNote: reason.slice(0, 2000),
      processedByAdminId: adminUserId,
      processedAt: new Date(),
    },
  });
  await writeAdminAudit({
    adminUserId,
    action: "license_request.cancelled",
    targetType: "AnnualLicenseRequest",
    targetId: id,
    tenantId: row.tenantId,
    metadata: { previousStatus: row.status, reason },
  });
  return serializeRequest(updated);
}

export async function approveAnnualLicenseRequest(
  adminUserId: string,
  id: string,
  input: { reason: string; netPrice?: number; paymentNote?: "PAID" | "PENDING" | "COMPLIMENTARY" },
) {
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new HttpError(400, "Gerekçe gerekli.");
  const row = await loadOpenOrThrow(id);
  if (!OPEN_STATUSES.includes(row.status)) {
    throw new HttpError(409, "Bu talep onaylanamaz.");
  }

  const subscription = await adminSubscriptionService.convertToAnnual(adminUserId, row.tenantId, {
    reason,
    netPrice: input.netPrice ?? Number(row.netPriceSnapshot),
    paymentNote: input.paymentNote,
  });

  const updated = await prisma.annualLicenseRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      adminNote: reason.slice(0, 2000),
      processedByAdminId: adminUserId,
      processedAt: new Date(),
    },
  });

  await writeAdminAudit({
    adminUserId,
    action: "license_request.approved",
    targetType: "AnnualLicenseRequest",
    targetId: id,
    tenantId: row.tenantId,
    metadata: {
      previousStatus: row.status,
      subscriptionId: subscription.id,
      endsAt: subscription.endsAt,
      reason,
    },
  });

  return { request: serializeRequest(updated), subscription };
}
