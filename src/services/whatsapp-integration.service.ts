import type { Prisma, WhatsAppTemplateStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import {
  decryptSecret,
  encryptSecret,
  tokenLastFour,
} from "../utils/secret-encryption";
import {
  getPhoneNumber,
  listMessageTemplates,
  type MetaMessageTemplate,
  type MetaTemplateComponent,
  MetaWhatsAppClientError,
} from "./meta-whatsapp-client";
import {
  extractMetaRejectionReason,
  preserveSourceOnMetaSync,
} from "../utils/whatsapp-template-sync";
import { env } from "../config/env";

export type WhatsAppParameterField =
  | "adSoyad"
  | "siteAdi"
  | "binaAdi"
  | "daireNo"
  | "borcTutari"
  | "vadeTarihi"
  | "borcAciklamasi";

export const WHATSAPP_PARAMETER_FIELDS: WhatsAppParameterField[] = [
  "adSoyad",
  "siteAdi",
  "binaAdi",
  "daireNo",
  "borcTutari",
  "vadeTarihi",
  "borcAciklamasi",
];

export type NormalizedWhatsAppTemplate = {
  bodyVariableCount: number;
  hasHeaderVariables: boolean;
  hasDynamicUrlButtonVariables: boolean;
  sendable: boolean;
};

function mapMetaTemplateStatus(status: string): WhatsAppTemplateStatus {
  const normalized = status.toUpperCase();
  switch (normalized) {
    case "DRAFT":
    case "PENDING":
    case "APPROVED":
    case "REJECTED":
    case "PAUSED":
    case "DISABLED":
      return normalized;
    default:
      return "UNKNOWN";
  }
}

function countBodyVariables(text: string | undefined): number {
  if (!text) return 0;
  const matches = text.match(/\{\{\d+\}\}/g);
  if (!matches) return 0;
  const nums = matches.map((m) => Number(m.replace(/\D/g, "")));
  return nums.length > 0 ? Math.max(...nums) : 0;
}

function componentHasDynamicUrlVars(component: MetaTemplateComponent): boolean {
  if (component.type !== "BUTTONS" || !component.buttons) return false;
  return component.buttons.some(
    (btn) =>
      btn.type === "URL" &&
      typeof btn.url === "string" &&
      /\{\{\d+\}\}/.test(btn.url),
  );
}

export function normalizeWhatsAppTemplate(
  components: MetaTemplateComponent[],
  status: WhatsAppTemplateStatus,
  isStale: boolean,
): NormalizedWhatsAppTemplate {
  let bodyVariableCount = 0;
  let hasHeaderVariables = false;
  let hasDynamicUrlButtonVariables = false;

  for (const component of components) {
    if (component.type === "BODY") {
      bodyVariableCount = countBodyVariables(component.text);
    }
    if (component.type === "HEADER" && component.format === "TEXT") {
      if (countBodyVariables(component.text) > 0) hasHeaderVariables = true;
    }
    if (componentHasDynamicUrlVars(component)) {
      hasDynamicUrlButtonVariables = true;
    }
  }

  const sendable =
    status === "APPROVED" &&
    !isStale &&
    !hasHeaderVariables &&
    !hasDynamicUrlButtonVariables;

  return {
    bodyVariableCount,
    hasHeaderVariables,
    hasDynamicUrlButtonVariables,
    sendable,
  };
}

function mapIntegrationDto(row: {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  businessPhone: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  tokenLastFour: string | null;
  apiVersion: string;
  isActive: boolean;
  connectionStatus: "DISCONNECTED" | "CONNECTED" | "ERROR";
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    businessPhone: row.businessPhone,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    accessTokenMasked: row.tokenLastFour ? `••••••••${row.tokenLastFour}` : "••••••••",
    apiVersion: row.apiVersion,
    isActive: row.isActive,
    connectionStatus: row.connectionStatus,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWhatsAppTemplateDto(
  row: {
    id: string;
    metaTemplateId: string | null;
    name: string;
    displayName: string | null;
    language: string;
    category: string | null;
    status: WhatsAppTemplateStatus;
    source: "META_SYNC" | "LIBRARY" | "CUSTOM";
    bodyText: string | null;
    parameterMapping: Prisma.JsonValue | null;
    libraryKey: string | null;
    rejectionReason: string | null;
    submittedAt: Date | null;
    componentsJson: Prisma.JsonValue;
    lastSyncedAt: Date;
    isStale: boolean;
  },
) {
  const components = (row.componentsJson as MetaTemplateComponent[]) ?? [];
  const normalized = normalizeWhatsAppTemplate(components, row.status, row.isStale);
  return {
    id: row.id,
    metaTemplateId: row.metaTemplateId,
    displayName: row.displayName,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    source: row.source,
    bodyText: row.bodyText,
    parameterMapping: row.parameterMapping as Record<string, string> | null,
    libraryKey: row.libraryKey,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    isStale: row.isStale,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    bodyVariableCount: normalized.bodyVariableCount,
    sendable: normalized.sendable,
    hasHeaderVariables: normalized.hasHeaderVariables,
    hasDynamicUrlButtonVariables: normalized.hasDynamicUrlButtonVariables,
  };
}

export class WhatsAppIntegrationService {
  async getActiveIntegration(tenantId: string) {
    return prisma.whatsAppIntegration.findFirst({
      where: { tenantId, deletedAt: null, isActive: true },
    });
  }

  async get(tenantId: string) {
    const row = await this.getActiveIntegration(tenantId);
    if (!row) return null;
    return mapIntegrationDto(row);
  }

  async connect(
    tenantId: string,
    input: { wabaId: string; phoneNumberId: string; accessToken: string },
  ) {
    const wabaId = input.wabaId.trim();
    const phoneNumberId = input.phoneNumberId.trim();
    const accessToken = input.accessToken.trim();

    if (!wabaId || !phoneNumberId || !accessToken) {
      throw new HttpError(400, "WhatsApp bağlantı bilgileri eksik.");
    }

    let phoneInfo;
    try {
      phoneInfo = await getPhoneNumber(phoneNumberId, accessToken);
    } catch (error) {
      const message =
        error instanceof MetaWhatsAppClientError
          ? error.message
          : "WhatsApp bağlantısı doğrulanamadı.";
      throw new HttpError(400, message);
    }

    const encrypted = encryptSecret(accessToken);
    const lastFour = tokenLastFour(accessToken);
    const apiVersion = env.whatsappGraphApiVersion;

    const row = await prisma.$transaction(async (tx) => {
      await tx.whatsAppIntegration.updateMany({
        where: { tenantId, deletedAt: null, isActive: true },
        data: {
          isActive: false,
          connectionStatus: "DISCONNECTED",
          deletedAt: new Date(),
        },
      });

      return tx.whatsAppIntegration.create({
        data: {
          tenantId,
          wabaId,
          phoneNumberId,
          businessPhone: phoneInfo.display_phone_number ?? null,
          displayPhoneNumber: phoneInfo.display_phone_number ?? null,
          verifiedName: phoneInfo.verified_name ?? null,
          accessTokenEncrypted: encrypted,
          tokenLastFour: lastFour,
          apiVersion,
          isActive: true,
          connectionStatus: "CONNECTED",
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
    });

    return mapIntegrationDto(row);
  }

  async test(tenantId: string) {
    const integration = await this.getActiveIntegration(tenantId);
    if (!integration || integration.connectionStatus !== "CONNECTED") {
      throw new HttpError(400, "WhatsApp bağlantısı kurulmamış.");
    }

    let accessToken: string;
    try {
      accessToken = decryptSecret(integration.accessTokenEncrypted);
    } catch {
      throw new HttpError(500, "WhatsApp erişim anahtarı çözülemedi.");
    }

    try {
      const phoneInfo = await getPhoneNumber(integration.phoneNumberId, accessToken);
      const row = await prisma.whatsAppIntegration.update({
        where: { id: integration.id },
        data: {
          displayPhoneNumber: phoneInfo.display_phone_number ?? integration.displayPhoneNumber,
          verifiedName: phoneInfo.verified_name ?? integration.verifiedName,
          businessPhone: phoneInfo.display_phone_number ?? integration.businessPhone,
          connectionStatus: "CONNECTED",
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
      return mapIntegrationDto(row);
    } catch (error) {
      const message =
        error instanceof MetaWhatsAppClientError
          ? error.message
          : "WhatsApp bağlantısı doğrulanamadı.";
      await prisma.whatsAppIntegration.update({
        where: { id: integration.id },
        data: {
          connectionStatus: "ERROR",
          lastCheckedAt: new Date(),
          lastError: message,
        },
      });
      throw new HttpError(400, message);
    }
  }

  async disconnect(tenantId: string) {
    const integration = await this.getActiveIntegration(tenantId);
    if (!integration) return { ok: true };

    await prisma.whatsAppIntegration.update({
      where: { id: integration.id },
      data: {
        isActive: false,
        connectionStatus: "DISCONNECTED",
        deletedAt: new Date(),
      },
    });
    return { ok: true };
  }

  async syncTemplates(tenantId: string) {
    const integration = await this.getActiveIntegration(tenantId);
    if (!integration || integration.connectionStatus !== "CONNECTED") {
      throw new HttpError(400, "WhatsApp bağlantısı kurulmamış.");
    }

    const accessToken = decryptSecret(integration.accessTokenEncrypted);
    let metaTemplates: MetaMessageTemplate[];
    try {
      metaTemplates = await listMessageTemplates(integration.wabaId, accessToken);
    } catch (error) {
      const message =
        error instanceof MetaWhatsAppClientError
          ? error.message
          : "WhatsApp bağlantısı doğrulanamadı.";
      throw new HttpError(400, message);
    }

    const now = new Date();
    const seenKeys = new Set<string>();

    await prisma.$transaction(async (tx) => {
      for (const meta of metaTemplates) {
        const key = `${meta.name}:${meta.language}`;
        seenKeys.add(key);
        const status = mapMetaTemplateStatus(meta.status);
        const components = meta.components ?? [];
        const rejectionReason = extractMetaRejectionReason(meta);

        const existing = await tx.whatsAppTemplate.findUnique({
          where: {
            tenantId_name_language: {
              tenantId,
              name: meta.name,
              language: meta.language,
            },
          },
        });

        if (existing?.status === "DRAFT") {
          continue;
        }

        const preservedSource = preserveSourceOnMetaSync(existing?.source);

        await tx.whatsAppTemplate.upsert({
          where: {
            tenantId_name_language: {
              tenantId,
              name: meta.name,
              language: meta.language,
            },
          },
          create: {
            tenantId,
            integrationId: integration.id,
            metaTemplateId: meta.id,
            name: meta.name,
            language: meta.language,
            category: meta.category ?? null,
            status,
            source: "META_SYNC",
            componentsJson: components as Prisma.InputJsonValue,
            lastSyncedAt: now,
            isStale: false,
            ...(rejectionReason ? { rejectionReason } : {}),
          },
          update: {
            integrationId: integration.id,
            metaTemplateId: meta.id,
            category: meta.category ?? null,
            status,
            componentsJson: components as Prisma.InputJsonValue,
            lastSyncedAt: now,
            isStale: false,
            ...(preservedSource ? { source: preservedSource } : {}),
            ...(status === "REJECTED" && rejectionReason
              ? { rejectionReason }
              : status !== "REJECTED"
                ? { rejectionReason: null }
                : {}),
          },
        });
      }

      const staleFilter = {
        tenantId,
        integrationId: integration.id,
        deletedAt: null,
        status: { not: "DRAFT" as WhatsAppTemplateStatus },
        NOT: {
          OR: Array.from(seenKeys).map((key) => {
            const colonIndex = key.indexOf(":");
            const name = key.slice(0, colonIndex);
            const language = key.slice(colonIndex + 1);
            return { AND: [{ name }, { language }] };
          }),
        },
      };

      if (seenKeys.size > 0) {
        await tx.whatsAppTemplate.updateMany({
          where: staleFilter,
          data: {
            isStale: true,
          },
        });
      } else {
        await tx.whatsAppTemplate.updateMany({
          where: {
            tenantId,
            integrationId: integration.id,
            deletedAt: null,
            status: { not: "DRAFT" },
          },
          data: { isStale: true },
        });
      }
    });

    return this.listTemplates(tenantId, {});
  }

  async listTemplates(
    tenantId: string,
    query: { status?: WhatsAppTemplateStatus; language?: string; search?: string },
  ) {
    const integration = await this.getActiveIntegration(tenantId);
    if (!integration) {
      return { items: [], syncedAt: null };
    }

    const items = await prisma.whatsAppTemplate.findMany({
      where: {
        tenantId,
        integrationId: integration.id,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.language ? { language: query.language } : {}),
        ...(query.search
          ? { name: { contains: query.search, mode: "insensitive" } }
          : {}),
      },
      orderBy: [{ name: "asc" }, { language: "asc" }],
    });

    return {
      items: items.map(mapWhatsAppTemplateDto),
      syncedAt: items[0]?.lastSyncedAt.toISOString() ?? null,
    };
  }

  async getDecryptedToken(tenantId: string): Promise<{
    integration: NonNullable<Awaited<ReturnType<WhatsAppIntegrationService["getActiveIntegration"]>>>;
    accessToken: string;
  }> {
    const integration = await this.getActiveIntegration(tenantId);
    if (!integration || integration.connectionStatus !== "CONNECTED") {
      throw new HttpError(400, "WhatsApp bağlantısı kurulmamış.");
    }
    const accessToken = decryptSecret(integration.accessTokenEncrypted);
    return { integration, accessToken };
  }

  validateParameterMapping(
    bodyVariableCount: number,
    mapping: Record<string, string> | null | undefined,
  ): boolean {
    if (bodyVariableCount === 0) return true;
    if (!mapping || typeof mapping !== "object") return false;
    for (let i = 1; i <= bodyVariableCount; i += 1) {
      const key = String(i);
      const field = mapping[key];
      if (!field || !WHATSAPP_PARAMETER_FIELDS.includes(field as WhatsAppParameterField)) {
        return false;
      }
    }
    return true;
  }

  buildBodyParameters(
    bodyVariableCount: number,
    mapping: Record<string, string>,
    values: Record<WhatsAppParameterField, string>,
  ): string[] {
    const params: string[] = [];
    for (let i = 1; i <= bodyVariableCount; i += 1) {
      const field = mapping[String(i)] as WhatsAppParameterField;
      params.push(values[field] ?? "");
    }
    return params;
  }
}

export const whatsAppIntegrationService = new WhatsAppIntegrationService();
