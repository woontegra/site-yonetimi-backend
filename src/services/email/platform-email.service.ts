import type { EmailDeliveryType, PlatformEmailIntegration, Prisma, SmtpSecurity } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAdminAudit } from "../admin-audit.service";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "../../utils/secret-encryption";
import { assertRateLimit } from "../../utils/rate-limit";
import { getMailProvider } from "./mail-provider";
import type { MailMessage, SmtpConfig } from "./mail.types";
import { EMAIL_ERROR_MESSAGES, securityPortWarning } from "./mail.types";
import {
  createDelivery,
  markDeliveryResult,
  serializeDelivery,
  toPublicEmailStatus,
} from "./email-delivery.service";
import { renderSmtpTestEmail } from "./templates";

export type EmailIntegrationInput = {
  senderName: string;
  senderEmail: string;
  replyToEmail?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpPassword?: string;
  notificationEmail: string;
  isActive: boolean;
};

function passwordDecryptable(ciphertext: string | null | undefined): boolean {
  if (!ciphertext) return false;
  try {
    decryptSecret(ciphertext);
    return true;
  } catch {
    return false;
  }
}

function toSafeView(row: PlatformEmailIntegration) {
  const publicStatus = toPublicEmailStatus(row);
  return {
    id: row.id,
    providerType: row.providerType,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    replyToEmail: row.replyToEmail,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecurity: row.smtpSecurity,
    smtpUsername: row.smtpUsername,
    hasPassword: Boolean(row.encryptedSmtpPassword),
    passwordDecryptable: passwordDecryptable(row.encryptedSmtpPassword),
    isActive: row.isActive,
    status: row.status,
    publicStatus: publicStatus.status,
    publicLabel: publicStatus.label,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorSummary: row.lastErrorSummary,
    notificationEmail: row.notificationEmail,
    updatedAt: row.updatedAt.toISOString(),
    securityWarning: securityPortWarning(row.smtpPort, row.smtpSecurity),
  };
}

async function getRow() {
  return prisma.platformEmailIntegration.findFirst({ orderBy: { createdAt: "asc" } });
}

function decryptConfig(row: PlatformEmailIntegration): SmtpConfig {
  if (!hasEncryptionKey()) {
    throw new HttpError(400, EMAIL_ERROR_MESSAGES.ENCRYPTION_KEY_MISSING, "ENCRYPTION_KEY_MISSING");
  }
  try {
    return {
      senderName: row.senderName,
      senderEmail: row.senderEmail,
      replyToEmail: row.replyToEmail,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecurity: row.smtpSecurity,
      smtpUsername: row.smtpUsername,
      smtpPassword: decryptSecret(row.encryptedSmtpPassword),
    };
  } catch {
    throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_SECRET_DECRYPT_FAILED, "SMTP_SECRET_DECRYPT_FAILED");
  }
}

export class PlatformEmailService {
  async getSafe() {
    const row = await getRow();
    return row ? toSafeView(row) : null;
  }

  async getPublicStatus() {
    return toPublicEmailStatus(await getRow());
  }

