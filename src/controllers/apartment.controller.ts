import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { apartmentService } from "../services/apartment.service";
import { HttpError } from "../utils/httpError";
import {
  createApartmentSchema,
  listApartmentsQuerySchema,
  updateApartmentSchema,
} from "../validators/apartment.validators";

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

function canIncludePhone(req: Request): boolean {
  const permissions = req.auth?.permissions ?? [];
  if (permissions.length === 0) return true;
  return permissions.includes("persons.view") || permissions.includes("apartments.view");
}

export async function listApartments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listApartmentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await apartmentService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data, {
      includePhone: canIncludePhone(req),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getApartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apartment = await apartmentService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      { includePhone: canIncludePhone(req) },
    );
    res.status(200).json({ apartment });
  } catch (error) {
    next(error);
  }
}

export async function createApartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createApartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const apartment = await apartmentService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ apartment });
  } catch (error) {
    next(error);
  }
}

export async function updateApartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateApartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const apartment = await apartmentService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ apartment });
  } catch (error) {
    next(error);
  }
}

export async function deleteApartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await apartmentService.remove(tenantIdFrom(req), siteIdFrom(req), String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
