import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { apartmentDuesExemptionService } from "../services/apartment-dues-exemption.service";
import { HttpError } from "../utils/httpError";
import {
  createApartmentDuesExemptionSchema,
  updateApartmentDuesExemptionSchema,
} from "../validators/apartment-dues-exemption.validators";

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

export async function listApartmentDuesExemptions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await apartmentDuesExemptionService.listForApartment(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.apartmentId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getActiveApartmentDuesExemption(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await apartmentDuesExemptionService.getActiveForApartment(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.apartmentId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createApartmentDuesExemption(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createApartmentDuesExemptionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await apartmentDuesExemptionService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.apartmentId),
      actorUserIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateApartmentDuesExemption(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = updateApartmentDuesExemptionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await apartmentDuesExemptionService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      actorUserIdFrom(req),
      parsed.data,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function revokeApartmentDuesExemption(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertSiteActive(req);
    const result = await apartmentDuesExemptionService.revoke(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      actorUserIdFrom(req),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
