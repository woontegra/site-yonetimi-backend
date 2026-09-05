import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { writeAdminAudit } from "../admin-audit.service";
import { formatDateTimeTr, maskEmail } from "../../utils/admin";
import { HttpError } from "../../utils/httpError";
import { assertRateLimit } from "../../utils/rate-limit";
import { ACTIVATION_TTL_HOURS, consumeActivationToken, issueActivationToken } from "./activation-token.service";
import { recordFailedDelivery, serializeDelivery } from "./email-delivery.service";
import { publicAppHref } from "./mail-provider";
import { EMAIL_ERROR_MESSAGES } from "./mail.types";
import { platformEmailService } from "./platform-email.service";
import { renderPlatformNewTenantEmail, renderTenantWelcomeEmail } from "./templates";

const PLAN_LABELS: Record<string, string> = {
  DEMO: "Demo",
  ANNUAL: "Yıllık",
};

async function loadTenantContext(input: { tenantId?: string; userId?: string }) {
  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      include: {
        memberships: { include: { tenant: { include: { subscription: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");
    const membership = user.memberships[0];
    if (!membership) throw new HttpError(400, "Kullanıcının tenant üyeliği yok.");
    return { user, tenant: membership.tenant };
  }
  if (input.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      include: {
        subscription: true,
        memberships: { include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");
    const owner = tenant.memberships[0]?.user;
    if (!owner) throw new HttpError(400, "Tenant yöneticisi bulunamadı.");
    return { user: owner, tenant };
  }
  throw new HttpError(400, "Tenant veya kullanıcı gerekli.");
}

export async function sendTenantWelcomeAndNotify(input: {
  adminUserId: string;
  tenantId?: string;
  userId?: string;
  resendWelcomeOnly?: boolean;
  resendPlatformOnly?: boolean;
}) {
  const { user, tenant } = await loadTenantContext(input);
  const integration = await platformEmailService.getSafe();
  const originOk = Boolean(publicAppHref("/"));
  const planLabel = tenant.subscription ? PLAN_LABELS[tenant.subscription.plan] ?? tenant.subscription.plan : null;

  let welcome = null;
  let notify = null;

  if (!input.resendPlatformOnly) {
    assertRateLimit(`email-welcome:${user.id}`, 5, 15 * 60 * 1000);
    if (user.isActive) {
      throw new HttpError(
        400,
        "Bu kullanıcı hesabını zaten etkinleştirmiş. Aktivasyon daveti gönderilmez.",
      );
    }
    if (!originOk) {
      console.warn("PUBLIC_APP_URL tanımlı değil; aktivasyon e-postası gönderilmedi.");
      welcome = await recordFailedDelivery({
        type: "TENANT_WELCOME_ACTIVATION",
        recipientEmail: user.email,
        recipientName: user.fullName,
        subject: "Site Yönetimi hesabınız oluşturuldu",
        relatedTenantId: tenant.id,
        relatedUserId: user.id,
        safeErrorCode: "PUBLIC_APP_URL_MISSING",
        safeErrorSummary: EMAIL_ERROR_MESSAGES.PUBLIC_APP_URL_MISSING,
      });
    } else {
      const issued = await issueActivationToken(user.id);
      const activationUrl = publicAppHref("/aktivasyon", { token: issued.raw });
      if (!activationUrl) {
        throw new HttpError(500, EMAIL_ERROR_MESSAGES.PUBLIC_APP_URL_MISSING, "PUBLIC_APP_URL_MISSING");
      }
      const rendered = renderTenantWelcomeEmail({
        managerName: user.fullName,
        tenantName: tenant.name,
        activationUrl,
        expiresHours: ACTIVATION_TTL_HOURS,
        planLabel,
        supportEmail: integration?.replyToEmail || integration?.notificationEmail || null,
      });
      welcome = await platformEmailService.dispatch({
        type: "TENANT_WELCOME_ACTIVATION",
        to: user.email,
        toName: user.fullName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        relatedTenantId: tenant.id,
        relatedUserId: user.id,
      });
    }
    if (input.resendWelcomeOnly) {
      await writeAdminAudit({
        adminUserId: input.adminUserId,
        action: "email.invite.resend",
        targetType: "User",
        targetId: user.id,
        tenantId: tenant.id,
        metadata: { status: welcome.status, errorCode: welcome.safeErrorCode },
      });
    }
  }

  if (!input.resendWelcomeOnly) {
    const recipient = integration?.notificationEmail;
    if (!recipient) {
      notify = await recordFailedDelivery({
        type: "PLATFORM_NEW_TENANT_NOTIFICATION",
        recipientEmail: "",
        subject: `Yeni tenant oluşturuldu — ${tenant.name}`,
        relatedTenantId: tenant.id,
        relatedUserId: user.id,
        safeErrorCode: "SMTP_CONFIG_MISSING",
        safeErrorSummary: EMAIL_ERROR_MESSAGES.SMTP_CONFIG_MISSING,
      });
    } else {
      const rendered = renderPlatformNewTenantEmail({
        tenantName: tenant.name,
        managerName: user.fullName,
        managerEmail: user.email,
        createdAtLabel: formatDateTimeTr(tenant.createdAt),
        planLabel,
        isActive: tenant.isActive,
        activationMailStatus: welcome?.status === "SENT" ? "Gönderildi" : "Gönderilemedi",
        tenantDetailUrl: publicAppHref(`/app/admin/tenantlar/${tenant.id}`) ?? `/app/admin/tenantlar/${tenant.id}`,
      });
      notify = await platformEmailService.dispatch({
        type: "PLATFORM_NEW_TENANT_NOTIFICATION",
        to: recipient,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        relatedTenantId: tenant.id,
        relatedUserId: user.id,
      });
    }
  }

  return {
    welcome: welcome ? serializeDelivery(welcome) : null,
    platformNotification: notify ? serializeDelivery(notify) : null,
    managerEmailMasked: maskEmail(user.email),
  };
}

export async function completeActivation(rawToken: string, password: string) {
  const trimmed = password.trim();
  if (trimmed.length < 8 || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(trimmed) || !/\d/.test(trimmed)) {
    throw new HttpError(400, "Şifre en az 8 karakter olmalı ve harf ile rakam içermelidir.");
  }
  const record = await consumeActivationToken(rawToken);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.userActivationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new HttpError(400, "Aktivasyon bağlantısı geçersiz.", "ACTIVATION_TOKEN_FAILED");
    }
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, isActive: true },
    });
    await tx.membership.updateMany({
      where: { userId: record.userId, status: "INVITED" },
      data: { status: "ACTIVE" },
    });
  });
  return { email: record.user.email, fullName: record.user.fullName };
}
