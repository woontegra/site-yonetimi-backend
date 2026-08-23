import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { apartmentDebtService } from "../services/debt.service";
import { HttpError } from "../utils/httpError";
import {
  createApartmentDebtSchema,
  listApartmentDebtsQuerySchema,
  updateApartmentDebtSchema,
} from "../validators/debt.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listApartmentDebts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listApartmentDebtsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await apartmentDebtService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getApartmentDebt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const debt = await apartmentDebtService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ debt });
  } catch (error) {
    next(error);
  }
}

export async function createApartmentDebt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createApartmentDebtSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const debt = await apartmentDebtService.createManual(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ debt });
  } catch (error) {
    next(error);
  }
}

export async function updateApartmentDebt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateApartmentDebtSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const debt = await apartmentDebtService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ debt });
  } catch (error) {
    next(error);
  }
}

export async function deleteApartmentDebt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const debt = await apartmentDebtService.cancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ debt });
  } catch (error) {
    next(error);
  }
}
