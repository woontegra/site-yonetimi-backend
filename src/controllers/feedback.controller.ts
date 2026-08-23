import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { feedbackCategoryService } from "../services/feedback-category.service";
import { feedbackRecordService } from "../services/feedback-record.service";
import { HttpError } from "../utils/httpError";
import {
  changeFeedbackStatusSchema,
  createFeedbackCategorySchema,
  createFeedbackRecordSchema,
  listFeedbackCategoriesQuerySchema,
  listFeedbackRecordsQuerySchema,
  updateFeedbackCategorySchema,
  updateFeedbackRecordSchema,
} from "../validators/feedback.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listFeedbackCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listFeedbackCategoriesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await feedbackCategoryService.list(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function createFeedbackCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createFeedbackCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const category = await feedbackCategoryService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
}

export async function updateFeedbackCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateFeedbackCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const category = await feedbackCategoryService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ category });
  } catch (error) {
    next(error);
  }
}

export async function deleteFeedbackCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await feedbackCategoryService.softDelete(
      tenantIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listFeedbackRecords(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listFeedbackRecordsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await feedbackRecordService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getFeedbackRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await feedbackRecordService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ record });
  } catch (error) {
    next(error);
  }
}

export async function listFeedbackRecordHistory(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(
      await feedbackRecordService.listHistory(
        tenantIdFrom(req),
        siteIdFrom(req),
        String(req.params.id),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function createFeedbackRecord(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createFeedbackRecordSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const record = await feedbackRecordService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ record });
  } catch (error) {
    next(error);
  }
}

export async function updateFeedbackRecord(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = updateFeedbackRecordSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const record = await feedbackRecordService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ record });
  } catch (error) {
    next(error);
  }
}

export async function changeFeedbackStatus(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = changeFeedbackStatusSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const record = await feedbackRecordService.changeStatus(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ record });
  } catch (error) {
    next(error);
  }
}

export async function deleteFeedbackRecord(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const result = await feedbackRecordService.softDelete(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
