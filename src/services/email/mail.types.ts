export type SmtpSecurity = "SSL_TLS" | "STARTTLS";

export type MailMessage = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type MailSendResult = {
  status: "SENT" | "FAILED";
  providerMessageId?: string | null;
  safeErrorCode?: string | null;
  safeErrorSummary?: string | null;
};

export type MailVerifyResult = {
  ok: boolean;
  safeErrorCode?: string | null;
  safeErrorSummary?: string | null;
};

export type SmtpConfig = {
  senderName: string;
  senderEmail: string;
  replyToEmail?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpPassword: string;
};

export interface MailProvider {
  readonly name: string;
  verify(config: SmtpConfig): Promise<MailVerifyResult>;
  send(config: SmtpConfig, message: MailMessage): Promise<MailSendResult>;
}

export const EMAIL_ERROR_MESSAGES: Record<string, string> = {
  SMTP_CONFIG_MISSING: "E-posta bağlantısı yapılandırılmamış.",
  SMTP_AUTH_FAILED: "SMTP kimlik doğrulaması başarısız. Kullanıcı adı veya uygulama şifresini kontrol edin.",
  SMTP_CONNECTION_FAILED: "SMTP sunucusuna bağlanılamadı.",
  SMTP_TIMEOUT: "SMTP bağlantısı zaman aşımına uğradı.",
  SMTP_RECIPIENT_REJECTED: "Alıcı adresi reddedildi.",
  SMTP_SECURITY_MISMATCH: "Seçilen güvenlik türü port ile uyumlu görünmüyor.",
  PUBLIC_APP_URL_MISSING: "Genel uygulama adresi (PUBLIC_APP_URL) tanımlı değil.",
  ACTIVATION_TOKEN_FAILED: "Aktivasyon bağlantısı oluşturulamadı.",
  EMAIL_SEND_FAILED: "E-posta gönderilemedi.",
  ENCRYPTION_KEY_MISSING: "Gizli bilgileri saklamak için şifreleme anahtarı tanımlı değil.",
  SMTP_SECRET_DECRYPT_FAILED:
    "Kayıtlı SMTP şifresi çözülemedi. E-posta ayarlarını açıp uygulama şifresini yeniden kaydedin.",
};

export function summarizeSmtpError(err: unknown): { code: string; summary: string } {
  const raw = err instanceof Error ? `${err.message} ${"code" in err ? String((err as { code?: string }).code) : ""}` : "";
  const lower = raw.toLowerCase();
  if (lower.includes("eauth") || lower.includes("invalid login") || lower.includes("535") || lower.includes("auth")) {
    return { code: "SMTP_AUTH_FAILED", summary: EMAIL_ERROR_MESSAGES.SMTP_AUTH_FAILED };
  }
  if (lower.includes("etimedout") || lower.includes("timeout") || lower.includes("timed out")) {
    return { code: "SMTP_TIMEOUT", summary: EMAIL_ERROR_MESSAGES.SMTP_TIMEOUT };
  }
  if (lower.includes("econn") || lower.includes("enotfound") || lower.includes("connect")) {
    return { code: "SMTP_CONNECTION_FAILED", summary: EMAIL_ERROR_MESSAGES.SMTP_CONNECTION_FAILED };
  }
  if (lower.includes("recipient") || lower.includes("550") || lower.includes("553")) {
    return { code: "SMTP_RECIPIENT_REJECTED", summary: EMAIL_ERROR_MESSAGES.SMTP_RECIPIENT_REJECTED };
  }
  return { code: "EMAIL_SEND_FAILED", summary: EMAIL_ERROR_MESSAGES.EMAIL_SEND_FAILED };
}

export function securityPortWarning(port: number, security: SmtpSecurity): string | null {
  if (port === 465 && security !== "SSL_TLS") {
    return "465 numaralı port genellikle doğrudan TLS (SSL/TLS) kullanır. STARTTLS seçildi; yine de seçiminiz uygulanacak.";
  }
  if (port === 587 && security !== "STARTTLS") {
    return "587 numaralı port genellikle STARTTLS kullanır. SSL/TLS seçildi; yine de seçiminiz uygulanacak.";
  }
  return null;
}
