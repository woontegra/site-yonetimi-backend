import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { daysUntil } from "../utils/admin";
import { HttpError } from "../utils/httpError";

/**
 * Abonelik bilgisi için merkezi okuma.
 *
 * Lisans süresi dolduğunda veya kayıt yokken hiçbir tenant verisi silinmez.
 * Bu fazda tenant API kilidi kapalıdır (LICENSE_ENFORCEMENT !== "true").
 * Kilidi açıldığında bile isPlatformAdmin (DB) abonelikten muaftır.
 */
export function isLicenseEnforcementEnabled(): boolean {
  return process.env.LICENSE_ENFORCEMENT === "true";
}

type SubscriptionValidityInput = {
  status: SubscriptionStatus;
  endsAt: Date;
} | null;

export function isSubscriptionCurrentlyValid(subscription: SubscriptionValidityInput): boolean {
  if (!subscription) return true;
  if (subscription.status === "SUSPENDED" || subscription.status === "CANCELLED") return false;
  if (subscription.status === "EXPIRED") return false;
  return subscription.endsAt.getTime() >= Date.now();
}

export type LicenseAccessReason =
  | "inactive_user"
  | "platform_admin_exempt"
  | "enforcement_disabled"
  | "subscription_valid"
  | "subscription_invalid";

export type LicenseAccessDecision = {
  allowed: boolean;
  exempt: boolean;
  reason: LicenseAccessReason;
};

export function decideLicenseAccess(input: {
  isActive: boolean;
  isPlatformAdmin: boolean;
  subscription: SubscriptionValidityInput;
  enforcementEnabled: boolean;
}): LicenseAccessDecision {
  if (!input.isActive) {
    return { allowed: false, exempt: false, reason: "inactive_user" };
  }

  if (input.isPlatformAdmin) {
    return { allowed: true, exempt: true, reason: "platform_admin_exempt" };
  }

  if (!input.enforcementEnabled) {
    return { allowed: true, exempt: false, reason: "enforcement_disabled" };
  }

  if (isSubscriptionCurrentlyValid(input.subscription)) {
    return { allowed: true, exempt: false, reason: "subscription_valid" };
  }

  return { allowed: false, exempt: false, reason: "subscription_invalid" };
}

export async function getTenantSubscription(tenantId: string) {
  return prisma.subscription.findUnique({ where: { tenantId } });
}

export function resolveLiveStatus(subscription: {
  status: SubscriptionStatus;
  endsAt: Date;
}): SubscriptionStatus {
  if (subscription.status === "SUSPENDED" || subscription.status === "CANCELLED") {
    return subscription.status;
  }
  if (subscription.endsAt.getTime() < Date.now() && subscription.status !== "EXPIRED") {
    return "EXPIRED";
  }
  return subscription.status;
}

/** Tenant kullanıcısına dönen salt okunur lisans özeti. Admin alanları yok. */
export function toTenantSubscriptionView(subscription: Subscription) {
  return {
    plan: subscription.plan,
    status: resolveLiveStatus(subscription),
    startsAt: subscription.startsAt.toISOString(),
    endsAt: subscription.endsAt.toISOString(),
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    remainingDays: daysUntil(subscription.endsAt),
  };
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
      decision: { allowed: false, exempt: false, reason: "inactive_user" as const },
    };
  }

  const subscription = tenantId ? await getTenantSubscription(tenantId) : null;
  const decision = decideLicenseAccess({
    isActive: user.isActive,
    isPlatformAdmin: user.isPlatformAdmin,
    subscription,
    enforcementEnabled: isLicenseEnforcementEnabled(),
  });

  return { user, subscription, decision };
}

export async function getMyLicenseOverview(userId: string, tenantId: string) {
  const { user, subscription, decision } = await evaluateLicenseAccess(userId, tenantId);
  if (!user || !user.isActive) {
    throw new HttpError(401, "Oturum geçersiz.");
  }

  return {
    access: {
      isPlatformAdmin: user.isPlatformAdmin,
      exempt: decision.exempt,
      accountType: user.isPlatformAdmin ? ("PLATFORM_ADMIN" as const) : ("TENANT_USER" as const),
      managementAccess: user.isPlatformAdmin
        ? ("UNLIMITED" as const)
        : ("SUBSCRIPTION_BOUND" as const),
      licenseStatus: user.isPlatformAdmin ? ("EXEMPT" as const) : ("BOUND" as const),
    },
    subscription: subscription ? toTenantSubscriptionView(subscription) : null,
  };
}

/** @deprecated Use getMyLicenseOverview. Kept for any remaining callers. */
export async function getMySubscription(tenantId: string) {
  const subscription = await getTenantSubscription(tenantId);
  if (!subscription) return null;
  return toTenantSubscriptionView(subscription);
}
