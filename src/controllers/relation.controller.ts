import type { NextFunction, Request, Response } from "express";
import { relationService } from "../services/relation.service";
import { HttpError } from "../utils/httpError";
import {
  createRelationSchema,
  endRelationSchema,
  listRelationsQuerySchema,
  updateRelationSchema,
} from "../validators/relation.validators";

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

export async function listRelations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listRelationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await relationService.list(tenantIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createRelation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createRelationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const relation = await relationService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ relation });
  } catch (error) {
    next(error);
  }
}

export async function updateRelation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateRelationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const relation = await relationService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ relation });
  } catch (error) {
    next(error);
  }
}

export async function deleteRelation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = endRelationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const relation = await relationService.end(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ relation });
  } catch (error) {
    next(error);
  }
}
