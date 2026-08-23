import { env } from "../config/env";
import { prisma } from "../lib/prisma";

function listedEmails(): string[] {
  return env.platformAdminEmails;
}

export function isListedPlatformAdminEmail(email: string): boolean {
  return listedEmails().includes(email.trim().toLowerCase());
}

/** Env listesindeki mevcut kullanıcılara platform admin verir. Geri almaz. API ile çağrılmaz. */
export async function grantPlatformAdminIfListed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!isListedPlatformAdminEmail(normalized)) return false;

  const result = await prisma.user.updateMany({
    where: { email: normalized, isPlatformAdmin: false },
    data: { isPlatformAdmin: true },
  });

  if (result.count > 0) return true;

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { isPlatformAdmin: true },
  });
  return Boolean(user?.isPlatformAdmin);
}

export async function provisionPlatformAdmins(): Promise<void> {
  const emails = listedEmails();
  if (emails.length === 0) return;

  await prisma.user.updateMany({
    where: { email: { in: emails }, isPlatformAdmin: false },
    data: { isPlatformAdmin: true },
  });
}
