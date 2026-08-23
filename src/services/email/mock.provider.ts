import type { MailMessage, MailProvider, MailSendResult, MailVerifyResult, SmtpConfig } from "./mail.types";

export class MockMailProvider implements MailProvider {
  readonly name = "mock-smtp";
  lastSent: MailMessage | null = null;
  sent: MailMessage[] = [];
  failNext = false;

  reset() {
    this.lastSent = null;
    this.sent = [];
    this.failNext = false;
  }

  async verify(config: SmtpConfig): Promise<MailVerifyResult> {
    if (!config.smtpHost || !config.smtpUsername || !config.smtpPassword) {
      return {
        ok: false,
        safeErrorCode: "SMTP_CONFIG_MISSING",
        safeErrorSummary: "SMTP bilgileri eksik.",
      };
    }
    return { ok: true };
  }

  async send(_config: SmtpConfig, message: MailMessage): Promise<MailSendResult> {
    if (this.failNext) {
      this.failNext = false;
      return {
        status: "FAILED",
        safeErrorCode: "EMAIL_SEND_FAILED",
        safeErrorSummary: "E-posta gönderilemedi.",
      };
    }
    this.lastSent = message;
    this.sent.push(message);
    return { status: "SENT", providerMessageId: `mock-mail-${Date.now()}` };
  }
}

export const mockMailProvider = new MockMailProvider();
