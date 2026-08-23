import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { visitService } from "../services/visit.service";
import { visitorService } from "../services/visitor.service";
import { HttpError } from "../utils/httpError";
import {
  createVisitSchema,
  createVisitorSchema,
  listVisitorsQuerySchema,
  listVisitsQuerySchema,
  updateVisitSchema,
  updateVisitorSchema,
} from "../validators/visitor.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif site seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listVisitors(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listVisitorsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await visitorService.list(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getVisitor(req: Request, res: Response, next: NextFunction) {
  try {
    const visitor = await visitorService.getById(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ visitor });
  } catch (error) {
    next(error);
  }
}

export async function createVisitor(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createVisitorSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const visitor = await visitorService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ visitor });
  } catch (error) {
    next(error);
  }
}

export async function updateVisitor(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateVisitorSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const visitor = await visitorService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ visitor });
  } catch (error) {
    next(error);
  }
}

export async function deleteVisitor(req: Request, res: Response, next: NextFunction) {
  try {
    await visitorService.softDelete(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function listVisits(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listVisitsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await visitService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ visit });
  } catch (error) {
    next(error);
  }
}

export async function createVisit(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createVisitSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const visit = await visitService.create(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(201).json({ visit });
  } catch (error) {
    next(error);
  }
}

export async function updateVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateVisitSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const visit = await visitService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ visit });
  } catch (error) {
    next(error);
  }
}

export async function checkOutVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitService.checkOut(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ visit });
  } catch (error) {
    next(error);
  }
}

export async function cancelVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitService.cancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ visit });
  } catch (error) {
    next(error);
  }
}

export async function visitInsideSummary(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await visitService.insideCount(tenantIdFrom(req), siteIdFrom(req)));
  } catch (error) {
    next(error);
  }
}
