import { env } from "../../config/env";
import type { MailProvider } from "./mail.types";
import { mockMailProvider } from "./mock.provider";
import { SmtpMailProvider } from "./smtp.provider";

const smtpProvider = new SmtpMailProvider();

export function getMailProvider(): MailProvider {
  const raw = process.env.EMAIL_PROVIDER_MODE?.trim().toLowerCase();
  const mode = raw === "mock" || raw === "smtp" ? raw : env.emailProviderMode;
  return mode === "mock" ? mockMailProvider : smtpProvider;
}

export function getPublicAppUrl(): string | null {
  const raw = (process.env.PUBLIC_APP_URL?.trim() || env.publicAppUrl || "").replace(/\/+$/, "");
  if (!raw) return null;
  const nodeEnv = process.env.NODE_ENV ?? env.nodeEnv;
  if (nodeEnv === "production" && /localhost|127\.0\.0\.1/i.test(raw)) {
    return null;
  }
  return raw;
}

/** PUBLIC_APP_URL slash ile bitsa bile çift slash üretmez. */
export function publicAppHref(pathname: string, query?: Record<string, string>): string | null {
  const base = getPublicAppUrl();
  if (!base) return null;
  const url = new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, `${base}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
