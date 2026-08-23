import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

/**
 * İstek gövdesindeki veya X-Tenant-Id başlığındaki site kimliğini doğrular.
 * Kullanıcının o tenant'a üyeliği yoksa erişimi reddeder.
 * Ağır yetki matrisi bu fazda yok; yalnızca tenant izolasyonu kurulur.
 */
export async function requireTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const tenantId =
      (typeof req.headers["x-tenant-id"] === "string" ? req.headers["x-tenant-id"] : null) ??
      req.auth.tenantId;

    if (!tenantId) {
      throw new HttpError(400, "Aktif hesap seçilmedi.");
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId: req.auth.userId,
          tenantId,
        },
      },
    });

    if (!membership) {
      throw new HttpError(403, "Bu hesaba erişim yetkiniz yok.");
    }

    req.auth.tenantId = tenantId;
    req.auth.role = membership.role;
    next();
  } catch (error) {
    next(error);
  }
}
