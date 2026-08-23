import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { duesDefinitionService } from "../services/dues.service";
import { HttpError } from "../utils/httpError";
import {
  createDuesDefinitionSchema,
  listDuesDefinitionsQuerySchema,
  updateDuesDefinitionSchema,
} from "../validators/dues.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listDuesDefinitions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listDuesDefinitionsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await duesDefinitionService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getDuesDefinition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dues = await duesDefinitionService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ dues });
  } catch (error) {
    next(error);
  }
}

export async function createDuesDefinition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createDuesDefinitionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const dues = await duesDefinitionService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ dues });
  } catch (error) {
    next(error);
  }
}

export async function updateDuesDefinition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateDuesDefinitionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const dues = await duesDefinitionService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ dues });
  } catch (error) {
    next(error);
  }
}

export async function deleteDuesDefinition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await duesDefinitionService.remove(tenantIdFrom(req), siteIdFrom(req), String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function previewDuesCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const preview = await duesDefinitionService.getChargePreview(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
}

export async function chargeDues(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const result = await duesDefinitionService.chargeApartments(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function cancelOpenDuesDebts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await duesDefinitionService.cancelOpenDebts(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
