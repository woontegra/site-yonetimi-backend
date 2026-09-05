import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { paymentService } from "../services/payment.service";
import { HttpError } from "../utils/httpError";
import {
  createPaymentSchema,
  listPaymentsQuerySchema,
  previewPaymentSchema,
} from "../validators/payment.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listPaymentsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await paymentService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payment = await paymentService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ payment });
  } catch (error) {
    next(error);
  }
}

export async function previewPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = previewPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const check = await paymentService.previewCreate(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(200).json({ check });
  } catch (error) {
    next(error);
  }
}

export async function previewPaymentCancel(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const check = await paymentService.previewCancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ check });
  } catch (error) {
    next(error);
  }
}

export async function createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const idempotencyKey =
      typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].trim() : undefined;
    const payment = await paymentService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
      idempotencyKey || undefined,
    );
    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
}

export async function deletePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payment = await paymentService.cancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ payment });
  } catch (error) {
    next(error);
  }
}

export async function paymentMonthlySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new HttpError(400, "Geçerli bir yıl girin.");
    }
    const summary = await paymentService.monthlySummary(tenantIdFrom(req), siteIdFrom(req), year);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
}
