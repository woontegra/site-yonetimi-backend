import type { Prisma, Subscription, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  annualNetPrice,
  computeLicensePrice,
  demoPriceSnapshot,
  type LicensePriceSnapshot,
} from "../config/license.config";
import {
  addCalendarDaysEndOfDay,
  endOfDayFrom,
  extendBaseDate,
  isPastEnd,
  remainingCalendarDays,
} from "../utils/license-dates";
import { HttpError } from "../utils/httpError";

export type EffectiveLicenseStatus = SubscriptionStatus;

export type LicenseView = {
  id: string;
  plan: SubscriptionPlan;
  status: EffectiveLicenseStatus;
  storedStatus: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  remainingDays: number;
  isExpired: boolean;
  readOnly: boolean;
  netPrice: number;
  vatRate: number;
  vatAmount: number;
  grossPrice: number;
  currency: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  note: string | null;
  version: number;
  updatedAt: string;
};

function dec(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

export function resolveEffectiveStatus(
  subscription: { status: SubscriptionStatus; endsAt: Date },
  now = new Date(),
): EffectiveLicenseStatus {
  if (subscription.status === "SUSPENDED" || subscription.status === "CANCELLED") {
    return subscription.status;
  }
  if (isPastEnd(subscription.endsAt, now)) return "EXPIRED";
  return "ACTIVE";
}

export function isLicenseReadOnly(
  subscription: { status: SubscriptionStatus; endsAt: Date } | null,
  now = new Date(),
): boolean {
  if (!subscription) return false;
  const status = resolveEffectiveStatus(subscription, now);
  return status === "EXPIRED" || status === "SUSPENDED" || status === "CANCELLED";
}

export function isSubscriptionCurrentlyValid(
  subscription: { status: SubscriptionStatus; endsAt: Date } | null,
  now = new Date(),
): boolean {
  if (!subscription) return true;
  return !isLicenseReadOnly(subscription, now);
}

export type LicenseAccessReason =
  | "inactive_user"
  | "platform_admin_exempt"
  | "subscription_writable"
  | "subscription_readonly"
  | "subscription_missing_ok";

export type LicenseAccessDecision = {
  allowed: boolean;
  /** Yazma izni (GET her zaman ayrı). */
  writable: boolean;
  exempt: boolean;
  readOnly: boolean;
  reason: LicenseAccessReason;
};

export function decideLicenseAccess(input: {
  isActive: boolean;
  isPlatformAdmin: boolean;
  subscription: { status: SubscriptionStatus; endsAt: Date } | null;
  now?: Date;
}): LicenseAccessDecision {
  if (!input.isActive) {
    return {
      allowed: false,
      writable: false,
      exempt: false,
      readOnly: true,
      reason: "inactive_user",
    };
  }

  if (input.isPlatformAdmin) {
    return {
      allowed: true,
      writable: true,
      exempt: true,
      readOnly: false,
      reason: "platform_admin_exempt",
    };
  }

  if (!input.subscription) {
    return {
      allowed: true,
      writable: true,
      exempt: false,
      readOnly: false,
      reason: "subscription_missing_ok",
    };
  }

  const readOnly = isLicenseReadOnly(input.subscription, input.now);
  if (readOnly) {
    return {
      allowed: true,
      writable: false,
      exempt: false,
      readOnly: true,
      reason: "subscription_readonly",
    };
  }

  return {
    allowed: true,
    writable: true,
    exempt: false,
    readOnly: false,
    reason: "subscription_writable",
  };
}

/** @deprecated Eski env bayrağı — salt okunur mod artık varsayılan. */
export function isLicenseEnforcementEnabled(): boolean {
  return true;
}

export function toLicenseView(subscription: Subscription, now = new Date()): LicenseView {
  const status = resolveEffectiveStatus(subscription, now);
  const remainingDays = remainingCalendarDays(subscription.endsAt, now);
  const readOnly = status === "EXPIRED" || status === "SUSPENDED" || status === "CANCELLED";
  return {
    id: subscription.id,
    plan: subscription.plan,
    status,
    storedStatus: subscription.status,
    startsAt: subscription.startsAt.toISOString(),
    endsAt: subscription.endsAt.toISOString(),
    remainingDays,
    isExpired: status === "EXPIRED",
    readOnly,
    netPrice: dec(subscription.netPrice),
    vatRate: dec(subscription.vatRate),
    vatAmount: dec(subscription.vatAmount),
    grossPrice: dec(subscription.grossPrice),
    currency: subscription.currency,
    activatedAt: subscription.activatedAt?.toISOString() ?? null,
    suspendedAt: subscription.suspendedAt?.toISOString() ?? null,
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    note: subscription.note,
    version: subscription.version,
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

export async function getTenantSubscription(tenantId: string) {
  return prisma.subscription.findUnique({ where: { tenantId } });
}

export async function evaluateLicenseAccess(userId: string, tenantId: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isPlatformAdmin: true },
  });

  if (!user) {
    return {
      user: null as { isActive: boolean; isPlatformAdmin: boolean } | null,
      subscription: null as Subscription | null,
      decision: {
        allowed: false,
        writable: false,
        exempt: false,
        readOnly: true,
        reason: "inactive_user" as const,
      },
    };
  }

  const subscription = tenantId ? await getTenantSubscription(tenantId) : null;
  const decision = decideLicenseAccess({
    isActive: user.isActive,
    isPlatformAdmin: user.isPlatformAdmin,
    subscription,
  });

  return { user, subscription, decision };
}

