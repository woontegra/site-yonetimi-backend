import type { NextFunction, Request, Response } from "express";
import { personService } from "../services/person.service";
import { HttpError } from "../utils/httpError";
import {
  createPersonSchema,
  createPersonWithRelationSchema,
  listPersonsQuerySchema,
  updatePersonSchema,
} from "../validators/person.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new HttpError(400, "Aktif hesap seçilmedi.");
  }
  return tenantId;
}

function optionalSiteIdFrom(req: Request): string | null {
  return req.auth?.siteId ?? null;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listPersons(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listPersonsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await personService.list(
      tenantIdFrom(req),
      parsed.data,
      optionalSiteIdFrom(req),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPerson(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const person = await personService.getById(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ person });
  } catch (error) {
    next(error);
  }
}

export async function createPerson(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createPersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const person = await personService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ person });
  } catch (error) {
    next(error);
  }
}

export async function createPersonWithRelation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createPersonWithRelationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const result = await personService.createWithOptionalRelation(
      tenantIdFrom(req),
      optionalSiteIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updatePerson(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, firstZodMessage(parsed.error));
    }
    const person = await personService.update(tenantIdFrom(req), String(req.params.id), parsed.data);
    res.status(200).json({ person });
  } catch (error) {
    next(error);
  }
}

export async function deletePerson(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await personService.remove(tenantIdFrom(req), String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
