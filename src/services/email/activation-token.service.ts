import { createHash, randomBytes } from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/httpError";

export const ACTIVATION_TTL_HOURS = 48;

export type ActivationPeekFailure = "invalid" | "used" | "expired" | "already_activated";

export type ActivationPeekResult =
  | { ok: true; fullName: string; email: string; expiresAt: Date }
  | { ok: false; reason: ActivationPeekFailure };

export function hashActivationToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function issueActivationToken(userId: string): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashActivationToken(raw);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.userActivationToken.deleteMany({
      where: { userId, usedAt: null },
    }),
    prisma.userActivationToken.create({
      data: { userId, tokenHash, expiresAt },
    }),
  ]);

  return { raw, expiresAt };
}

export async function consumeActivationToken(raw: string) {
  const tokenHash = hashActivationToken(raw.trim());
  const record = await prisma.userActivationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record) {
    throw new HttpError(400, "Aktivasyon bağlantısı geçersiz.", "ACTIVATION_INVALID");
  }
  if (record.user.isActive) {
    throw new HttpError(400, "Bu hesap zaten etkinleştirilmiş.", "ACTIVATION_ALREADY_ACTIVE");
  }
  if (record.usedAt) {
    throw new HttpError(400, "Bu aktivasyon bağlantısı daha önce kullanılmış.", "ACTIVATION_USED");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new HttpError(400, "Aktivasyon bağlantısının süresi dolmuş.", "ACTIVATION_EXPIRED");
  }
  return record;
}

export async function peekActivationToken(raw: string): Promise<ActivationPeekResult> {
  const tokenHash = hashActivationToken(raw.trim());
  const record = await prisma.userActivationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { fullName: true, email: true, isActive: true } } },
  });
  if (!record) {
    return { ok: false, reason: "invalid" };
  }
  if (record.user.isActive) {
    return { ok: false, reason: "already_activated" };
  }
  if (record.usedAt) {
    return { ok: false, reason: "used" };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    fullName: record.user.fullName,
    email: record.user.email,
    expiresAt: record.expiresAt,
  };
}
