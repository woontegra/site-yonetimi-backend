import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_ENV_NAMES = ["CREDENTIAL_ENCRYPTION_KEY", "WHATSAPP_CREDENTIAL_ENCRYPTION_KEY"] as const;

export function sanitizeSecretEnv(value: string | undefined | null): string | null {
  if (value == null) return null;
  let next = value.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const quoted =
    (next.startsWith('"') && next.endsWith('"') && next.length >= 2) ||
    (next.startsWith("'") && next.endsWith("'") && next.length >= 2);
  if (quoted) {
    next = next.slice(1, -1).replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  }
  return next || null;
}

function resolveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through
  }
  return createHash("sha256").update(trimmed, "utf8").digest();
}

function encryptSourceName(): string | null {
  if (sanitizeSecretEnv(process.env.CREDENTIAL_ENCRYPTION_KEY)) return "CREDENTIAL_ENCRYPTION_KEY";
  if (sanitizeSecretEnv(process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY)) {
    return "WHATSAPP_CREDENTIAL_ENCRYPTION_KEY";
  }
  return null;
}

function getEncryptionKey(): Buffer {
  const raw =
    sanitizeSecretEnv(process.env.CREDENTIAL_ENCRYPTION_KEY) ||
    sanitizeSecretEnv(process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY);
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY veya WHATSAPP_CREDENTIAL_ENCRYPTION_KEY tanımlı değil. Gizli bilgiler kaydedilemez.",
    );
  }
  return resolveKey(raw);
}

function candidateDecryptKeys(): Buffer[] {
  const unique: Buffer[] = [];
  const seen = new Set<string>();
  const add = (value: string | null) => {
    if (!value) return;
    const key = resolveKey(value);
    const id = key.toString("hex");
    if (seen.has(id)) return;
    seen.add(id);
    unique.push(key);
  };

  for (const name of KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    add(sanitizeSecretEnv(raw));
    add(raw.replace(/^\uFEFF/, "").replace(/\r/g, "").trim());
  }
  return unique;
}

function decryptWithKey(key: Buffer, ivB64: string, authTagB64: string, dataB64: string): string {
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function hasEncryptionKey(): boolean {
  return Boolean(
    sanitizeSecretEnv(process.env.CREDENTIAL_ENCRYPTION_KEY) ||
      sanitizeSecretEnv(process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY),
  );
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const keys = candidateDecryptKeys();
  if (keys.length === 0) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY veya WHATSAPP_CREDENTIAL_ENCRYPTION_KEY tanımlı değil. Gizli bilgiler kaydedilemez.",
    );
  }
  const normalized = ciphertext.replace(/^\uFEFF/, "").trim();
  const parts = normalized.split(":");
  if (parts.length !== 3) {
    throw new Error("Geçersiz şifreli veri formatı.");
  }
  const [ivB64, authTagB64, dataB64] = parts;
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptWithKey(key, ivB64, authTagB64, dataB64);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gizli bilgi çözülemedi.");
}

function fingerprintOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

export function inspectEncryptionRuntime(): {
  emailProviderMode: string;
  encryptUses: string | null;
  keys: Array<{
    name: string;
    present: boolean;
    length: number;
    wrappingQuotes: boolean;
    leadingOrTrailingWhitespace: boolean;
    containsNewline: boolean;
    fingerprint: string | null;
  }>;
} {
  const keys = KEY_ENV_NAMES.map((name) => {
    const raw = process.env[name];
    const present = raw != null && raw.length > 0;
    const trimmed = raw?.trim() ?? "";
    const wrappingQuotes =
      present &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
    const leadingOrTrailingWhitespace = present && raw !== raw.trim();
    const containsNewline = present && /[\r\n]/.test(raw);
    const sanitized = sanitizeSecretEnv(raw);
    return {
      name,
      present,
      length: sanitized?.length ?? 0,
      wrappingQuotes,
      leadingOrTrailingWhitespace,
      containsNewline,
      fingerprint: sanitized ? fingerprintOf(sanitized) : null,
    };
  });

  return {
    emailProviderMode: env.emailProviderMode,
    encryptUses: encryptSourceName(),
    keys,
  };
}

export function logEncryptionRuntimeSafely(): void {
  const info = inspectEncryptionRuntime();
  console.log(
    JSON.stringify({
      msg: "credential-encryption-runtime",
      encryptUses: info.encryptUses,
      emailProviderMode: info.emailProviderMode,
      keys: info.keys.map((item) => ({
        name: item.name,
        present: item.present,
        length: item.length,
        wrappingQuotes: item.wrappingQuotes,
        leadingOrTrailingWhitespace: item.leadingOrTrailingWhitespace,
        containsNewline: item.containsNewline,
        fingerprint: item.fingerprint,
      })),
    }),
  );
}

export function tokenLastFour(token: string): string {
  const trimmed = token.trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
}
