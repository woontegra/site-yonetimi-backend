import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { siteService } from "../services/site.service";
import { allowedSiteIdsFrom } from "../middleware/tenant";
import { HttpError } from "../utils/httpError";
import {
  confirmSiteDeleteSchema,
  createSiteSchema,
  listSitesQuerySchema,
  updateSiteSchema,
} from "../validators/site.validators";
import { getSiteDeletePreview, permanentlyDeleteSite } from "../services/site-purge.service";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new HttpError(400, "Aktif hesap seçilmedi.");
  }
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listSitesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const allowedSiteIds = allowedSiteIdsFrom(req);
    const result = await siteService.list(tenantIdFrom(req), parsed.data, allowedSiteIds);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listActiveSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await siteService.listActive(tenantIdFrom(req), allowedSiteIdsFrom(req));
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

export async function getSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = await siteService.getById(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ site });
  } catch (error) {
    next(error);
  }
}

export async function createSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const site = await siteService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ site });
  } catch (error) {
    next(error);
  }
}

export async function updateSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const site = await siteService.update(tenantIdFrom(req), String(req.params.id), parsed.data);
    res.status(200).json({ site });
  } catch (error) {
    next(error);
  }
}

export async function previewSiteDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = tenantIdFrom(req);
    const id = String(req.params.id);
    const allowed = allowedSiteIdsFrom(req);
    if (allowed && !allowed.includes(id)) {
      throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
    }
    res.status(200).json(await getSiteDeletePreview(tenantId, id));
  } catch (error) {
    next(error);
  }
}

export async function deleteSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = confirmSiteDeleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const tenantId = tenantIdFrom(req);
    const id = String(req.params.id);
    const allowed = allowedSiteIdsFrom(req);
    if (allowed && !allowed.includes(id)) {
      throw new HttpError(403, "Bu siteye erişim yetkiniz yok.");
    }
    await permanentlyDeleteSite(tenantId, id, parsed.data.confirmName);
    res.status(200).json({ message: "Site ve ilişkili kayıtları kalıcı olarak silindi." });
  } catch (error) {
    next(error);
  }
}

/** Building create için site aktiflik kontrolü yardımcısı — controller'larda kullanılır. */
export { assertSiteActive, siteIdFrom };
