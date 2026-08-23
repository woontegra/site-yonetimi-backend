import type { NextFunction, Request, Response } from "express";
import { supplierService } from "../services/supplier.service";
import { HttpError } from "../utils/httpError";
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from "../validators/supplier.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif site seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listSuppliers(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listSuppliersQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await supplierService.list(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const supplier = await supplierService.getById(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ supplier });
  } catch (error) {
    next(error);
  }
}

export async function createSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const supplier = await supplierService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ supplier });
  } catch (error) {
    next(error);
  }
}

export async function updateSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateSupplierSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const supplier = await supplierService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ supplier });
  } catch (error) {
    next(error);
  }
}

export async function deleteSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    await supplierService.softDelete(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
