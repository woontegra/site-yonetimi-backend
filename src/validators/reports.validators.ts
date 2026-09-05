import { z } from "zod";
import { HttpError } from "../utils/httpError";

export const MAX_EXPORT_ROWS = 5000;

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().uuid().optional(),
  );
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

function optionalBool() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
  }, z.boolean().optional());
}

/** dateTo dahil olsun diye gün sonuna çeker. */
export function normalizeReportDateRange(dateFrom?: Date, dateTo?: Date): {
  dateFrom?: Date;
  dateTo?: Date;
} {
  const from = dateFrom ? new Date(dateFrom) : undefined;
  const to = dateTo ? new Date(dateTo) : undefined;
  if (from) from.setHours(0, 0, 0, 0);
  if (to) to.setHours(23, 59, 59, 999);
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, "Başlangıç tarihi bitiş tarihinden sonra olamaz.");
  }
  return { dateFrom: from, dateTo: to };
}

export const reportTypeSchema = z.enum([
  "financial-summary",
  "apartment-debts",
  "payments",
  "expenses",
  "bank-transactions",
  "apartment-statement",
]);

export type ReportType = z.infer<typeof reportTypeSchema>;

export const reportCommonQuerySchema = z.object({
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
});

export const apartmentDebtsReportQuerySchema = reportCommonQuerySchema.extend({
  debtFilter: z.enum(["all", "with_debt", "overdue", "closed"]).optional().default("all"),
});

export const paymentsReportQuerySchema = reportCommonQuerySchema.extend({
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]).optional(),
  includeCancelled: optionalBool(),
});

export const expensesReportQuerySchema = reportCommonQuerySchema.extend({
  expenseTypeId: optionalUuid(),
  supplierId: optionalUuid(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]).optional(),
  status: z.enum(["COMPLETED", "CANCELLED"]).optional(),
});

export const bankTransactionsReportQuerySchema = reportCommonQuerySchema.extend({
  bankAccountId: optionalUuid(),
  direction: z.enum(["CREDIT", "DEBIT"]).optional(),
  matchFilter: z
    .enum(["all", "matched", "unmatched", "to_payment", "to_expense", "ignored"])
    .optional()
    .default("all"),
});

export const apartmentStatementReportQuerySchema = z.object({
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  buildingId: z
    .string({ required_error: "Bina seçimi zorunludur." })
    .uuid("Bina seçimi zorunludur."),
  apartmentId: z
    .string({ required_error: "Daire seçimi zorunludur." })
    .uuid("Daire seçimi zorunludur."),
});

export const exportFormatSchema = z.enum(["pdf", "xlsx"]);

export type ReportCommonQuery = z.infer<typeof reportCommonQuerySchema>;
export type ApartmentDebtsReportQuery = z.infer<typeof apartmentDebtsReportQuerySchema>;
export type PaymentsReportQuery = z.infer<typeof paymentsReportQuerySchema>;
export type ExpensesReportQuery = z.infer<typeof expensesReportQuerySchema>;
export type BankTransactionsReportQuery = z.infer<typeof bankTransactionsReportQuerySchema>;
export type ApartmentStatementReportQuery = z.infer<typeof apartmentStatementReportQuerySchema>;
