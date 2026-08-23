import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

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

function getEncryptionKey(): Buffer {
  const raw = env.credentialEncryptionKey;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY veya WHATSAPP_CREDENTIAL_ENCRYPTION_KEY tanımlı değil. Gizli bilgiler kaydedilemez.",
    );
  }
  return resolveKey(raw);
}

function candidateDecryptKeys(): Buffer[] {
  const rawKeys = [env.credentialEncryptionKey, env.whatsappCredentialEncryptionKey].filter(
    (value): value is string => Boolean(value),
  );
  const unique: Buffer[] = [];
  const seen = new Set<string>();
  for (const raw of rawKeys) {
    const key = resolveKey(raw);
    const id = key.toString("hex");
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(key);
    }
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
  return Boolean(env.credentialEncryptionKey);
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
  const parts = ciphertext.split(":");
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

export function tokenLastFour(token: string): string {
  const trimmed = token.trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
}
