import nodemailer from "nodemailer";
import { env } from "../../config/env";
import type { MailMessage, MailProvider, MailSendResult, MailVerifyResult, SmtpConfig } from "./mail.types";
import { summarizeSmtpError } from "./mail.types";

function createTransport(config: SmtpConfig) {
  const secure = config.smtpSecurity === "SSL_TLS";
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure,
    requireTLS: config.smtpSecurity === "STARTTLS",
    auth: {
      user: config.smtpUsername,
      pass: config.smtpPassword,
    },
    connectionTimeout: env.emailHttpTimeoutMs,
    greetingTimeout: env.emailHttpTimeoutMs,
    socketTimeout: env.emailHttpTimeoutMs,
    logger: false,
    debug: false,
  });
}

export class SmtpMailProvider implements MailProvider {
  readonly name = "smtp";

  async verify(config: SmtpConfig): Promise<MailVerifyResult> {
    try {
      const transporter = createTransport(config);
      await transporter.verify();
      return { ok: true };
    } catch (err) {
      const mapped = summarizeSmtpError(err);
      return { ok: false, safeErrorCode: mapped.code, safeErrorSummary: mapped.summary };
    }
  }

  async send(config: SmtpConfig, message: MailMessage): Promise<MailSendResult> {
    try {
      const transporter = createTransport(config);
      const info = await transporter.sendMail({
        from: `"${config.senderName}" <${config.senderEmail}>`,
        to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
        replyTo: message.replyTo || config.replyToEmail || undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { status: "SENT", providerMessageId: info.messageId ?? null };
    } catch (err) {
      const mapped = summarizeSmtpError(err);
      return {
        status: "FAILED",
        safeErrorCode: mapped.code,
        safeErrorSummary: mapped.summary,
      };
    }
  }
}
