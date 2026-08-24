import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

/**
 * X-Site-Id başlığındaki aktif siteyi doğrular.
 * Site mevcut tenant'a ait, aktif ve soft-delete edilmemiş olmalıdır.
 * Tenant güvenlik sınırı ile karıştırılmaz; requireTenant sonrası kullanılır.
 */
export async function requireSite(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth?.tenantId) {
      throw new HttpError(400, "Aktif hesap seçilmedi.");
    }

    const siteId =
      typeof req.headers["x-site-id"] === "string" ? req.headers["x-site-id"].trim() : "";

    if (!siteId) {
      throw new HttpError(400, "Aktif site seçilmedi.");
    }

    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        tenantId: req.auth.tenantId,
        deletedAt: null,
      },
      select: { id: true, isActive: true },
    });

    if (!site) {
      throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
    }

    if (req.auth.allSites === false) {
      const allowed = req.auth.allowedSiteIds ?? [];
      if (!allowed.includes(site.id)) {
        throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
      }
    }

    req.auth.siteId = site.id;
    req.auth.siteIsActive = site.isActive;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * X-Site-Id varsa doğrular; yoksa siteId null bırakır (tenant seviyesindeki endpointler için).
 */
export async function optionalSite(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth?.tenantId) {
      next();
      return;
    }

    const raw =
      typeof req.headers["x-site-id"] === "string" ? req.headers["x-site-id"].trim() : "";

    if (!raw) {
      req.auth.siteId = null;
      req.auth.siteIsActive = null;
      next();
      return;
    }

    const site = await prisma.site.findFirst({
      where: {
        id: raw,
        tenantId: req.auth.tenantId,
        deletedAt: null,
      },
      select: { id: true, isActive: true },
    });

    if (!site) {
      throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
    }

    if (req.auth.allSites === false) {
      const allowed = req.auth.allowedSiteIds ?? [];
      if (!allowed.includes(site.id)) {
        throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
      }
    }

    req.auth.siteId = site.id;
    req.auth.siteIsActive = site.isActive;
    next();
  } catch (error) {
    next(error);
  }
}

export function siteIdFrom(req: Request): string {
  const siteId = req.auth?.siteId;
  if (!siteId) {
    throw new HttpError(400, "Aktif site seçilmedi.");
  }
  return siteId;
}

export function assertSiteActive(req: Request): void {
  if (req.auth?.siteIsActive === false) {
    throw new HttpError(400, "Pasif site için yeni işlem oluşturulamaz.");
  }
}