const TENANT_HISTORY_LABELS: Record<string, string> = {
  DEMO_STARTED: "Demo başlatıldı",
  DEMO_EXTENDED: "Demo uzatıldı",
  ANNUAL_STARTED: "Yıllık lisans başlatıldı",
  ANNUAL_CONVERTED: "Yıllık lisansa dönüştürüldü",
  ANNUAL_RENEWED: "Yıllık lisans yenilendi",
  EXTENDED: "Süre uzatıldı",
  PLAN_CHANGED: "Plan değiştirildi",
  SUSPENDED: "Askıya alındı",
  REACTIVATED: "Yeniden etkinleştirildi",
  CANCELLED: "İptal edildi",
  ENDS_AT_SET: "Bitiş tarihi güncellendi",
};

export async function getMyLicenseOverview(userId: string, tenantId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { id: true, status: true },
  });
  if (!membership || membership.status === "DISABLED") {
    throw new HttpError(403, "Bu organizasyonun lisans bilgilerini görüntüleme yetkiniz yok.", "FORBIDDEN_TENANT");
  }

  const { user, subscription, decision } = await evaluateLicenseAccess(userId, tenantId);
  if (!user || !user.isActive) {
    throw new HttpError(401, "Oturum geçersiz.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          sites: { where: { deletedAt: null } },
          memberships: { where: { status: { in: ["ACTIVE", "INVITED"] } } },
        },
      },
    },
  });
  if (!tenant) {
    throw new HttpError(400, "Organizasyon bağlamı gerekli.", "ORGANIZATION_CONTEXT_REQUIRED");
  }

  const view = subscription ? toLicenseView(subscription) : null;

  return {
    access: {
      isPlatformAdmin: user.isPlatformAdmin,
      exempt: decision.exempt,
      readOnly: decision.exempt ? false : decision.readOnly,
      accountType: user.isPlatformAdmin ? ("PLATFORM_ADMIN" as const) : ("TENANT_USER" as const),
      managementAccess: user.isPlatformAdmin
        ? ("UNLIMITED" as const)
        : ("SUBSCRIPTION_BOUND" as const),
      licenseStatus: user.isPlatformAdmin ? ("EXEMPT" as const) : ("BOUND" as const),
    },
    organization: { id: tenant.id, name: tenant.name },
    usage: {
      siteCount: tenant._count.sites,
      userCount: tenant._count.memberships,
    },
    licenseScope:
      "Bu lisans organizasyonunuzdaki bütün kullanıcı ve siteleri kapsar." as const,
    support: {
      email: process.env.LICENSE_SUPPORT_EMAIL?.trim() || process.env.SUPPORT_EMAIL?.trim() || null,
      renewalUrl: process.env.LICENSE_RENEWAL_URL?.trim() || null,
      whatsapp:
        process.env.LICENSE_SUPPORT_WHATSAPP?.trim() ||
        process.env.SALES_WHATSAPP?.trim() ||
        null,
    },
    state: view ? ("HAS_LICENSE" as const) : ("NO_LICENSE" as const),
    license: view,
    /** Geriye uyumluluk — FE `subscription` alanını da okuyabilir. */
    subscription: view,
  };
}

