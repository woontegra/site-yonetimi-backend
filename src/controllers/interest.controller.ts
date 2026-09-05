import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { interestService } from "../services/interest.service";
import { HttpError } from "../utils/httpError";
import {
  createInterestDecisionSchema,
  interestApplySchema,
  interestPreviewSchema,
  listInterestDecisionsQuerySchema,
  updateInterestDecisionSchema,
} from "../validators/interest.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listInterestDecisions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listInterestDecisionsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await interestService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getInterestDecision(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const decision = await interestService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ decision });
  } catch (error) {
    next(error);
  }
}

export async function createInterestDecision(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createInterestDecisionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const decision = await interestService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      req.auth?.userId,
      parsed.data,
    );
    res.status(201).json({ decision });
  } catch (error) {
    next(error);
  }
}

export async function updateInterestDecision(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = updateInterestDecisionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const decision = await interestService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ decision });
  } catch (error) {
    next(error);
  }
}

export async function deleteInterestDecision(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    await interestService.remove(tenantIdFrom(req), siteIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function previewInterest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = interestPreviewSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await interestService.preview(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function applyInterest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = interestApplySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await interestService.apply(
      tenantIdFrom(req),
      siteIdFrom(req),
      req.auth?.userId,
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}
