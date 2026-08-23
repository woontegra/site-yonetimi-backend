/**
 * FAZ 25 — merkezi e-posta, aktivasyon ve tenant oluşturma duman testi.
 * Gerçek SMTP'ye bağlanmaz. Tam build değildir.
 * Kullanım: npx tsx scripts/verify-faz25-email.ts
 */
import bcrypt from "bcryptjs";
import http from "http";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { hashActivationToken, issueActivationToken } from "../src/services/email/activation-token.service";
import { mockMailProvider } from "../src/services/email/mock.provider";
import {
  renderPlatformNewTenantEmail,
  renderSmtpTestEmail,
  renderTenantWelcomeEmail,
} from "../src/services/email/templates";
import { completeActivation } from "../src/services/email/tenant-email.service";

const PREFIX = `faz25-verify-${Date.now()}`;
const ADMIN_EMAIL = `${PREFIX}-admin@example.com`;
const USER_EMAIL = `${PREFIX}-user@example.com`;
const MANAGER_OK = `${PREFIX}-ok@example.com`;
const MANAGER_FAIL = `${PREFIX}-fail@example.com`;

process.env.PUBLIC_APP_URL = "http://localhost:3001";
process.env.EMAIL_PROVIDER_MODE = "mock";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function request(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function runTemplateTests() {
  const welcome = renderTenantWelcomeEmail({
    managerName: '<script>alert(1)</script>',
    tenantName: "Acme & Co",
    activationUrl: "http://localhost:3001/aktivasyon?token=abc",
    expiresHours: 48,
    planLabel: "Demo",
    supportEmail: "destek@example.com",
  });
  assert(welcome.subject === "Site Yönetimi hesabınız oluşturuldu", "welcome subject");
  assert(welcome.html.includes("Hesabımı Etkinleştir"), "welcome button");
  assert(welcome.html.includes("aktivasyon sayfasını açın"), "html fallback link metni");
  assert(welcome.html.includes('href="http://localhost:3001/aktivasyon?token=abc"'), "html href");
  assert(!welcome.html.includes("tarayıcınıza yapıştırın"), "uzun url düz metin yok");
  const visibleHtml = welcome.html.replace(/<a [^>]*>/gi, "").replace(/<[^>]+>/g, " ");
  assert(!visibleHtml.includes("token=abc"), "token görünür metinde yok");
  assert(welcome.html.includes("&lt;script&gt;"), "html escape");
  assert(!welcome.html.includes("<script>alert"), "raw script yok");
  assert(!welcome.html.toLowerCase().includes("password"), "welcome password yok");
  assert(!welcome.text.toLowerCase().includes("smtp"), "welcome smtp yok");
  assert(welcome.text.includes("http://localhost:3001/aktivasyon?token=abc"), "plain link");

  const notify = renderPlatformNewTenantEmail({
    tenantName: "Acme",
    managerName: "Ali Veli",
    managerEmail: "ali@example.com",
    createdAtLabel: "23.08.2026 16:00",
    planLabel: "Demo",
    isActive: true,
    activationMailStatus: "Gönderildi",
    tenantDetailUrl: "http://localhost:3001/app/admin/tenantlar/uuid-here",
  });
  assert(notify.subject.includes("Acme"), "notify subject tenant adı");
  assert(notify.html.includes("ali@example.com"), "notify manager email");
  assert(notify.html.includes("Gönderildi"), "notify activation status");
  assert(!notify.html.toLowerCase().includes("smtp password"), "notify secret yok");

  const test = renderSmtpTestEmail();
  assert(test.subject.includes("E-posta bağlantısı başarılı"), "test subject");
  assert(test.text.includes("bağlantıyı doğrulamak"), "test body");
}

async function cleanup() {
  await prisma.emailDelivery.deleteMany({
    where: {
      OR: [
        { recipientEmail: { startsWith: PREFIX } },
        { relatedTenant: { slug: { startsWith: "faz25-verify" } } },
      ],
    },
  }).catch(() => undefined);
  await prisma.userActivationToken.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  }).catch(() => undefined);
  await prisma.membership.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  }).catch(() => undefined);
  await prisma.subscription.deleteMany({
    where: { tenant: { slug: { startsWith: "faz25-verify" } } },
  }).catch(() => undefined);
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: "faz25-verify" } } }).catch(() => undefined);
  await prisma.adminAuditLog.deleteMany({
    where: { adminUser: { email: { startsWith: PREFIX } } },
  }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined);
}

