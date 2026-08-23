import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function requiredMoney(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number({ required_error: message, invalid_type_error: "Tutar sayısal olmalıdır." }).gt(0, "Tutar 0'dan büyük olmalıdır."));
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  );
}

export const createExpenseTypeSchema = z.object({
  name: z
    .string({ required_error: "Gider türü adı zorunludur." })
    .trim()
    .min(1, "Gider türü adı zorunludur.")
    .max(100, "Gider türü adı en fazla 100 karakter olabilir."),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const updateExpenseTypeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Gider türü adı zorunludur.")
    .max(100, "Gider türü adı en fazla 100 karakter olabilir.")
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const createExpenseSchema = z.object({
  title: z
    .string({ required_error: "Gider başlığı zorunludur." })
    .trim()
    .min(1, "Gider başlığı zorunludur.")
    .max(200, "Gider başlığı en fazla 200 karakter olabilir."),
  expenseTypeId: z
    .string({ required_error: "Gider türü zorunludur." })
    .uuid("Gider türü zorunludur."),
  amount: requiredMoney("Tutar zorunludur."),
  expenseDate: z.coerce.date({
    required_error: "Gider tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"], {
    required_error: "Ödeme yöntemi zorunludur.",
    invalid_type_error: "Ödeme yöntemi zorunludur.",
  }),
  buildingId: optionalUuid(),
  supplierId: optionalUuid(),
  referenceNo: optionalText(),
  description: optionalText(),
});

export const updateExpenseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Gider başlığı zorunludur.")
    .max(200, "Gider başlığı en fazla 200 karakter olabilir.")
    .optional(),
  expenseTypeId: z.string().uuid().optional(),
  amount: z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number().gt(0, "Tutar 0'dan büyük olmalıdır.").optional()),
  expenseDate: z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]).optional(),
  buildingId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  supplierId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  referenceNo: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(100), z.null()]).optional(),
  ),
  description: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(2000), z.null()]).optional(),
  ),
});

export const listExpensesQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  expenseTypeId: optionalUuid(),
  buildingId: optionalUuid(),
  supplierId: optionalUuid(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]).optional(),
  status: z.enum(["COMPLETED", "CANCELLED"]).optional(),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
});

export const listExpenseTypesQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  activeOnly: z
    .preprocess((value) => value === "true" || value === true, z.boolean())
    .optional()
    .default(false),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type CreateExpenseTypeInput = z.infer<typeof createExpenseTypeSchema>;
export type UpdateExpenseTypeInput = z.infer<typeof updateExpenseTypeSchema>;
export type ListExpenseTypesQuery = z.infer<typeof listExpenseTypesQuerySchema>;
