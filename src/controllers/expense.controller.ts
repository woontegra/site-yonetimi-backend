import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { expenseService } from "../services/expense.service";
import { expenseTypeService } from "../services/expense-type.service";
import { HttpError } from "../utils/httpError";
import {
  createExpenseSchema,
  createExpenseTypeSchema,
  listExpenseTypesQuerySchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  updateExpenseTypeSchema,
} from "../validators/expense.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listExpenses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listExpensesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await expenseService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const expense = await expenseService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ expense });
  } catch (error) {
    next(error);
  }
}

export async function createExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertSiteActive(req);
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const expense = await expenseService.create(tenantIdFrom(req), siteIdFrom(req), parsed.data);
    res.status(201).json({ expense });
  } catch (error) {
    next(error);
  }
}

export async function updateExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateExpenseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const expense = await expenseService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ expense });
  } catch (error) {
    next(error);
  }
}

export async function deleteExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const expense = await expenseService.cancel(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ expense });
  } catch (error) {
    next(error);
  }
}

export async function expenseMonthlySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new HttpError(400, "Geçerli bir yıl girin.");
    }
    const summary = await expenseService.monthlySummary(tenantIdFrom(req), siteIdFrom(req), year);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
}

export async function listExpenseTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listExpenseTypesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await expenseTypeService.list(tenantIdFrom(req), parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createExpenseType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createExpenseTypeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const expenseType = await expenseTypeService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ expenseType });
  } catch (error) {
    next(error);
  }
}

export async function updateExpenseType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateExpenseTypeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const expenseType = await expenseTypeService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ expenseType });
  } catch (error) {
    next(error);
  }
}

export async function deleteExpenseType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await expenseTypeService.softDelete(tenantIdFrom(req), String(req.params.id));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
