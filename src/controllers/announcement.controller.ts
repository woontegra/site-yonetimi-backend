import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { announcementService } from "../services/announcement.service";
import { HttpError } from "../utils/httpError";
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  previewAudienceSchema,
  updateAnnouncementSchema,
} from "../validators/announcement.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listAnnouncements(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listAnnouncementsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await announcementService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    const announcement = await announcementService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function createAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const publish = req.body?.publish === true || req.query.publish === "true";
    const announcement = await announcementService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
      {
        publish,
        createdByUserId: req.auth?.userId ?? null,
      },
    );
    res.status(201).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function updateAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = updateAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const announcement = await announcementService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function publishAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const announcement = await announcementService.publish(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function archiveAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const announcement = await announcementService.archive(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function cancelAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const announcement = await announcementService.cancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ announcement });
  } catch (error) {
    next(error);
  }
}

export async function deleteAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const result = await announcementService.hardDelete(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function previewAudience(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = previewAudienceSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const preview = await announcementService.previewAudience(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
}
