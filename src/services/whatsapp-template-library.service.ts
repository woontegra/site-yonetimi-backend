import type {
  Prisma,
  WhatsAppTemplate,
  WhatsAppTemplateStatus,
} from "@prisma/client";
import { Prisma as PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  getLibraryTemplate,
  WHATSAPP_TEMPLATE_LIBRARY,
  type WhatsAppLibraryTemplate,
} from "../data/whatsapp-template-library";
import { HttpError } from "../utils/httpError";
import {
  bodyToNamedPreviewBody,
  buildComponentsJson,
  countBodyVariables,
  normalizeMetaTemplateName,
  validateBodyForMeta,
} from "../utils/whatsapp-template-body";
import { createMessageTemplate, type MetaTemplateComponent } from "./meta-whatsapp-client";
import { isOwnedSiteYonetimiTemplate } from "../utils/whatsapp-template-name";
import {
  normalizeWhatsAppTemplate,
  WHATSAPP_PARAMETER_FIELDS,
  whatsAppIntegrationService,
  type WhatsAppParameterField,
} from "./whatsapp-integration.service";

const STATUS_LABELS: Record<WhatsAppTemplateStatus, string> = {
  DRAFT: "Taslak",
  PENDING: "Meta İncelemesinde",
  APPROVED: "Onaylı",
  REJECTED: "Reddedildi",
  PAUSED: "Duraklatıldı",
  DISABLED: "Devre Dışı",
  UNKNOWN: "Bilinmiyor",
};

const EXAMPLE_PARAM_VALUES: Record<WhatsAppParameterField, string> = {
  adSoyad: "Ahmet Yılmaz",
  siteAdi: "Örnek Site Yönetimi",
  binaAdi: "A Blok",
  daireNo: "12",
  borcTutari: "1.250,00 ₺",
  vadeTarihi: "01.09.2026",
  borcAciklamasi: "Aidat",
};

export type CustomTemplateInput = {
  displayName: string;
  name?: string;
  language: string;
  category: string;
  bodyText: string;
  parameterMapping: Record<string, string>;
};

export type UpdateDraftTemplateInput = {
  displayName?: string;
  name?: string;
  language?: string;
  category?: string;
  bodyText?: string;
  parameterMapping?: Record<string, string>;
};

type TemplateRow = WhatsAppTemplate & {
  messageTemplates: Array<{ id: string }>;
};

function mapTemplateDto(row: TemplateRow) {
  const components = (row.componentsJson as MetaTemplateComponent[]) ?? [];
  const normalized = normalizeWhatsAppTemplate(components, row.status, row.isStale);
  return {
    id: row.id,
    displayName: row.displayName,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    source: row.source,
    bodyText: row.bodyText,
    parameterMapping: row.parameterMapping as Record<string, string> | null,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    sendable: normalized.sendable,
    libraryKey: row.libraryKey,
    metaTemplateId: row.metaTemplateId,
    messageTemplateId: row.messageTemplates[0]?.id ?? null,
    messageTemplateCount: row.messageTemplates.length,
  };
}

function validateParameterMapping(
  bodyText: string,
  mapping: Record<string, string>,
): void {
  const varCount = countBodyVariables(bodyText);
  if (varCount === 0) return;
  if (
    !whatsAppIntegrationService.validateParameterMapping(varCount, mapping)
  ) {
    throw new HttpError(
      400,
      "Tüm şablon değişkenleri geçerli alanlarla eşleştirilmelidir.",
    );
  }
}

async function syncLinkedMessageTemplate(
  tenantId: string,
  row: Pick<
    WhatsAppTemplate,
    "id" | "displayName" | "name" | "bodyText" | "parameterMapping"
  >,
): Promise<void> {
  const displayName = row.displayName ?? row.name;
  const body = bodyToNamedPreviewBody(
    row.bodyText ?? "",
    row.parameterMapping as Record<string, string> | null,
  );
  const mappingJson = row.parameterMapping as Prisma.InputJsonValue | null | undefined;

  const existing = await prisma.messageTemplate.findFirst({
    where: { tenantId, whatsAppTemplateId: row.id, deletedAt: null },
  });

  const mappingField =
    mappingJson === null || mappingJson === undefined
      ? PrismaClient.JsonNull
      : mappingJson;

  if (existing) {
    await prisma.messageTemplate.update({
      where: { id: existing.id },
      data: {
        name: displayName,
        body,
        whatsAppParameterMapping: mappingField,
        isActive: true,
      },
    });
    return;
  }

  await prisma.messageTemplate.create({
    data: {
      tenantId,
      name: displayName,
      channel: "WHATSAPP",
      body,
      whatsAppTemplateId: row.id,
      whatsAppParameterMapping: mappingField,
      isActive: true,
    },
  });
}

