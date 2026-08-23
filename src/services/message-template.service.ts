import type { Prisma } from "@prisma/client";
import { Prisma as PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import {
  DEFAULT_DEBT_REMINDER_TEMPLATE_BODY,
} from "./message-template-renderer";
import type { MetaTemplateComponent } from "./meta-whatsapp-client";
import {
  normalizeWhatsAppTemplate,
  whatsAppIntegrationService,
} from "./whatsapp-integration.service";
import type {
  ListMessageTemplatesQuery,
  UpsertMessageTemplateInput,
} from "../validators/communication.validators";

function mapWhatsAppTemplateSummary(
  row: {
    id: string;
    name: string;
    language: string;
    status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED" | "UNKNOWN";
    isStale: boolean;
    componentsJson: Prisma.JsonValue;
  } | null,
) {
  if (!row) return null;
  const components = (row.componentsJson as MetaTemplateComponent[]) ?? [];
  const normalized = normalizeWhatsAppTemplate(components, row.status, row.isStale);
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    status: row.status,
    isStale: row.isStale,
    bodyVariableCount: normalized.bodyVariableCount,
    sendable: normalized.sendable,
  };
}

function mapTemplate(row: {
  id: string;
  name: string;
  channel: "WHATSAPP" | "SMS";
  body: string;
  whatsAppTemplateId: string | null;
  whatsAppParameterMapping: Prisma.JsonValue | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  whatsAppTemplate?: {
    id: string;
    name: string;
    language: string;
    status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED" | "UNKNOWN";
    isStale: boolean;
    componentsJson: Prisma.JsonValue;
  } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    body: row.body,
    whatsAppTemplateId: row.whatsAppTemplateId,
    whatsAppParameterMapping: row.whatsAppParameterMapping as Record<string, string> | null,
    whatsAppTemplate: mapWhatsAppTemplateSummary(row.whatsAppTemplate ?? null),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const templateInclude = {
  whatsAppTemplate: {
    select: {
      id: true,
      name: true,
      language: true,
      status: true,
      isStale: true,
      componentsJson: true,
    },
  },
} as const;

async function validateWhatsAppTemplateLink(
  tenantId: string,
  channel: "WHATSAPP" | "SMS",
  whatsAppTemplateId: string | null | undefined,
  whatsAppParameterMapping: Record<string, string> | null | undefined,
) {
  if (channel !== "WHATSAPP") return;

  if (!whatsAppTemplateId) return;

  const waTemplate = await prisma.whatsAppTemplate.findFirst({
    where: { id: whatsAppTemplateId, tenantId },
  });
  if (!waTemplate) {
    throw new HttpError(400, "WhatsApp şablonu bulunamadı.");
  }
  if (waTemplate.status !== "APPROVED" || waTemplate.isStale) {
    throw new HttpError(400, "Seçilen WhatsApp şablonu gönderime uygun değil.");
  }

  const components = (waTemplate.componentsJson as MetaTemplateComponent[]) ?? [];
  const normalized = normalizeWhatsAppTemplate(
    components,
    waTemplate.status,
    waTemplate.isStale,
  );

  if (!normalized.sendable) {
    throw new HttpError(
      400,
      "Bu WhatsApp şablonu başlık veya dinamik URL değişkeni içeriyor; desteklenmiyor.",
    );
  }

  if (
    !whatsAppIntegrationService.validateParameterMapping(
      normalized.bodyVariableCount,
      whatsAppParameterMapping,
    )
  ) {
    throw new HttpError(400, "WhatsApp şablonundaki tüm değişkenleri eşleştirin.");
  }
}

export async function ensureDefaultMessageTemplates(tenantId: string) {
  const count = await prisma.messageTemplate.count({
    where: { tenantId, deletedAt: null },
  });
  if (count > 0) return;

  await prisma.messageTemplate.createMany({
    data: [
      {
        tenantId,
        name: "Borç Hatırlatma",
        channel: "WHATSAPP",
        body: DEFAULT_DEBT_REMINDER_TEMPLATE_BODY,
        isActive: true,
      },
      {
        tenantId,
        name: "Borç Hatırlatma",
        channel: "SMS",
        body: DEFAULT_DEBT_REMINDER_TEMPLATE_BODY,
        isActive: true,
      },
    ],
  });
}

export class MessageTemplateService {
  async list(tenantId: string, query: ListMessageTemplatesQuery) {
    await ensureDefaultMessageTemplates(tenantId);
    const items = await prisma.messageTemplate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      include: templateInclude,
      orderBy: [{ channel: "asc" }, { name: "asc" }, { createdAt: "desc" }],
    });
    return { items: items.map(mapTemplate) };
  }

  async create(tenantId: string, input: UpsertMessageTemplateInput) {
    await validateWhatsAppTemplateLink(
      tenantId,
      input.channel,
      input.whatsAppTemplateId,
      input.whatsAppParameterMapping ?? null,
    );

    const row = await prisma.messageTemplate.create({
      data: {
        tenantId,
        name: input.name.trim(),
        channel: input.channel,
        body: input.body.trim(),
        isActive: input.isActive ?? true,
        ...(input.channel === "WHATSAPP"
          ? {
              whatsAppTemplateId: input.whatsAppTemplateId ?? null,
              whatsAppParameterMapping:
                (input.whatsAppParameterMapping as Prisma.InputJsonValue) ?? null,
            }
          : {
              whatsAppTemplateId: null,
              whatsAppParameterMapping: PrismaClient.JsonNull,
            }),
      },
      include: templateInclude,
    });
    return mapTemplate(row);
  }

  async update(tenantId: string, id: string, input: UpsertMessageTemplateInput) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");

    await validateWhatsAppTemplateLink(
      tenantId,
      input.channel,
      input.whatsAppTemplateId,
      input.whatsAppParameterMapping ?? null,
    );

    const row = await prisma.messageTemplate.update({
      where: { id },
      data: {
        name: input.name.trim(),
        channel: input.channel,
        body: input.body.trim(),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.channel === "WHATSAPP"
          ? {
              whatsAppTemplateId: input.whatsAppTemplateId ?? null,
              whatsAppParameterMapping:
                (input.whatsAppParameterMapping as Prisma.InputJsonValue) ?? null,
            }
          : {
              whatsAppTemplateId: null,
              whatsAppParameterMapping: PrismaClient.JsonNull,
            }),
      },
      include: templateInclude,
    });
    return mapTemplate(row);
  }

  async setActive(tenantId: string, id: string, isActive: boolean) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    return mapTemplate(
      await prisma.messageTemplate.update({
        where: { id },
        data: { isActive },
        include: templateInclude,
      }),
    );
  }

  async remove(tenantId: string, id: string) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    await prisma.messageTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}

export const messageTemplateService = new MessageTemplateService();
