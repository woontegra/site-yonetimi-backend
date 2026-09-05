import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { resolveEffectiveStatus, toLicenseView } from "./entitlement.service";

export type AdminOwnerView = {
  id: string;
  fullName: string;
  email: string;
} | null;

export function pickOwner(
  memberships: Array<{
    role: string;
    createdAt: Date;
    user: { id: string; fullName: string; email: string };
  }>,
): AdminOwnerView {
  const sorted = [...memberships].sort((a, b) => {
    const aRank = a.role === "SITE_YONETICISI" ? 0 : 1;
    const bRank = b.role === "SITE_YONETICISI" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const owner = sorted[0]?.user;
  return owner ? { id: owner.id, fullName: owner.fullName, email: owner.email } : null;
}

export function toSubscriptionView(subscription: Subscription | null) {
  if (!subscription) return null;
  return toLicenseView(subscription);
}

export function resolveLiveStatus(subscription: {
  status: SubscriptionStatus;
  endsAt: Date;
}): SubscriptionStatus {
  return resolveEffectiveStatus(subscription);
}

export const notDeleted = { deletedAt: null } as const;