async function ensureUniqueName(
  tenantId: string,
  name: string,
  language: string,
  excludeId?: string,
): Promise<void> {
  const existing = await prisma.whatsAppTemplate.findFirst({
    where: {
      tenantId,
      name,
      language,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new HttpError(
      409,
      "Bu isim ve dilde bir şablon zaten mevcut. Farklı bir Meta şablon adı seçin.",
    );
  }
}

function buildExampleParams(
  bodyText: string,
  mapping: Record<string, string>,
): string[] {
  const count = countBodyVariables(bodyText);
  const params: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const field = mapping[String(i)] as WhatsAppParameterField | undefined;
    params.push(
      field && WHATSAPP_PARAMETER_FIELDS.includes(field)
        ? EXAMPLE_PARAM_VALUES[field]
        : "örnek",
    );
  }
  return params;
}

export class WhatsAppTemplateLibraryService {
  listLibrary(): WhatsAppLibraryTemplate[] {
    return WHATSAPP_TEMPLATE_LIBRARY;
  }

  async listMine(tenantId: string) {
    const items = await prisma.whatsAppTemplate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        NOT: { name: { startsWith: "mk_", mode: "insensitive" } },
      },
      include: {
        messageTemplates: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { displayName: "asc" }, { name: "asc" }],
    });
    return {
      items: items
        .filter((row) => isOwnedSiteYonetimiTemplate(row))
        .map(mapTemplateDto),
    };
  }

  async createFromLibrary(tenantId: string, libraryKey: string) {
    const libraryItem = getLibraryTemplate(libraryKey);
    if (!libraryItem) {
      throw new HttpError(404, "Kütüphane şablonu bulunamadı.");
    }

    const name = libraryItem.suggestedMetaName;
    await ensureUniqueName(tenantId, name, libraryItem.language);

    const now = new Date();
    const components = buildComponentsJson(libraryItem.bodyText);

    const row = await prisma.whatsAppTemplate.create({
      data: {
        tenantId,
        integrationId: null,
        name,
        displayName: libraryItem.displayName,
        language: libraryItem.language,
        category: libraryItem.category,
        status: "DRAFT",
        source: "LIBRARY",
        libraryKey: libraryItem.key,
        bodyText: libraryItem.bodyText,
        parameterMapping: libraryItem.parameterMapping as Prisma.InputJsonValue,
        componentsJson: components as Prisma.InputJsonValue,
        lastSyncedAt: now,
        isStale: false,
      },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    await syncLinkedMessageTemplate(tenantId, row);
    const refreshed = await prisma.whatsAppTemplate.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    return mapTemplateDto(refreshed);
  }

  async createCustom(tenantId: string, input: CustomTemplateInput) {
    const bodyValidation = validateBodyForMeta(input.bodyText);
    if (!bodyValidation.valid) {
      throw new HttpError(400, bodyValidation.error);
    }

    validateParameterMapping(input.bodyText, input.parameterMapping);

    const name = normalizeMetaTemplateName(input.name ?? input.displayName);
    await ensureUniqueName(tenantId, name, input.language);

    const now = new Date();
    const components = buildComponentsJson(input.bodyText);

    const row = await prisma.whatsAppTemplate.create({
      data: {
        tenantId,
        integrationId: null,
        name,
        displayName: input.displayName.trim(),
        language: input.language.trim(),
        category: input.category.trim(),
        status: "DRAFT",
        source: "CUSTOM",
        bodyText: input.bodyText.trim(),
        parameterMapping: input.parameterMapping as Prisma.InputJsonValue,
        componentsJson: components as Prisma.InputJsonValue,
        lastSyncedAt: now,
        isStale: false,
      },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    await syncLinkedMessageTemplate(tenantId, row);
    const refreshed = await prisma.whatsAppTemplate.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    return mapTemplateDto(refreshed);
  }

  async updateDraft(tenantId: string, id: string, input: UpdateDraftTemplateInput) {
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    if (existing.status !== "DRAFT") {
      throw new HttpError(400, "Yalnızca taslak şablonlar düzenlenebilir.");
    }

    const bodyText = input.bodyText ?? existing.bodyText ?? "";
    const parameterMapping =
      input.parameterMapping ??
      (existing.parameterMapping as Record<string, string> | null) ??
      {};

    if (input.bodyText !== undefined) {
      const bodyValidation = validateBodyForMeta(bodyText);
      if (!bodyValidation.valid) {
        throw new HttpError(400, bodyValidation.error);
      }
    }

    validateParameterMapping(bodyText, parameterMapping);

    const displayName = input.displayName?.trim() ?? existing.displayName ?? existing.name;
    const language = input.language?.trim() ?? existing.language;
    const category = input.category?.trim() ?? existing.category ?? "UTILITY";
    const name = input.name
      ? normalizeMetaTemplateName(input.name)
      : input.displayName
        ? normalizeMetaTemplateName(input.displayName)
        : existing.name;

    if (name !== existing.name || language !== existing.language) {
      await ensureUniqueName(tenantId, name, language, id);
    }

    const components = buildComponentsJson(bodyText);

    const row = await prisma.whatsAppTemplate.update({
      where: { id },
      data: {
        name,
        displayName,
        language,
        category,
        bodyText,
        parameterMapping: parameterMapping as Prisma.InputJsonValue,
        componentsJson: components as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    await syncLinkedMessageTemplate(tenantId, row);
    return mapTemplateDto(row);
  }

  async deleteDraft(tenantId: string, id: string) {
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    if (existing.status === "APPROVED") {
      throw new HttpError(400, "Onaylı şablonlar silinemez.");
    }
    if (existing.status !== "DRAFT") {
      throw new HttpError(400, "Yalnızca taslak şablonlar silinebilir.");
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.whatsAppTemplate.update({
        where: { id },
        data: { deletedAt: now },
      }),
      prisma.messageTemplate.updateMany({
        where: { tenantId, whatsAppTemplateId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      }),
    ]);

    return { ok: true };
  }

  async submitToMeta(tenantId: string, id: string) {
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    if (existing.status !== "DRAFT") {
      throw new HttpError(400, "Yalnızca taslak şablonlar Meta'ya gönderilebilir.");
    }

    const bodyText = existing.bodyText ?? "";
    const bodyValidation = validateBodyForMeta(bodyText);
    if (!bodyValidation.valid) {
      throw new HttpError(400, bodyValidation.error);
    }

    const parameterMapping =
      (existing.parameterMapping as Record<string, string> | null) ?? {};
    validateParameterMapping(bodyText, parameterMapping);

    if (!existing.language?.trim()) {
      throw new HttpError(400, "Şablon dili zorunludur.");
    }
    if (!existing.category?.trim()) {
      throw new HttpError(400, "Şablon kategorisi zorunludur.");
    }

    const { integration, accessToken } =
      await whatsAppIntegrationService.getDecryptedToken(tenantId);

    const result = await createMessageTemplate({
      wabaId: integration.wabaId,
      accessToken,
      name: existing.name,
      language: existing.language,
      category: existing.category,
      bodyText,
      bodyExampleParams: buildExampleParams(bodyText, parameterMapping),
    });

    const now = new Date();
    const row = await prisma.whatsAppTemplate.update({
      where: { id },
      data: {
        status: "PENDING",
        integrationId: integration.id,
        metaTemplateId: result.id ?? existing.metaTemplateId,
        submittedAt: now,
        lastSyncedAt: now,
        rejectionReason: null,
        isStale: false,
      },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    return {
      item: mapTemplateDto(row),
      message: "Şablon Meta incelemesine gönderildi.",
    };
  }

  async duplicateAsDraft(tenantId: string, id: string) {
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new HttpError(404, "Şablon bulunamadı.");
    if (existing.status !== "REJECTED") {
      throw new HttpError(400, "Yalnızca reddedilen şablonlar kopyalanabilir.");
    }

    let candidateName = `${existing.name}_kopya`;
    let suffix = 2;
    while (true) {
      const conflict = await prisma.whatsAppTemplate.findFirst({
        where: {
          tenantId,
          name: candidateName,
          language: existing.language,
          deletedAt: null,
        },
      });
      if (!conflict) break;
      candidateName = `${existing.name}_kopya_${suffix}`;
      suffix += 1;
    }

    const now = new Date();
    const bodyText = existing.bodyText ?? "";
    const components =
      bodyText.length > 0
        ? buildComponentsJson(bodyText)
        : ((existing.componentsJson as MetaTemplateComponent[]) ?? []);

    const row = await prisma.whatsAppTemplate.create({
      data: {
        tenantId,
        integrationId: null,
        name: candidateName,
        displayName: existing.displayName
          ? `${existing.displayName} (Kopya)`
          : `${existing.name} (Kopya)`,
        language: existing.language,
        category: existing.category,
        status: "DRAFT",
        source: existing.source === "META_SYNC" ? "CUSTOM" : existing.source,
        libraryKey: existing.libraryKey,
        bodyText: existing.bodyText,
        parameterMapping: existing.parameterMapping ?? undefined,
        componentsJson: components as Prisma.InputJsonValue,
        lastSyncedAt: now,
        isStale: false,
      },
      include: {
        messageTemplates: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    await syncLinkedMessageTemplate(tenantId, row);
    return mapTemplateDto(row);
  }
}

export const whatsAppTemplateLibraryService = new WhatsAppTemplateLibraryService();
