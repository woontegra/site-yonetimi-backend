function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f8;font-family:Segoe UI,Arial,sans-serif;color:#15202b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6eaee;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background:#0f5f63;color:#ffffff;">
              <p style="margin:0;font-size:13px;opacity:.85;">Woontegra</p>
              <p style="margin:4px 0 0;font-size:18px;font-weight:600;">Site Yönetimi</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">${bodyHtml}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderSmtpTestEmail(): RenderedEmail {
  const subject = "Site Yönetimi — E-posta bağlantısı başarılı";
  const html = layout(
    subject,
    `<p style="margin:0 0 12px;font-size:15px;">E-posta entegrasyonunuz başarıyla çalışıyor.</p>
     <p style="margin:0;font-size:14px;color:#5c6b76;">Bu mesaj bağlantıyı doğrulamak amacıyla gönderilmiştir.</p>`,
  );
  const text = `${subject}\n\nE-posta entegrasyonunuz başarıyla çalışıyor.\nBu mesaj bağlantıyı doğrulamak amacıyla gönderilmiştir.`;
  return { subject, html, text };
}

export function renderTenantWelcomeEmail(input: {
  managerName: string;
  tenantName: string;
  activationUrl: string;
  expiresHours: number;
  planLabel?: string | null;
  supportEmail?: string | null;
}): RenderedEmail {
  const subject = "Site Yönetimi hesabınız oluşturuldu";
  const name = escapeHtml(input.managerName);
  const org = escapeHtml(input.tenantName);
  const url = escapeHtml(input.activationUrl);
  const plan = input.planLabel ? `<p style="margin:0 0 12px;font-size:14px;color:#5c6b76;">Plan: ${escapeHtml(input.planLabel)}</p>` : "";
  const support = input.supportEmail
    ? `<p style="margin:16px 0 0;font-size:13px;color:#5c6b76;">Destek: ${escapeHtml(input.supportEmail)}</p>`
    : "";
  const html = layout(
    subject,
    `<p style="margin:0 0 12px;font-size:15px;">Merhaba ${name},</p>
     <p style="margin:0 0 12px;font-size:14px;"><strong>${org}</strong> organizasyonu için Site Yönetimi hesabınız oluşturuldu.</p>
     ${plan}
     <p style="margin:0 0 18px;font-size:14px;">Hesabınızı kullanmaya başlamak için kendi şifrenizi oluşturun. Bağlantı ${input.expiresHours} saat geçerlidir.</p>
     <p style="margin:0 0 18px;">
       <a href="${url}" style="display:inline-block;background:#0f5f63;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;">Hesabımı Etkinleştir</a>
     </p>
     <p style="margin:0;font-size:12px;color:#5c6b76;">Buton çalışmıyorsa <a href="${url}" style="color:#0f5f63;text-decoration:underline;">aktivasyon sayfasını açın</a>.</p>
     ${support}`,
  );
  const text = [
    `Merhaba ${input.managerName},`,
    "",
    `${input.tenantName} organizasyonu için Site Yönetimi hesabınız oluşturuldu.`,
    input.planLabel ? `Plan: ${input.planLabel}` : "",
    `Hesabınızı kullanmaya başlamak için kendi şifrenizi oluşturun. Bağlantı ${input.expiresHours} saat geçerlidir.`,
    "",
    `Hesabımı Etkinleştir: ${input.activationUrl}`,
    input.supportEmail ? `Destek: ${input.supportEmail}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}

export function renderPlatformNewTenantEmail(input: {
  tenantName: string;
  managerName: string;
  managerEmail: string;
  createdAtLabel: string;
  planLabel?: string | null;
  isActive: boolean;
  activationMailStatus: "Gönderildi" | "Gönderilemedi";
  tenantDetailUrl: string;
}): RenderedEmail {
  const subject = `Yeni tenant oluşturuldu — ${input.tenantName}`;
  const html = layout(
    subject,
    `<p style="margin:0 0 12px;font-size:15px;">Yeni bir müşteri hesabı oluşturuldu.</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Organizasyon:</strong> ${escapeHtml(input.tenantName)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Yönetici:</strong> ${escapeHtml(input.managerName)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>E-posta:</strong> ${escapeHtml(input.managerEmail)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Oluşturulma:</strong> ${escapeHtml(input.createdAtLabel)}</p>
     ${input.planLabel ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Plan:</strong> ${escapeHtml(input.planLabel)}</p>` : ""}
     <p style="margin:0 0 8px;font-size:14px;"><strong>Durum:</strong> ${input.isActive ? "Aktif" : "Pasif"}</p>
     <p style="margin:0 0 16px;font-size:14px;"><strong>Aktivasyon e-postası:</strong> ${input.activationMailStatus}</p>
     <p style="margin:0;"><a href="${escapeHtml(input.tenantDetailUrl)}" style="color:#0f5f63;">Platform Yönetimi’nde tenant detayını aç</a></p>`,
  );
  const text = [
    subject,
    "",
    `Organizasyon: ${input.tenantName}`,
    `Yönetici: ${input.managerName}`,
    `E-posta: ${input.managerEmail}`,
    `Oluşturulma: ${input.createdAtLabel}`,
    input.planLabel ? `Plan: ${input.planLabel}` : "",
    `Durum: ${input.isActive ? "Aktif" : "Pasif"}`,
    `Aktivasyon e-postası: ${input.activationMailStatus}`,
    `Detay: ${input.tenantDetailUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}

export function renderAnnualLicenseRequestEmail(input: {
  requestId: string;
  tenantName: string;
  requesterName: string;
  requesterEmail: string;
  currentPlan: string | null;
  currentEndsAtLabel: string | null;
  netPrice: number;
  vatAmount: number;
  grossPrice: number;
  note: string | null;
  adminUrl: string;
}): RenderedEmail {
  const subject = `Yıllık lisans talebi — ${input.tenantName}`;
  const plan =
    input.currentPlan === "DEMO" ? "Demo" : input.currentPlan === "ANNUAL" ? "Yıllık" : input.currentPlan;
  const html = layout(
    subject,
    `<p style="margin:0 0 12px;font-size:15px;">Yeni bir yıllık lisans talebi alındı.</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Talep no:</strong> ${escapeHtml(input.requestId)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Organizasyon:</strong> ${escapeHtml(input.tenantName)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>Yetkili:</strong> ${escapeHtml(input.requesterName)}</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>E-posta:</strong> ${escapeHtml(input.requesterEmail)}</p>
     ${plan ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Mevcut lisans:</strong> ${escapeHtml(plan)}</p>` : ""}
     ${input.currentEndsAtLabel ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Bitiş:</strong> ${escapeHtml(input.currentEndsAtLabel)}</p>` : ""}
     <p style="margin:0 0 8px;font-size:14px;"><strong>Net:</strong> ${input.netPrice.toLocaleString("tr-TR")} TL</p>
     <p style="margin:0 0 8px;font-size:14px;"><strong>KDV:</strong> ${input.vatAmount.toLocaleString("tr-TR")} TL</p>
     <p style="margin:0 0 12px;font-size:14px;"><strong>Toplam:</strong> ${input.grossPrice.toLocaleString("tr-TR")} TL</p>
     ${input.note ? `<p style="margin:0 0 12px;font-size:14px;"><strong>Not:</strong> ${escapeHtml(input.note)}</p>` : ""}
     <p style="margin:0;"><a href="${escapeHtml(input.adminUrl)}" style="color:#0f5f63;">Admin panelinde talebi aç</a></p>`,
  );
  const text = [
    subject,
    "",
    `Talep no: ${input.requestId}`,
    `Organizasyon: ${input.tenantName}`,
    `Yetkili: ${input.requesterName}`,
    `E-posta: ${input.requesterEmail}`,
    plan ? `Mevcut lisans: ${plan}` : "",
    input.currentEndsAtLabel ? `Bitiş: ${input.currentEndsAtLabel}` : "",
    `Net: ${input.netPrice} TL`,
    `KDV: ${input.vatAmount} TL`,
    `Toplam: ${input.grossPrice} TL`,
    input.note ? `Not: ${input.note}` : "",
    `Detay: ${input.adminUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}
