import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { siteSetupService } from "../services/site-setup.service";
import { HttpError } from "../utils/httpError";
import {
  assignResidentSchema,
  bulkApartmentsSchema,
  bulkBuildingsSchema,
  importCommitSchema,
  importPreviewSchema,
  residentImportCommitSchema,
  residentImportPreviewSchema,
  updateSetupStatusSchema,
} from "../validators/site-setup.validators";

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

export async function getSetupSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await siteSetupService.getSummary(tenantIdFrom(req), siteIdFrom(req));
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
}

export async function updateSetupStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = updateSetupStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const site = await siteSetupService.updateStatus(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.status,
    );
    res.status(200).json({ site });
  } catch (error) {
    next(error);
  }
}

export async function bulkCreateBuildings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = bulkBuildingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.bulkCreateBuildings(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.buildings,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function bulkCreateApartments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = bulkApartmentsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.bulkCreateApartments(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function assignResident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = assignResidentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.assignResident(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function previewImport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = importPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.previewImport(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.rows,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function commitImport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = importCommitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.commitImport(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.rows,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function previewResidentsImport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = residentImportPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.previewResidentsImport(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.rows,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function commitResidentsImport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = residentImportCommitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await siteSetupService.commitResidentsImport(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data.rows,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}
