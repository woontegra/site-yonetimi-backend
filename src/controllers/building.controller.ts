import type { NextFunction, Request, Response } from "express";
import { buildingService } from "../services/building.service";
import { HttpError } from "../utils/httpError";
import {
  createBuildingSchema,
  listBuildingsQuerySchema,
  updateBuildingSchema,
} from "../validators/building.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new HttpError(400, "Aktif site seçilmedi.");
  }
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listBuildings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listBuildingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await buildingService.list(tenantIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const building = await buildingService.getById(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ building });
  } catch (error) {
    next(error);
  }
}

export async function createBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createBuildingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const building = await buildingService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ building });
  } catch (error) {
    next(error);
  }
}

export async function updateBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateBuildingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const building = await buildingService.update(tenantIdFrom(req), String(req.params.id), parsed.data);
    res.status(200).json({ building });
  } catch (error) {
    next(error);
  }
}

export async function deleteBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await buildingService.remove(tenantIdFrom(req), String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
