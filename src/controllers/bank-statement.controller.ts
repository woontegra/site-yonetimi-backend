import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { bankStatementImportService } from "../services/bank-statement-import.service";
import { HttpError } from "../utils/httpError";
import {
  bankStatementCommitSchema,
  bankStatementPreviewSchema,
  createBankColumnTemplateSchema,
  updateBankColumnTemplateSchema,
} from "../validators/bank-statement.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function previewBankStatementImport(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = bankStatementPreviewSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await bankStatementImportService.preview(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function commitBankStatementImport(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = bankStatementCommitSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const result = await bankStatementImportService.commit(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getBankHubSummary(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ summary: await bankStatementImportService.summary(tenantIdFrom(req), siteIdFrom(req)) });
  } catch (error) {
    next(error);
  }
}

export async function listBankColumnTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const bankAccountId =
      typeof req.query.bankAccountId === "string" && req.query.bankAccountId
        ? req.query.bankAccountId
        : undefined;
    res
      .status(200)
      .json(
        await bankStatementImportService.listColumnTemplates(
          tenantIdFrom(req),
          siteIdFrom(req),
          bankAccountId,
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function createBankColumnTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createBankColumnTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const template = await bankStatementImportService.createColumnTemplate(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
}

export async function updateBankColumnTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateBankColumnTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const template = await bankStatementImportService.updateColumnTemplate(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ template });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankColumnTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    await bankStatementImportService.deleteColumnTemplate(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