  async upsert(adminUserId: string, input: EmailIntegrationInput) {
    assertRateLimit(`email-upsert:${adminUserId}`, 20, 15 * 60 * 1000);
    if (!hasEncryptionKey()) {
      throw new HttpError(400, EMAIL_ERROR_MESSAGES.ENCRYPTION_KEY_MISSING, "ENCRYPTION_KEY_MISSING");
    }

    const existing = await getRow();
    if (!input.smtpPassword && !existing?.encryptedSmtpPassword) {
      throw new HttpError(400, "SMTP şifresi zorunludur.", "SMTP_CONFIG_MISSING");
    }

    let encryptedSmtpPassword = existing?.encryptedSmtpPassword ?? "";
    const passwordUpdated = Boolean(input.smtpPassword);
    if (input.smtpPassword) {
      encryptedSmtpPassword = encryptSecret(input.smtpPassword);
      try {
        const roundTrip = decryptSecret(encryptedSmtpPassword);
        if (roundTrip !== input.smtpPassword) {
          throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_SECRET_DECRYPT_FAILED, "SMTP_SECRET_DECRYPT_FAILED");
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_SECRET_DECRYPT_FAILED, "SMTP_SECRET_DECRYPT_FAILED");
      }
    } else if (existing?.encryptedSmtpPassword) {
      try {
        decryptSecret(existing.encryptedSmtpPassword);
      } catch {
        throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_SECRET_DECRYPT_FAILED, "SMTP_SECRET_DECRYPT_FAILED");
      }
    }

    const data = {
      providerType: "SMTP",
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      replyToEmail: input.replyToEmail?.trim() || null,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: input.smtpUsername,
      encryptedSmtpPassword,
      isActive: input.isActive,
      status: input.isActive ? ("UNCONFIGURED" as const) : ("INACTIVE" as const),
      notificationEmail: input.notificationEmail,
      updatedByUserId: adminUserId,
      lastErrorCode: null,
      lastErrorSummary: null,
    };

    const saved = existing
      ? await prisma.platformEmailIntegration.update({ where: { id: existing.id }, data })
      : await prisma.platformEmailIntegration.create({ data });

    await writeAdminAudit({
      adminUserId,
      action: existing ? "email.integration.update" : "email.integration.create",
      targetType: "PlatformEmailIntegration",
      targetId: saved.id,
      metadata: {
        senderEmail: saved.senderEmail,
        smtpHost: saved.smtpHost,
        smtpPort: saved.smtpPort,
        smtpSecurity: saved.smtpSecurity,
        isActive: saved.isActive,
      },
    });

    return {
      integration: toSafeView(saved),
      securityWarning: securityPortWarning(saved.smtpPort, saved.smtpSecurity),
      passwordUpdated,
    };
  }

  async setActive(adminUserId: string, isActive: boolean) {
    const existing = await getRow();
    if (!existing) throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_CONFIG_MISSING, "SMTP_CONFIG_MISSING");
    const saved = await prisma.platformEmailIntegration.update({
      where: { id: existing.id },
      data: {
        isActive,
        status: isActive ? (existing.status === "READY" ? "READY" : "UNCONFIGURED") : "INACTIVE",
        updatedByUserId: adminUserId,
      },
    });
    await writeAdminAudit({
      adminUserId,
      action: "email.integration.toggle",
      targetType: "PlatformEmailIntegration",
      targetId: saved.id,
      metadata: { isActive },
    });
    return toSafeView(saved);
  }

  async testConnection(adminUserId: string) {
    assertRateLimit(`email-test:${adminUserId}`, 15, 15 * 60 * 1000);
    const existing = await getRow();
    if (!existing) throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_CONFIG_MISSING, "SMTP_CONFIG_MISSING");
    const provider = getMailProvider();
    const result = await provider.verify(decryptConfig(existing));
    const saved = await prisma.platformEmailIntegration.update({
      where: { id: existing.id },
      data: {
        lastTestedAt: new Date(),
        lastSuccessfulAt: result.ok ? new Date() : existing.lastSuccessfulAt,
        status: result.ok ? (existing.isActive ? "READY" : "INACTIVE") : "ERROR",
        lastErrorCode: result.ok ? null : result.safeErrorCode ?? "EMAIL_SEND_FAILED",
        lastErrorSummary: result.ok ? null : result.safeErrorSummary ?? EMAIL_ERROR_MESSAGES.EMAIL_SEND_FAILED,
        updatedByUserId: adminUserId,
      },
    });
    await writeAdminAudit({
      adminUserId,
      action: "email.connection.test",
      targetType: "PlatformEmailIntegration",
      targetId: saved.id,
      metadata: { ok: result.ok, errorCode: result.safeErrorCode ?? null },
    });
    return { ok: result.ok, integration: toSafeView(saved) };
  }

  async sendTestEmail(adminUserId: string, recipientEmail?: string) {
    assertRateLimit(`email-test-send:${adminUserId}`, 10, 15 * 60 * 1000);
    const existing = await getRow();
    if (!existing) throw new HttpError(400, EMAIL_ERROR_MESSAGES.SMTP_CONFIG_MISSING, "SMTP_CONFIG_MISSING");
    if (!existing.isActive) {
      throw new HttpError(400, "E-posta entegrasyonu pasif.", "SMTP_CONFIG_MISSING");
    }
    const to = (recipientEmail || existing.notificationEmail).trim().toLowerCase();
    const rendered = renderSmtpTestEmail();
    const delivery = await this.dispatch({
      type: "SMTP_TEST",
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await writeAdminAudit({
      adminUserId,
      action: "email.test.send",
      targetType: "EmailDelivery",
      targetId: delivery.id,
      metadata: { status: delivery.status, errorCode: delivery.safeErrorCode },
    });
    return serializeDelivery(delivery);
  }

  async dispatch(input: {
    type: EmailDeliveryType;
    to: string;
    toName?: string;
    subject: string;
    html: string;
    text: string;
    relatedTenantId?: string | null;
    relatedUserId?: string | null;
  }) {
    const existing = await getRow();
    const delivery = await createDelivery({
      type: input.type,
      recipientEmail: input.to,
      recipientName: input.toName ?? null,
      subject: input.subject,
      relatedTenantId: input.relatedTenantId,
      relatedUserId: input.relatedUserId,
    });

    if (!existing || !existing.isActive) {
      return markDeliveryResult(delivery.id, {
        status: "FAILED",
        safeErrorCode: "SMTP_CONFIG_MISSING",
        safeErrorSummary: EMAIL_ERROR_MESSAGES.SMTP_CONFIG_MISSING,
      });
    }

    const message: MailMessage = {
      to: input.to,
      toName: input.toName,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: existing.replyToEmail ?? undefined,
    };

    try {
      const result = await getMailProvider().send(decryptConfig(existing), message);
      const updated = await markDeliveryResult(delivery.id, result);
      if (result.status === "SENT") {
        await prisma.platformEmailIntegration.update({
          where: { id: existing.id },
          data: { lastSuccessfulAt: new Date(), status: "READY", lastErrorCode: null, lastErrorSummary: null },
        });
      }
      return updated;
    } catch (err) {
      if (err instanceof HttpError) {
        return markDeliveryResult(delivery.id, {
          status: "FAILED",
          safeErrorCode: err.code ?? "EMAIL_SEND_FAILED",
          safeErrorSummary: err.message,
        });
      }
      return markDeliveryResult(delivery.id, {
        status: "FAILED",
        safeErrorCode: "EMAIL_SEND_FAILED",
        safeErrorSummary: EMAIL_ERROR_MESSAGES.EMAIL_SEND_FAILED,
      });
    }
  }

  async listDeliveries(query: {
    page: number;
    perPage: number;
    status?: "PENDING" | "SENT" | "FAILED";
    type?: EmailDeliveryType;
    tenantId?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.EmailDeliveryWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.tenantId) where.relatedTenantId = query.tenantId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    const skip = (query.page - 1) * query.perPage;
    const [items, total] = await prisma.$transaction([
      prisma.emailDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
        include: { relatedTenant: { select: { id: true, name: true } } },
      }),
      prisma.emailDelivery.count({ where }),
    ]);
    return {
      items: items.map(serializeDelivery),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async retryDelivery(adminUserId: string, deliveryId: string) {
    assertRateLimit(`email-retry:${adminUserId}:${deliveryId}`, 8, 15 * 60 * 1000);
    const existing = await prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
    if (!existing) throw new HttpError(404, "Teslimat kaydı bulunamadı.");
    if (existing.status === "SENT") {
      throw new HttpError(400, "Bu e-posta zaten gönderilmiş.");
    }
    if (existing.type === "TENANT_WELCOME_ACTIVATION") {
      if (!existing.relatedUserId) throw new HttpError(400, "İlgili kullanıcı bulunamadı.");
      return this.resendWelcome(adminUserId, existing.relatedUserId);
    }
    if (existing.type === "PLATFORM_NEW_TENANT_NOTIFICATION") {
      if (!existing.relatedTenantId) throw new HttpError(400, "İlgili tenant bulunamadı.");
      return this.resendPlatformNotification(adminUserId, existing.relatedTenantId);
    }
    return this.sendTestEmail(adminUserId, existing.recipientEmail);
  }

  async resendWelcome(adminUserId: string, userId: string) {
    const { sendTenantWelcomeAndNotify } = await import("./tenant-email.service");
    return sendTenantWelcomeAndNotify({ adminUserId, userId, resendWelcomeOnly: true });
  }

  async resendPlatformNotification(adminUserId: string, tenantId: string) {
    const { sendTenantWelcomeAndNotify } = await import("./tenant-email.service");
    return sendTenantWelcomeAndNotify({ adminUserId, tenantId, resendPlatformOnly: true });
  }
}

export const platformEmailService = new PlatformEmailService();
