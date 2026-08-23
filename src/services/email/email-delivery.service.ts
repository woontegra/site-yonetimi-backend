import type { EmailDeliveryStatus, EmailDeliveryType, PlatformEmailIntegration, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { maskEmail } from "../../utils/admin";
import type { MailSendResult } from "./mail.types";

const FORBIDDEN_DELIVERY_META = [
  "password",
  "token",
  "activationToken",
  "activationUrl",
  "smtpPassword",
  "secret",
  "credential",
  "authorization",
];

function sanitizeDeliveryMetadata(
  metadata: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const cleaned: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (FORBIDDEN_DELIVERY_META.some((item) => key.toLowerCase().includes(item.toLowerCase()))) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function serializeDelivery(item: {
  id: string;
  type: EmailDeliveryType;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  status: EmailDeliveryStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  safeErrorCode: string | null;
  safeErrorSummary: string | null;
  relatedTenantId: string | null;
  relatedUserId: string | null;
  createdAt: Date;
  relatedTenant?: { id: string; name: string } | null;
}) {
  return {
    id: item.id,
    type: item.type,
    recipientEmailMasked: maskEmail(item.recipientEmail),
    recipientName: item.recipientName,
    subject: item.subject,
    status: item.status,
    attempts: item.attempts,
    lastAttemptAt: item.lastAttemptAt?.toISOString() ?? null,
    sentAt: item.sentAt?.toISOString() ?? null,
    safeErrorCode: item.safeErrorCode,
    safeErrorSummary: item.safeErrorSummary,
    relatedTenantId: item.relatedTenantId,
    relatedUserId: item.relatedUserId,
    relatedTenantName: item.relatedTenant?.name ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function recordFailedDelivery(input: {
  type: EmailDeliveryType;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  relatedTenantId?: string | null;
  relatedUserId?: string | null;
  safeErrorCode: string;
  safeErrorSummary: string;
}) {
  return prisma.emailDelivery.create({
    data: {
      type: input.type,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? null,
      subject: input.subject,
      status: "FAILED",
      attempts: 1,
      lastAttemptAt: new Date(),
      safeErrorCode: input.safeErrorCode,
      safeErrorSummary: input.safeErrorSummary,
      relatedTenantId: input.relatedTenantId ?? null,
      relatedUserId: input.relatedUserId ?? null,
    },
  });
}

export async function createDelivery(input: {
  type: EmailDeliveryType;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  relatedTenantId?: string | null;
  relatedUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.emailDelivery.create({
    data: {
      type: input.type,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? null,
      subject: input.subject,
      status: "PENDING",
      relatedTenantId: input.relatedTenantId ?? null,
      relatedUserId: input.relatedUserId ?? null,
      metadata: sanitizeDeliveryMetadata(input.metadata),
    },
  });
}

export async function markDeliveryResult(
  id: string,
  result: MailSendResult,
) {
  const sent = result.status === "SENT";
  return prisma.emailDelivery.update({
    where: { id },
    data: {
      status: sent ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId ?? null,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      sentAt: sent ? new Date() : undefined,
      safeErrorCode: sent ? null : result.safeErrorCode ?? "EMAIL_SEND_FAILED",
      safeErrorSummary: sent ? null : result.safeErrorSummary ?? "E-posta gönderilemedi.",
    },
  });
}

export function toPublicEmailStatus(integration: PlatformEmailIntegration | null): {
  connected: boolean;
  label: string;
  status: "READY" | "UNCONFIGURED" | "ERROR" | "INACTIVE";
} {
  if (!integration) {
    return { connected: false, label: "Yapılandırılmamış", status: "UNCONFIGURED" };
  }
  if (!integration.isActive) {
    return { connected: false, label: "Pasif", status: "INACTIVE" };
  }
  if (integration.status === "ERROR") {
    return { connected: false, label: "Bağlantı hatası", status: "ERROR" };
  }
  if (integration.status === "READY") {
    return { connected: true, label: "Kullanıma hazır", status: "READY" };
  }
  return { connected: false, label: "Yapılandırılmamış", status: "UNCONFIGURED" };
}
