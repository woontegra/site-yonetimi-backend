import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const FORBIDDEN_META_KEYS = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "encryptionKey",
  "credential",
  "credentials",
  "smtpPassword",
  "encryptedSmtpPassword",
  "activationToken",
  "authorization",
  "activationUrl",
];

function sanitizeMetadata(metadata: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
  if (metadata === undefined || metadata === null) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return metadata;

  const cleaned: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (FORBIDDEN_META_KEYS.some((item) => key.toLowerCase().includes(item.toLowerCase()))) {
      continue;
    }
    if (value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
      cleaned[key] = value as Prisma.InputJsonValue;
    }
  }
  return cleaned;
}

export async function writeAdminAudit(input: {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  tenantId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      tenantId: input.tenantId ?? null,
      metadata: sanitizeMetadata(input.metadata) ?? undefined,
    },
  });
}

export class AdminAuditService {
  async list(query: {
    page: number;
    perPage: number;
    tenantId?: string;
    action?: string;
    search?: string;
    targetType?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { targetType: { contains: search, mode: "insensitive" } },
        { adminUser: { fullName: { contains: search, mode: "insensitive" } } },
        { adminUser: { email: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          tenantId: true,
          metadata: true,
          createdAt: true,
          adminUser: { select: { id: true, fullName: true, email: true } },
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    return { items, page: query.page, perPage: query.perPage, total };
  }
}

export const adminAuditService = new AdminAuditService();
