import type { NextFunction, Request, Response } from "express";
import { siteIdFrom } from "../middleware/site";
import { dashboardService } from "../services/dashboard.service";
import { HttpError } from "../utils/httpError";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

export async function getDashboardOverview(req: Request, res: Response, next: NextFunction) {
  try {
    const overview = await dashboardService.getOverview(tenantIdFrom(req), siteIdFrom(req));
    res.status(200).json(overview);
  } catch (error) {
    next(error);
  }
}