async function main() {
  runTemplateTests();
  mockMailProvider.reset();

  const previousEmail = await prisma.platformEmailIntegration.findFirst();
  await cleanup();

  const adminHash = await bcrypt.hash("admin-pass-25", 10);
  const userHash = await bcrypt.hash("user-pass-25", 10);
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash: adminHash,
      fullName: "Faz25 Admin",
      isPlatformAdmin: true,
      isActive: true,
    },
  });
  await prisma.user.create({
    data: {
      email: USER_EMAIL,
      passwordHash: userHash,
      fullName: "Faz25 User",
      isPlatformAdmin: false,
      isActive: true,
    },
  });

  const tokenUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-token@example.com`,
      passwordHash: await bcrypt.hash("unused", 10),
      fullName: "Token User",
      isActive: false,
    },
  });
  const first = await issueActivationToken(tokenUser.id);
  assert(first.raw.length >= 32, "token uzunluğu");
  assert(first.raw !== hashActivationToken(first.raw), "hash açık token değil");
  const stored = await prisma.userActivationToken.findMany({ where: { userId: tokenUser.id } });
  assert(stored.length === 1, "tek token");
  assert(stored[0].tokenHash === hashActivationToken(first.raw), "hash eşleşmeli");
  assert(!stored[0].tokenHash.includes(first.raw), "açık token DB'de yok");
  const second = await issueActivationToken(tokenUser.id);
  const afterReissue = await prisma.userActivationToken.findMany({ where: { userId: tokenUser.id } });
  assert(afterReissue.length === 1, "eski token silinmeli");
  assert(afterReissue[0].tokenHash === hashActivationToken(second.raw), "yeni hash");
  await completeActivation(second.raw, "new-pass-25");
  try {
    await completeActivation(second.raw, "other-pass");
    throw new Error("tek kullanımlık token yeniden kullanılmamalı");
  } catch (err) {
    assert(err instanceof Error && err.message.toLocaleLowerCase("tr-TR").includes("aktivasyon"), "ikinci kullanım hata");
  }

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port alınamadı");
  const port = address.port;

  try {
    const userLogin = await request(port, "/api/auth/login", {
      method: "POST",
      body: { email: USER_EMAIL, password: "user-pass-25" },
    });
    assert(userLogin.status === 200, "normal kullanıcı login");
    const userToken = String(userLogin.body.token ?? "");
    const forbidden = await request(port, "/api/admin/email-integration", { token: userToken });
    assert(forbidden.status === 403, `normal kullanıcı SMTP GET 403, ${forbidden.status}`);
    const forbiddenPut = await request(port, "/api/admin/email-integration", {
      method: "PUT",
      token: userToken,
      body: { senderName: "x", senderEmail: "a@b.com", smtpHost: "h", smtpPort: 587, smtpSecurity: "STARTTLS", smtpUsername: "u", smtpPassword: "p", notificationEmail: "n@b.com", isActive: true },
    });
    assert(forbiddenPut.status === 403, "normal kullanıcı SMTP PUT 403");

    const adminLogin = await request(port, "/api/auth/login", {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: "admin-pass-25" },
    });
    assert(adminLogin.status === 200, "admin login");
    const adminToken = String(adminLogin.body.token ?? "");

    const saved = await request(port, "/api/admin/email-integration", {
      method: "PUT",
      token: adminToken,
      body: {
        senderName: "Site Yönetimi",
        senderEmail: `${PREFIX}-from@example.com`,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpSecurity: "STARTTLS",
        smtpUsername: "smtp-user",
        smtpPassword: "app-password-secret",
        notificationEmail: `${PREFIX}-notify@example.com`,
        isActive: true,
      },
    });
    assert(saved.status === 200, `SMTP kaydı 200, ${saved.status} ${JSON.stringify(saved.body)}`);
    const payload = JSON.stringify(saved.body);
    assert(!payload.includes("app-password-secret"), "şifre response'ta yok");
    assert(!payload.toLowerCase().includes("encryptedsmtppassword"), "encryptedSmtpPassword yok");
    const integration = saved.body.integration as { hasPassword?: boolean };
    assert(integration.hasPassword === true, "hasPassword true");

    const got = await request(port, "/api/admin/email-integration", { token: adminToken });
    assert(got.status === 200, "SMTP GET");
    assert(!JSON.stringify(got.body).includes("app-password-secret"), "GET şifre sızdırmamalı");

    const testConn = await request(port, "/api/admin/email-integration/test-connection", {
      method: "POST",
      token: adminToken,
    });
    assert(testConn.status === 200, "test-connection");
    assert((testConn.body as { ok?: boolean }).ok === true, "bağlantı testi ok");

    const testSend = await request(port, "/api/admin/email-integration/test-send", {
      method: "POST",
      token: adminToken,
      body: { recipientEmail: `${PREFIX}-test@example.com` },
    });
    assert(testSend.status === 200, "test-send");
    const delivery = testSend.body.delivery as { status?: string };
    assert(delivery.status === "SENT", "test mail SENT");
    assert(mockMailProvider.lastSent?.subject.includes("bağlantısı başarılı"), "test mail konusu");

    mockMailProvider.reset();
    const createdOk = await request(port, "/api/admin/tenants", {
      method: "POST",
      token: adminToken,
      body: {
        name: `Faz25 Verify Org ${Date.now()}`,
        managerFullName: "Yönetici Ok",
        managerEmail: MANAGER_OK,
        plan: "DEMO",
        trialDays: 14,
      },
    });
    assert(createdOk.status === 201, `tenant create ${createdOk.status} ${JSON.stringify(createdOk.body)}`);
    const emailsOk = createdOk.body.emails as { welcome?: { status?: string }; platformNotification?: { status?: string } };
    assert(emailsOk.welcome?.status === "SENT", "welcome SENT");
    assert(emailsOk.platformNotification?.status === "SENT", "platform SENT");
    const tenantOk = createdOk.body.tenant as { id: string };
    const welcomeMsg = mockMailProvider.sent.find((m) => m.subject.includes("hesabınız oluşturuldu"));
    assert(welcomeMsg, "welcome mock gönderildi");
    assert(!JSON.stringify(welcomeMsg).toLowerCase().includes("app-password-secret"), "welcome içinde smtp şifre yok");
    const tokenMatch = welcomeMsg?.html.match(/token=([a-f0-9]+)/i);
    assert(Boolean(tokenMatch?.[1]), "aktivasyon tokenı mailde");
    const activationToken = tokenMatch![1];
    const hashed = hashActivationToken(activationToken);
    const dbToken = await prisma.userActivationToken.findUnique({ where: { tokenHash: hashed } });
    assert(Boolean(dbToken), "token hash DB'de");
    assert(dbToken?.usedAt == null, "henüz kullanılmamış");

    mockMailProvider.failNext = true;
    const createdFail = await request(port, "/api/admin/tenants", {
      method: "POST",
      token: adminToken,
      body: {
        name: `Faz25 Verify Fail ${Date.now()}`,
        managerFullName: "Yönetici Fail",
        managerEmail: MANAGER_FAIL,
        plan: "STANDARD",
        trialDays: 7,
      },
    });
    assert(createdFail.status === 201, "mail fail olsa da tenant 201");
    const tenantFail = createdFail.body.tenant as { id: string };
    const persisted = await prisma.tenant.findUnique({ where: { id: tenantFail.id } });
    const persistedUser = await prisma.user.findUnique({ where: { email: MANAGER_FAIL } });
    assert(Boolean(persisted), "tenant silinmedi");
    assert(Boolean(persistedUser), "user silinmedi");
    const emailsFail = createdFail.body.emails as { welcome?: { status?: string; id?: string } };
    assert(emailsFail.welcome?.status === "FAILED", "welcome FAILED");

    mockMailProvider.failNext = false;
    const retry = await request(port, `/api/admin/email-deliveries/${emailsFail.welcome!.id}/retry`, {
      method: "POST",
      token: adminToken,
    });
    assert(retry.status === 200, `retry ${retry.status}`);
    const retryWelcome = retry.body.welcome as { status?: string };
    assert(retryWelcome.status === "SENT", "retry SENT");

    const activate = await request(port, "/api/auth/activate", {
      method: "POST",
      body: { token: activationToken, password: "activated-25" },
    });
    assert(activate.status === 200, `activate ${activate.status} ${JSON.stringify(activate.body)}`);
    const loginActivated = await request(port, "/api/auth/login", {
      method: "POST",
      body: { email: MANAGER_OK, password: "activated-25" },
    });
    assert(loginActivated.status === 200, "aktivasyon sonrası login");

    const audits = await prisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const auditText = JSON.stringify(audits);
    assert(!auditText.includes("app-password-secret"), "audit şifre yok");
    assert(!auditText.includes(activationToken), "audit açık token yok");
    assert(audits.some((item) => item.action === "email.integration.create" || item.action === "email.integration.update"), "email audit");
    assert(audits.some((item) => item.action === "tenant.create"), "tenant.create audit");

    console.log("FAZ 25 doğrulama başarılı.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    if (previousEmail) {
      await prisma.platformEmailIntegration.deleteMany({
        where: { id: { not: previousEmail.id } },
      });
      await prisma.platformEmailIntegration.update({
        where: { id: previousEmail.id },
        data: {
          senderName: previousEmail.senderName,
          senderEmail: previousEmail.senderEmail,
          replyToEmail: previousEmail.replyToEmail,
          smtpHost: previousEmail.smtpHost,
          smtpPort: previousEmail.smtpPort,
          smtpSecurity: previousEmail.smtpSecurity,
          smtpUsername: previousEmail.smtpUsername,
          encryptedSmtpPassword: previousEmail.encryptedSmtpPassword,
          isActive: previousEmail.isActive,
          status: previousEmail.status,
          notificationEmail: previousEmail.notificationEmail,
          lastErrorCode: previousEmail.lastErrorCode,
          lastErrorSummary: previousEmail.lastErrorSummary,
        },
      });
    } else {
      await prisma.platformEmailIntegration.deleteMany({
        where: { senderEmail: { startsWith: PREFIX } },
      });
    }
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
