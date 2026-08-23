import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { normalizeTrPhone } from "../utils/phone";
import { assertBuildingInSite, assertSiteInTenant } from "../utils/siteScope";
import { getMessageProvider, getWhatsAppProviderMode, resolveWhatsAppProvider } from "./message-provider";
import type { MetaTemplateComponent } from "./meta-whatsapp-client";
import {
  normalizeWhatsAppTemplate,
  whatsAppIntegrationService,
  type WhatsAppParameterField,
} from "./whatsapp-integration.service";
import {
  DEFAULT_DEBT_REMINDER_TEMPLATE_BODY,
  formatTrDate,
  formatTrMoney,
  renderMessageTemplate,
} from "./message-template-renderer";
import { ensureDefaultMessageTemplates } from "./message-template.service";
import type {
  DebtReminderPreviewQuery,
  DebtReminderSendInput,
  ListCommunicationMessagesQuery,
} from "../validators/communication.validators";

type RelationType = "TENANT" | "OWNER";

type RelationRow = {
  relationType: RelationType;
  isPrimary: boolean;
  isActive: boolean;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    isActive: boolean;
    deletedAt: Date | null;
  };
};

const messageInclude = {
  person: { select: { id: true, firstName: true, lastName: true } },
  apartment: {
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true } },
    },
  },
} as const;

