import { z } from "zod";

const moneyPositive = z.coerce.number().gt(0, "Tutar 0'dan büyük olmalıdır.");

const statementRowSchema = z.object({
  transactionDate: z.string().min(8, "İşlem tarihi zorunludur."),
  valueDate: z.string().optional().nullable(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: moneyPositive,
  description: z.string().trim().min(1, "Açıklama zorunludur."),
  referenceNo: z.string().trim().optional().nullable(),
  balanceAfter: z.coerce.number().optional().nullable(),
  sourceRowNumber: z.coerce.number().int().optional(),
  sourcePage: z.coerce.number().int().optional().nullable(),
});

export const bankStatementPreviewSchema = z.object({
  bankAccountId: z.string().uuid("Banka hesabı seçimi zorunludur."),
  rows: z.array(statementRowSchema).min(1, "En az bir satır gerekli.").max(5000),
});

export const bankStatementCommitRowSchema = statementRowSchema.extend({
  fingerprint: z.string().optional(),
  matchedApartmentId: z.string().uuid().optional().nullable(),
  matchedPersonId: z.string().uuid().optional().nullable(),
  processPayment: z.boolean().optional(),
  createRule: z.boolean().optional(),
  containsText: z.string().trim().optional().nullable(),
  ruleName: z.string().trim().optional().nullable(),
  skip: z.boolean().optional(),
});

export const bankStatementCommitSchema = z.object({
  bankAccountId: z.string().uuid("Banka hesabı seçimi zorunludur."),
  rows: z.array(bankStatementCommitRowSchema).min(1).max(5000),
});

const mappingSchema = z
  .object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().optional().nullable(),
    debit: z.string().optional().nullable(),
    credit: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    balance: z.string().optional().nullable(),
    valueDate: z.string().optional().nullable(),
  })
  .refine((value) => Boolean(value.amount || value.debit || value.credit), {
    message: "Tutar veya borç/alacak kolonlarından en az biri gerekli.",
  });

export const createBankColumnTemplateSchema = z.object({
  name: z.string().trim().min(1, "Şablon adı zorunludur."),
  bankAccountId: z.string().uuid().optional().nullable(),
  mapping: mappingSchema,
});

export const updateBankColumnTemplateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  bankAccountId: z.string().uuid().optional().nullable(),
  mapping: mappingSchema.optional(),
});

export type BankStatementPreviewInput = z.infer<typeof bankStatementPreviewSchema>;
export type BankStatementCommitInput = z.infer<typeof bankStatementCommitSchema>;
export type CreateBankColumnTemplateInput = z.infer<typeof createBankColumnTemplateSchema>;
export type UpdateBankColumnTemplateInput = z.infer<typeof updateBankColumnTemplateSchema>;
