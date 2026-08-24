import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const FORBIDDEN = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "secret",
  "credential",
  "smtpPassword",
  "activationToken",
  "authorization",
  "activationUrl",
];

function sanitizeMetadata(metadata: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
  if (metadata === undefined || metadata === null) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const cleaned: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (FORBIDDEN.some((item) => key.toLowerCase().includes(item.toLowerCase()))) continue;
    if (value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export async function writeTenantAudit(input: {
  tenantId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.tenantAuditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: sanitizeMetadata(input.metadata),
    },
  });
}
