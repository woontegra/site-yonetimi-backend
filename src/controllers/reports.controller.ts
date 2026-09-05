import type { NextFunction, Request, Response } from "express";
import { siteIdFrom } from "../middleware/site";
import {
  buildExportFilename,
  exportApartmentDebts,
  exportApartmentStatement,
  exportBankTransactions,
  exportExpenses,
  exportFinancialSummary,
  exportPayments,
} from "../services/reports-export.service";
import { reportsService } from "../services/reports.service";
import { HttpError } from "../utils/httpError";
import {
  apartmentDebtsReportQuerySchema,
  apartmentStatementReportQuerySchema,
  bankTransactionsReportQuerySchema,
  expensesReportQuerySchema,
  exportFormatSchema,
  paymentsReportQuerySchema,
  reportCommonQuerySchema,
  reportTypeSchema,
  type ReportType,
} from "../validators/reports.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

async function loadReport(req: Request, reportType: ReportType) {
  const tenantId = tenantIdFrom(req);
  const siteId = siteIdFrom(req);

  switch (reportType) {
    case "financial-summary": {
      const parsed = reportCommonQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.financialSummary(tenantId, siteId, parsed.data);
    }
    case "apartment-debts": {
      const parsed = apartmentDebtsReportQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.apartmentDebts(tenantId, siteId, parsed.data);
    }
    case "payments": {
      const parsed = paymentsReportQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.payments(tenantId, siteId, parsed.data);
    }
    case "expenses": {
      const parsed = expensesReportQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.expenses(tenantId, siteId, parsed.data);
    }
    case "bank-transactions": {
      const parsed = bankTransactionsReportQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.bankTransactions(tenantId, siteId, parsed.data);
    }
    case "apartment-statement": {
      const parsed = apartmentStatementReportQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
      return reportsService.apartmentStatement(tenantId, siteId, parsed.data);
    }
    default:
      throw new HttpError(400, "Geçersiz rapor türü.");
  }
}

function isEmptyReport(reportType: ReportType, data: unknown): boolean {
  if (!data || typeof data !== "object") return true;
  const record = data as { items?: unknown[]; monthly?: unknown[] };
  if (reportType === "financial-summary") {
    const summary = (data as { summary?: { accrualCount?: number; collectionCount?: number; expenseCount?: number } })
      .summary;
    const monthly = record.monthly ?? [];
    const hasAny =
      (summary?.accrualCount ?? 0) +
        (summary?.collectionCount ?? 0) +
        (summary?.expenseCount ?? 0) >
        0 || monthly.length > 0;
    return !hasAny;
  }
  return !Array.isArray(record.items) || record.items.length === 0;
}

export async function getFinancialSummaryReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "financial-summary");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getApartmentDebtsReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "apartment-debts");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getPaymentsReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "payments");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getExpensesReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "expenses");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getBankTransactionsReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "bank-transactions");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getApartmentStatementReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await loadReport(req, "apartment-statement");
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function exportReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const typeParsed = reportTypeSchema.safeParse(req.params.reportType);
    if (!typeParsed.success) throw new HttpError(400, "Geçersiz rapor türü.");
    const formatParsed = exportFormatSchema.safeParse(req.query.format);
    if (!formatParsed.success) throw new HttpError(400, "format=pdf veya format=xlsx olmalıdır.");

    const reportType = typeParsed.data;
    const format = formatParsed.data;
    const data = await loadReport(req, reportType);

    if (isEmptyReport(reportType, data)) {
      throw new HttpError(400, "Seçtiğiniz filtrelere uygun kayıt bulunamadı.");
    }

    let buffer: Buffer;
    switch (reportType) {
      case "financial-summary":
        buffer = await exportFinancialSummary(data as never, format);
        break;
      case "apartment-debts":
        buffer = await exportApartmentDebts(data as never, format);
        break;
      case "payments":
        buffer = await exportPayments(data as never, format);
        break;
      case "expenses":
        buffer = await exportExpenses(data as never, format);
        break;
      case "bank-transactions":
        buffer = await exportBankTransactions(data as never, format);
        break;
      case "apartment-statement":
        buffer = await exportApartmentStatement(data as never, format);
        break;
      default:
        throw new HttpError(400, "Geçersiz rapor türü.");
    }

    const siteName =
      data && typeof data === "object" && "site" in data
        ? String((data as { site: { name: string } }).site.name)
        : "site";
    const filename = buildExportFilename(reportType, siteName, format);
    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof Error && error.message === "PDF_FONT_MISSING") {
      next(new HttpError(500, "PDF oluşturulamadı. Lütfen tekrar deneyin."));
      return;
    }
    next(error);
  }
}
