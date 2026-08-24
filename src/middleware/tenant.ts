import type { NextFunction, Request, Response } from "express";
import type { PermissionCode } from "../permissions/catalog";
import { effectivePermissions } from "../permissions/catalog";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

export async function requireTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
      where: { userId_tenantId: { userId: req.auth.userId, tenantId } },
      include: {
        tenant: { select: { isActive: true } },
        siteAccesses: { select: { siteId: true } },
      },
    });

    if (!membership || !membership.tenant.isActive) {
      throw new HttpError(403, "Bu hesaba erişim yetkiniz yok.");
    }
    if (membership.status === "DISABLED") {
      throw new HttpError(403, "Bu hesaptaki üyeliğiniz pasif.");
    }
    if (membership.status === "INVITED") {
      throw new HttpError(403, "Davet henüz kabul edilmedi. Aktivasyon e-postasındaki bağlantıyı kullanın.");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { isActive: true, isPlatformAdmin: true },
    });
    if (!user?.isActive) {
      throw new HttpError(403, "Hesabınız pasif durumda.");
    }

    req.auth.tenantId = tenantId;
    req.auth.role = membership.role;
    req.auth.membershipId = membership.id;
    req.auth.allSites = membership.allSites;
    req.auth.allowedSiteIds = membership.allSites ? null : membership.siteAccesses.map((item) => item.siteId);
    req.auth.permissions = effectivePermissions(membership.role, membership.permissions);
    req.auth.isPlatformAdmin = Boolean(user.isPlatformAdmin);
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(code: PermissionCode) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.auth?.permissions?.includes(code)) {
        throw new HttpError(403, "Bu işlem için yetkiniz yok.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAnyPermission(...codes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const granted = req.auth?.permissions ?? [];
      if (!codes.some((code) => granted.includes(code))) {
        throw new HttpError(403, "Bu işlem için yetkiniz yok.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function allowedSiteIdsFrom(req: Request): string[] | null {
  if (req.auth?.allSites === false) {
    return req.auth.allowedSiteIds ?? [];
  }
  return null;
}


