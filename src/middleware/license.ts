import type { NextFunction, Request, Response } from "express";
import { evaluateLicenseAccess, isLicenseEnforcementEnabled } from "../services/entitlement.service";
import { HttpError } from "../utils/httpError";

/**
 * Gelecekteki lisans kilidi.
 *
 * - Kullanıcı aktifliği ve isPlatformAdmin her istekte veritabanından okunur.
 * - Platform admin tenant Subscription durumundan muaftır.
 * - LICENSE_ENFORCEMENT !== "true" iken normal kullanıcılar kilitlenmez.
 * - Admin router bu middleware'e bağlanmaz; requirePlatformAdmin yeterlidir.
 * - Bu middleware veri silmez.
 *
 * Bu fazda tenant route'larına takılmaz. Kilidi açmak için env + mount gerekir.
 */
export async function requireValidLicense(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const { user, decision } = await evaluateLicenseAccess(userId, req.auth?.tenantId ?? null);

    if (!user || !user.isActive || decision.reason === "inactive_user") {
      throw new HttpError(401, "Oturum geçersiz.");
    }

    if (user.isPlatformAdmin) {
      req.auth = { ...req.auth!, isPlatformAdmin: true };
      next();
      return;
    }

    if (!isLicenseEnforcementEnabled()) {
      next();
      return;
    }

    if (!decision.allowed) {
      throw new HttpError(403, "Lisans süresi doldu veya abonelik geçersiz.");
    }

    next();
  } catch (error) {
    next(error);
  }
}