/** Tenant UI için sade geçmiş — admin e-postası / ham JSON yok. */
export async function listMyLicenseHistory(tenantId: string, limit = 20) {
  const items = await prisma.subscriptionHistory.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      action: true,
      createdAt: true,
      previousValues: true,
      newValues: true,
    },
  });

  return {
    items: items.map((item) => {
      const prev = (item.previousValues ?? {}) as Record<string, unknown>;
      const next = (item.newValues ?? {}) as Record<string, unknown>;
      return {
        id: item.id,
        action: item.action,
        label: TENANT_HISTORY_LABELS[item.action] ?? "Lisans güncellendi",
        createdAt: item.createdAt.toISOString(),
        previousEndsAt: typeof prev.endsAt === "string" ? prev.endsAt : null,
        newEndsAt: typeof next.endsAt === "string" ? next.endsAt : null,
      };
    }),
  };
}

/** @deprecated */
export async function getMySubscription(tenantId: string) {
  const subscription = await getTenantSubscription(tenantId);
  if (!subscription) return null;
  return toLicenseView(subscription);
}

export function previewDemoEndsAt(startsAt: Date, days: number) {
  return addCalendarDaysEndOfDay(startsAt, days);
}

export function previewAnnualFromDemo(demoEndsAt: Date, now = new Date()) {
  const startsAt = now;
  const base = demoEndsAt.getTime() > now.getTime() ? demoEndsAt : now;
  const endsAt = addCalendarDaysEndOfDay(base, 365);
  return { startsAt, endsAt, price: computeLicensePrice() };
}

export function previewAnnualRenew(endsAt: Date, now = new Date()) {
  const base = extendBaseDate(endsAt, now);
  return {
    startsAt: now,
    endsAt: addCalendarDaysEndOfDay(base, 365),
    price: computeLicensePrice(),
  };
}

export function priceForPlan(plan: SubscriptionPlan, customNet?: number): LicensePriceSnapshot {
  if (plan === "DEMO") return demoPriceSnapshot();
  return computeLicensePrice(customNet ?? annualNetPrice());
}

export function assertLicenseVersion(existing: { version: number; updatedAt: Date }, expected?: {
  version?: number;
  updatedAt?: string;
}) {
  if (expected?.version != null && expected.version !== existing.version) {
    throw new HttpError(
      409,
      "Lisans ön izlemeden sonra değişti. Bilgileri yenileyin.",
      "LICENSE_VERSION_CONFLICT",
    );
  }
  if (expected?.updatedAt && expected.updatedAt !== existing.updatedAt.toISOString()) {
    throw new HttpError(
      409,
      "Lisans ön izlemeden sonra değişti. Bilgileri yenileyin.",
      "LICENSE_VERSION_CONFLICT",
    );
  }
}

export function licenseWriteForbiddenError(subscription: Subscription) {
  const view = toLicenseView(subscription);
  const code =
    view.status === "SUSPENDED"
      ? "LICENSE_SUSPENDED"
      : view.status === "CANCELLED"
        ? "LICENSE_CANCELLED"
        : "LICENSE_EXPIRED";
  const message =
    view.status === "SUSPENDED"
      ? "Organizasyon erişimi platform yöneticisi tarafından askıya alındı. Yeni işlem oluşturamazsınız."
      : view.status === "CANCELLED"
        ? "Organizasyon lisansı iptal edilmiş. Verilerinizi görüntüleyebilir ancak yeni işlem oluşturamazsınız."
        : "Organizasyon lisansınızın süresi sona erdi. Verilerinizi görüntüleyebilir ancak yeni işlem oluşturamazsınız.";
  return new HttpError(403, message, code, {
    license: {
      type: view.plan,
      status: view.status,
      endsAt: view.endsAt,
      remainingDays: view.remainingDays,
      readOnly: true,
    },
  });
}

export { endOfDayFrom, addCalendarDaysEndOfDay, extendBaseDate };