function personFullName(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`.trim();
}

function pickRelation(relations: RelationRow[], type: RelationType): RelationRow | null {
  const active = relations.filter(
    (row) =>
      row.isActive &&
      row.relationType === type &&
      row.person.isActive &&
      row.person.deletedAt == null,
  );
  if (active.length === 0) return null;
  return active.find((row) => row.isPrimary) ?? active[0] ?? null;
}

export type DebtReminderRecipientPreview = {
  personId: string;
  personName: string;
  phone: string | null;
  normalizedPhone: string | null;
  hasPhone: boolean;
  relationType: RelationType;
  buildingId: string;
  buildingName: string;
  apartmentId: string;
  apartmentNumber: string;
  openDebtCount: number;
  totalRemainingAmount: string;
  oldestDueDate: string;
  debtDescription: string;
  previewText: string;
};

export class CommunicationService {
  async previewDebtReminders(
    tenantId: string,
    siteId: string,
    query: DebtReminderPreviewQuery,
  ) {
    const site = await assertSiteInTenant(tenantId, siteId, { requireActive: false });
    if (query.buildingId) {
      await assertBuildingInSite(tenantId, siteId, query.buildingId);
    }

    await ensureDefaultMessageTemplates(tenantId);

    const template = query.templateId
      ? await prisma.messageTemplate.findFirst({
          where: {
            id: query.templateId,
            tenantId,
            channel: query.channel,
            deletedAt: null,
            isActive: true,
          },
        })
      : await prisma.messageTemplate.findFirst({
          where: {
            tenantId,
            channel: query.channel,
            deletedAt: null,
            isActive: true,
          },
          orderBy: { createdAt: "asc" },
        });

    const body = template?.body ?? DEFAULT_DEBT_REMINDER_TEMPLATE_BODY;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const debts = await prisma.apartmentDebt.findMany({
      where: {
        tenantId,
        status: "OPEN",
        remainingAmount: { gt: 0 },
        building: { siteId, deletedAt: null },
        apartment: { deletedAt: null },
        ...(query.buildingId ? { buildingId: query.buildingId } : {}),
        ...(query.overdueOnly ? { dueDate: { lt: today } } : {}),
      },
      select: {
        id: true,
        title: true,
        remainingAmount: true,
        dueDate: true,
        buildingId: true,
        apartmentId: true,
        building: { select: { id: true, name: true } },
        apartment: {
          select: {
            id: true,
            number: true,
            relations: {
              where: { isActive: true },
              select: {
                relationType: true,
                isPrimary: true,
                isActive: true,
                person: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    isActive: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { dueDate: "asc" },
    });

    const byApartment = new Map<string, typeof debts>();
    for (const debt of debts) {
      const list = byApartment.get(debt.apartmentId) ?? [];
      list.push(debt);
      byApartment.set(debt.apartmentId, list);
    }

    const recipients: DebtReminderRecipientPreview[] = [];
    const seenPhones = new Set<string>();

    for (const apartmentDebts of byApartment.values()) {
      const sample = apartmentDebts[0];
      if (!sample) continue;

      let total = new Prisma.Decimal(0);
      let oldestDue = sample.dueDate;
      const titles: string[] = [];
      for (const debt of apartmentDebts) {
        total = total.add(debt.remainingAmount);
        if (debt.dueDate < oldestDue) oldestDue = debt.dueDate;
        titles.push(debt.title);
      }

      const totalStr = total.toFixed(2);
      const description = titles.slice(0, 3).join(", ");

      for (const type of query.relationTypes) {
        const relation = pickRelation(sample.apartment.relations as RelationRow[], type);
        if (!relation) continue;

        const personName = personFullName(relation.person);
        if (query.search) {
          const q = query.search.toLocaleLowerCase("tr");
          const hay =
            `${personName} ${sample.apartment.number} ${sample.building.name}`.toLocaleLowerCase(
              "tr",
            );
          if (!hay.includes(q)) continue;
        }

        const normalizedPhone = normalizeTrPhone(relation.person.phone);
        if (normalizedPhone && seenPhones.has(normalizedPhone)) continue;
        if (normalizedPhone) seenPhones.add(normalizedPhone);

        const previewText = renderMessageTemplate(body, {
          adSoyad: personName,
          siteAdi: site.name,
          binaAdi: sample.building.name,
          daireNo: sample.apartment.number,
          borcTutari: formatTrMoney(totalStr),
          vadeTarihi: formatTrDate(oldestDue),
          borcAciklamasi: description,
        });

        recipients.push({
          personId: relation.person.id,
          personName,
          phone: relation.person.phone,
          normalizedPhone,
          hasPhone: Boolean(normalizedPhone),
          relationType: type,
          buildingId: sample.building.id,
          buildingName: sample.building.name,
          apartmentId: sample.apartment.id,
          apartmentNumber: sample.apartment.number,
          openDebtCount: apartmentDebts.length,
          totalRemainingAmount: totalStr,
          oldestDueDate: oldestDue.toISOString(),
          debtDescription: description,
          previewText,
        });
      }
    }

    recipients.sort((a, b) => {
      const byBuilding = a.buildingName.localeCompare(b.buildingName, "tr");
      if (byBuilding !== 0) return byBuilding;
      return a.apartmentNumber.localeCompare(b.apartmentNumber, "tr", { numeric: true });
    });

    const withPhoneCount = recipients.filter((r) => r.hasPhone).length;
    const totalRemaining = recipients.reduce(
      (sum, r) => sum.add(r.totalRemainingAmount),
      new Prisma.Decimal(0),
    );

    return {
      channel: query.channel,
      siteName: site.name,
      templateId: template?.id ?? null,
      recipients,
      summary: {
        recipientCount: recipients.length,
        withPhoneCount,
        withoutPhoneCount: recipients.length - withPhoneCount,
        totalRemainingAmount: totalRemaining.toFixed(2),
      },
    };
  }

  async sendDebtReminders(
    tenantId: string,
    siteId: string,
    input: DebtReminderSendInput,
    idempotencyKey?: string,
  ) {
    await assertSiteInTenant(tenantId, siteId);

    if (idempotencyKey) {
      const existing = await prisma.communicationIdempotencyKey.findUnique({
        where: { tenantId_key: { tenantId, key: idempotencyKey } },
        include: {
          batch: {
            include: {
              messages: {
                include: messageInclude,
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });
      if (existing) return this.mapBatchResult(existing.batch, true);
    }

    const provider =
      input.channel === "WHATSAPP"
        ? await resolveWhatsAppProvider(tenantId)
        : getMessageProvider(input.channel);

    if (!provider.isAvailable()) {
      throw new HttpError(
        400,
        input.channel === "WHATSAPP"
          ? "WhatsApp sağlayıcısı bağlı değil. Gönderim yapılamaz."
          : "SMS sağlayıcısı bağlı değil. Gönderim yapılamaz.",
      );
    }

    const template = await prisma.messageTemplate.findFirst({
      where: {
        id: input.templateId,
        tenantId,
        channel: input.channel,
        deletedAt: null,
        isActive: true,
      },
      include: {
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
      },
    });
    if (!template) throw new HttpError(400, "Geçerli bir mesaj şablonu seçilmedi.");

    if (input.channel === "WHATSAPP" && getWhatsAppProviderMode() === "meta") {
      if (!template.whatsAppTemplateId || !template.whatsAppTemplate) {
        throw new HttpError(400, "WhatsApp şablonu bağlantısı eksik.");
      }
      const wa = template.whatsAppTemplate;
      const components = (wa.componentsJson as MetaTemplateComponent[]) ?? [];
      const normalized = normalizeWhatsAppTemplate(components, wa.status, wa.isStale);
      if (!normalized.sendable) {
        if (normalized.hasHeaderVariables || normalized.hasDynamicUrlButtonVariables) {
          throw new HttpError(
            400,
            "Bu WhatsApp şablonu başlık veya dinamik URL değişkeni içeriyor; desteklenmiyor.",
          );
        }
        throw new HttpError(400, "Seçilen WhatsApp şablonu gönderime uygun değil.");
      }
      const mapping = template.whatsAppParameterMapping as Record<string, string> | null;
      if (
        !whatsAppIntegrationService.validateParameterMapping(
          normalized.bodyVariableCount,
          mapping,
        )
      ) {
        throw new HttpError(400, "WhatsApp şablonundaki tüm değişkenleri eşleştirin.");
      }
    }

    const preview = await this.previewDebtReminders(tenantId, siteId, {
      channel: input.channel,
      relationTypes: input.relationTypes,
      buildingId: input.buildingId ?? undefined,
      overdueOnly: input.overdueOnly ?? false,
      templateId: template.id,
    });

    const previewMap = new Map(
      preview.recipients.map((r) => [`${r.personId}:${r.apartmentId}`, r] as const),
    );
    const selected: DebtReminderRecipientPreview[] = [];
    const phoneSeen = new Set<string>();

    for (const item of input.recipients) {
      const row = previewMap.get(`${item.personId}:${item.apartmentId}`);
      if (!row) {
        throw new HttpError(
          400,
          "Seçilen alıcılardan biri artık geçerli değil. Önizlemeyi yenileyin.",
        );
      }
      if (!row.hasPhone || !row.normalizedPhone) {
        throw new HttpError(400, `${row.personName} için geçerli telefon bulunamadı.`);
      }
      if (phoneSeen.has(row.normalizedPhone)) continue;
      phoneSeen.add(row.normalizedPhone);
      selected.push(row);
    }

    if (selected.length === 0) {
      throw new HttpError(400, "Gönderilecek alıcı seçilmedi.");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const batch = await tx.communicationBatch.create({
          data: {
            tenantId,
            siteId,
            channel: input.channel,
            totalCount: selected.length,
            sentCount: 0,
            failedCount: 0,
          },
        });

        if (idempotencyKey) {
          await tx.communicationIdempotencyKey.create({
            data: { tenantId, key: idempotencyKey, batchId: batch.id },
          });
        }

        let sentCount = 0;
        let failedCount = 0;

        for (const recipient of selected) {
          const templateValues: Record<WhatsAppParameterField, string> = {
            adSoyad: recipient.personName,
            siteAdi: preview.siteName,
            binaAdi: recipient.buildingName,
            daireNo: recipient.apartmentNumber,
            borcTutari: formatTrMoney(recipient.totalRemainingAmount),
            vadeTarihi: formatTrDate(new Date(recipient.oldestDueDate)),
            borcAciklamasi: recipient.debtDescription,
          };

          const body = renderMessageTemplate(template.body, templateValues);

          let whatsAppTemplatePayload:
            | { name: string; language: string; bodyParameters: string[] }
            | undefined;

          if (
            input.channel === "WHATSAPP" &&
            getWhatsAppProviderMode() === "meta" &&
            template.whatsAppTemplate
          ) {
            const components =
              (template.whatsAppTemplate.componentsJson as MetaTemplateComponent[]) ?? [];
            const normalized = normalizeWhatsAppTemplate(
              components,
              template.whatsAppTemplate.status,
              template.whatsAppTemplate.isStale,
            );
            const mapping = template.whatsAppParameterMapping as Record<string, string>;
            whatsAppTemplatePayload = {
              name: template.whatsAppTemplate.name,
              language: template.whatsAppTemplate.language,
              bodyParameters: whatsAppIntegrationService.buildBodyParameters(
                normalized.bodyVariableCount,
                mapping,
                templateValues,
              ),
            };
          }

          const sendResult = await provider.send({
            toPhone: recipient.normalizedPhone!,
            body,
            channel: input.channel,
            whatsAppTemplate: whatsAppTemplatePayload,
          });

          const status = sendResult.status === "SENT" ? "SENT" : "FAILED";
          if (status === "SENT") sentCount += 1;
          else failedCount += 1;

          await tx.communicationMessage.create({
            data: {
              tenantId,
              siteId,
              batchId: batch.id,
              channel: input.channel,
              personId: recipient.personId,
              apartmentId: recipient.apartmentId,
              toPhone: recipient.normalizedPhone!,
              body,
              status,
              provider: sendResult.provider,
              providerMessageId: sendResult.providerMessageId ?? null,
              errorMessage: sendResult.errorMessage ?? null,
              sentAt: sendResult.sentAt ?? null,
            },
          });
        }

        return tx.communicationBatch.update({
          where: { id: batch.id },
          data: {
            sentCount,
            failedCount,
            completedAt: new Date(),
          },
          include: {
            messages: {
              include: messageInclude,
              orderBy: { createdAt: "asc" },
            },
          },
        });
      });

      return this.mapBatchResult(
        result,
        provider.name.startsWith("mock-") || provider.name === "mock-whatsapp",
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        idempotencyKey
      ) {
        const existing = await prisma.communicationIdempotencyKey.findUnique({
          where: { tenantId_key: { tenantId, key: idempotencyKey } },
          include: {
            batch: {
              include: {
                messages: {
                  include: messageInclude,
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        });
        if (existing) return this.mapBatchResult(existing.batch, true);
      }
      throw error;
    }
  }

  async listMessages(tenantId: string, siteId: string, query: ListCommunicationMessagesQuery) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: false });

    const where: Prisma.CommunicationMessageWhereInput = {
      tenantId,
      siteId,
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
    };

    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.communicationMessage.findMany({
        where,
        include: {
          ...messageInclude,
          batch: { select: { id: true, createdAt: true, channel: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
      }),
      prisma.communicationMessage.count({ where }),
    ]);

    return {
      items: items.map((row) => this.mapMessage(row)),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async listBatches(tenantId: string, siteId: string) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: false });
    const items = await prisma.communicationBatch.findMany({
      where: { tenantId, siteId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      items: items.map((batch) => ({
        id: batch.id,
        channel: batch.channel,
        totalCount: batch.totalCount,
        sentCount: batch.sentCount,
        failedCount: batch.failedCount,
        createdAt: batch.createdAt.toISOString(),
        completedAt: batch.completedAt?.toISOString() ?? null,
      })),
    };
  }

  private mapMessage(row: {
    id: string;
    channel: "WHATSAPP" | "SMS";
    toPhone: string;
    body: string;
    status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "CANCELLED";
    provider: string | null;
    providerMessageId: string | null;
    errorMessage: string | null;
    sentAt: Date | null;
    createdAt: Date;
    batchId: string | null;
    person: { id: string; firstName: string; lastName: string } | null;
    apartment: {
      id: string;
      number: string;
      building: { id: string; name: string };
    } | null;
  }) {
    return {
      id: row.id,
      channel: row.channel,
      toPhone: row.toPhone,
      body: row.body,
      status: row.status,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      errorMessage: row.errorMessage,
      sentAt: row.sentAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      batchId: row.batchId,
      person: row.person
        ? { id: row.person.id, fullName: personFullName(row.person) }
        : null,
      apartment: row.apartment
        ? {
            id: row.apartment.id,
            number: row.apartment.number,
            building: row.apartment.building,
          }
        : null,
      isMock: Boolean(row.provider?.startsWith("mock-")),
    };
  }

  private mapBatchResult(
    batch: {
      id: string;
      channel: "WHATSAPP" | "SMS";
      totalCount: number;
      sentCount: number;
      failedCount: number;
      createdAt: Date;
      completedAt: Date | null;
      messages: Array<{
        id: string;
        channel: "WHATSAPP" | "SMS";
        toPhone: string;
        body: string;
        status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "CANCELLED";
        provider: string | null;
        providerMessageId: string | null;
        errorMessage: string | null;
        sentAt: Date | null;
        createdAt: Date;
        batchId: string | null;
        person: { id: string; firstName: string; lastName: string } | null;
        apartment: {
          id: string;
          number: string;
          building: { id: string; name: string };
        } | null;
      }>;
    },
    isMock: boolean,
  ) {
    return {
      batch: {
        id: batch.id,
        channel: batch.channel,
        totalCount: batch.totalCount,
        sentCount: batch.sentCount,
        failedCount: batch.failedCount,
        createdAt: batch.createdAt.toISOString(),
        completedAt: batch.completedAt?.toISOString() ?? null,
        isMock,
      },
      messages: batch.messages.map((message) => this.mapMessage(message)),
      summary: {
        preparedCount: batch.totalCount,
        sentCount: batch.sentCount,
        failedCount: batch.failedCount,
      },
    };
  }
}

export const communicationService = new CommunicationService();
