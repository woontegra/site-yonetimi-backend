import type { NextFunction, Request, Response } from "express";
import { getMyLicenseOverview, listMyLicenseHistory } from "../services/entitlement.service";
import { HttpError } from "../utils/httpError";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new HttpError(400, "Organizasyon bağlamı gerekli.", "ORGANIZATION_CONTEXT_REQUIRED");
  }
  return tenantId;
}

function userIdFrom(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Oturum açmanız gerekiyor.");
  return userId;
}

export async function getMySubscriptionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const overview = await getMyLicenseOverview(userIdFrom(req), tenantIdFrom(req));
    res.status(200).json(overview);
  } catch (error) {
    next(error);
  }
}

export async function listMySubscriptionHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 20);
    res.status(200).json(await listMyLicenseHistory(tenantIdFrom(req), Number.isFinite(limit) ? limit : 20));
  } catch (error) {
    next(error);
  }
}
