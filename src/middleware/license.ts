import type { NextFunction, Request, Response } from "express";
import {
  evaluateLicenseAccess,
  licenseWriteForbiddenError,
} from "../services/entitlement.service";
import { HttpError } from "../utils/httpError";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Organizasyon lisansı yazma koruması.
 * - Platform admin muaftır.
 * - GET/HEAD/OPTIONS serbest.
 * - EXPIRED/SUSPENDED/CANCELLED → 403 + LICENSE_* kodu (veri silinmez).
 * requireTenant sonrasında çağrılmalıdır.
 */
export async function requireWritableLicense(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const userId = req.auth?.userId;
    const tenantId = req.auth?.tenantId ?? null;
    if (!userId) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const { user, subscription, decision } = await evaluateLicenseAccess(userId, tenantId);

    if (!user || !user.isActive || decision.reason === "inactive_user") {
      throw new HttpError(401, "Oturum geçersiz.");
    }

    if (user.isPlatformAdmin || decision.writable) {
      req.auth = { ...req.auth!, isPlatformAdmin: Boolean(user.isPlatformAdmin) };
      next();
      return;
    }

    if (subscription) {
      throw licenseWriteForbiddenError(subscription);
    }

    throw new HttpError(
      403,
      "Organizasyon lisansınızın süresi sona erdi. Verilerinizi görüntüleyebilir ancak yeni işlem oluşturamazsınız.",
      "LICENSE_EXPIRED",
    );
  } catch (error) {
    next(error);
  }
}

/** @deprecated Use requireWritableLicense */
export const requireValidLicense = requireWritableLicense;
