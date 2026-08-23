import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

/**
 * Platform admin kontrolü JWT'deki role'e güvenmez; her istekte DB'den okunur.
 * Tenant requireTenant / requireSite ile karıştırılmaz.
 * Tenant Subscription durumuna bağlı değildir; lisans kilidinden muaftır.
 */
export async function requirePlatformAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, isPlatformAdmin: true },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, "Oturum geçersiz.");
    }

    if (!user.isPlatformAdmin) {
      throw new HttpError(403, "Bu alana erişim yetkiniz yok.");
    }

    req.auth = { ...req.auth!, isPlatformAdmin: true };
    next();
  } catch (error) {
    next(error);
  }
}

export function adminUserIdFrom(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Oturum açmanız gerekiyor.");
  return userId;
}
