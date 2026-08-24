import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Eksik ortam değişkeni: ${name}`);
  }
  return value;
}

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseIdList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function originFromUrl(value: string | undefined | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "") || null;
  }
}

function parseOrigins(value: string): string[] {
  const fromEnv = value
    .split(",")
    .map((item) => originFromUrl(item))
    .filter((item): item is string => Boolean(item));
  const fromPublicApp = originFromUrl(process.env.PUBLIC_APP_URL);
  const productionApp = "https://site.woontegra.com";
  return [...new Set([...fromEnv, fromPublicApp, productionApp].filter((item): item is string => Boolean(item)))];
}

function resolveWhatsAppProviderMode(): "mock" | "meta" {
  const raw = process.env.WHATSAPP_PROVIDER_MODE?.trim().toLowerCase();
  if (raw === "mock" || raw === "meta") return raw;
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return nodeEnv === "production" ? "meta" : "mock";
}

function resolveEmailProviderMode(): "mock" | "smtp" {
  const raw = process.env.EMAIL_PROVIDER_MODE?.trim().toLowerCase();
  if (raw === "mock" || raw === "smtp") return raw;
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return nodeEnv === "production" ? "smtp" : "mock";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: parseOrigins(
    process.env.CORS_ORIGIN ?? "http://localhost:3000,http://localhost:3001",
  ),
  whatsappGraphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0",
  credentialEncryptionKey:
    process.env.CREDENTIAL_ENCRYPTION_KEY?.trim() ||
    process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY?.trim() ||
    null,
  whatsappCredentialEncryptionKey: process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY?.trim() || null,
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null,
  metaAppSecret: process.env.META_APP_SECRET?.trim() || null,
  whatsappProviderMode: resolveWhatsAppProviderMode(),
  whatsappHttpTimeoutMs: Number(process.env.WHATSAPP_HTTP_TIMEOUT_MS ?? 15000),
  platformAdminEmails: parseEmailList(process.env.PLATFORM_ADMIN_EMAILS),
  protectedTenantIds: parseIdList(process.env.PROTECTED_TENANT_IDS),
  emailProviderMode: resolveEmailProviderMode(),
  emailHttpTimeoutMs: Number(process.env.EMAIL_HTTP_TIMEOUT_MS ?? 15000),
  publicAppUrl: process.env.PUBLIC_APP_URL?.trim() || null,
};
