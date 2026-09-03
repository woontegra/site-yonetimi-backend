import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { duesDefinitionService } from "../services/dues.service";
import { HttpError } from "../utils/httpError";
import {
  createDuesDefinitionSchema,
  chargeScopePreviewSchema,
  listDuesDefinitionsQuerySchema,
  multiPeriodAssessmentSchema,
  purgeDuesAssessmentSchema,
  updateDuesDefinitionSchema,
} from "../validators/dues.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function actorUserIdFrom(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Oturum gerekli.");
  return userId;
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
    const result = await duesDefinitionService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function previewMultiPeriodAssessment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = multiPeriodAssessmentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const preview = await duesDefinitionService.previewMultiPeriodAssessment(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
}

export async function createMultiPeriodAssessment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = multiPeriodAssessmentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await duesDefinitionService.createMultiPeriodAssessment(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
      actorUserIdFrom(req),
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAssessmentBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const batch = await duesDefinitionService.getAssessmentBatch(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.batchId),
    );
    res.status(200).json(batch);
  } catch (error) {
    next(error);
  }
}

export async function purgeAssessmentBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = purgeDuesAssessmentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await duesDefinitionService.purgeAssessmentBatch(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.batchId),
      actorUserIdFrom(req),
      parsed.data.confirmName,
    );
    res.status(200).json(result);
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

export async function previewDuesChargeScope(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = chargeScopePreviewSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const preview = await duesDefinitionService.getChargeScopePreview(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(200).json(preview);
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

export async function previewDuesPurge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const preview = await duesDefinitionService.getPurgePreview(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
}

export async function purgeDuesAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = purgeDuesAssessmentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await duesDefinitionService.purgeUnpaid(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      actorUserIdFrom(req),
      parsed.data.confirmName,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
