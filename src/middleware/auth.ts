import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { HttpError } from "../utils/httpError";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }

    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
    };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    next(new HttpError(401, "Oturum geçersiz veya süresi dolmuş."));
  }
}

/** Site oluşturma / silme gibi yönetim işlemleri. */
export function requireSiteManager(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.auth) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }
    if (req.auth.role !== "SITE_YONETICISI") {
      throw new HttpError(403, "Site silme yetkiniz yok.");
    }
    next();
  } catch (error) {
    next(error);
  }
}
