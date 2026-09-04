import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  );
}

function requiredMoney(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number({ required_error: message, invalid_type_error: "Tutar sayısal olmalıdır." }).gt(0, "Tutar 0'dan büyük olmalıdır."));
}

function optionalMoney() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number().min(0, "Bakiye negatif olamaz.").optional());
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

export const createBankAccountSchema = z.object({
  bankName: z
    .string({ required_error: "Banka adı zorunludur." })
    .trim()
    .min(1, "Banka adı zorunludur.")
    .max(120),
  accountName: z
    .string({ required_error: "Hesap adı zorunludur." })
    .trim()
    .min(1, "Hesap adı zorunludur.")
    .max(120),
  iban: optionalText(),
  accountNumber: optionalText(),
  branchName: optionalText(),
  openingBalance: optionalMoney(),
});

export const updateBankAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(120).optional(),
  accountName: z.string().trim().min(1).max(120).optional(),
  iban: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(34), z.null()]).optional(),
  ),
  accountNumber: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(50), z.null()]).optional(),
  ),
  branchName: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(120), z.null()]).optional(),
  ),
  openingBalance: z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number().min(0).optional()),
  isActive: z.boolean().optional(),
});

export const listBankAccountsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  activeOnly: z
    .preprocess((value) => value === "true" || value === true, z.boolean())
    .optional()
    .default(false),
});

export const createBankTransactionSchema = z.object({
  bankAccountId: z.string().uuid("Banka hesabı zorunludur."),
  transactionDate: z.coerce.date({
    required_error: "Tarih zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
  direction: z.enum(["CREDIT", "DEBIT"], {
    required_error: "Yön zorunludur.",
  }),
  amount: requiredMoney("Tutar zorunludur."),
  description: z
    .string({ required_error: "Açıklama zorunludur." })
    .trim()
    .min(1, "Açıklama zorunludur.")
    .max(500),
  senderName: optionalText(),
  senderIban: optionalText(),
  referenceNo: optionalText(),
});

export const listBankTransactionsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  bankAccountId: optionalUuid(),
  direction: z.enum(["CREDIT", "DEBIT"]).optional(),
  matchStatus: z.enum(["UNMATCHED", "SUGGESTED", "MATCHED", "PROCESSED"]).optional(),
  debitClass: z.enum(["UNCLASSIFIED", "EXPENSE", "EXCLUDED"]).optional(),
  status: z.enum(["ACTIVE", "IGNORED"]).optional(),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
});

export const classifyBankDebitSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("EXCLUDE"),
  }),
  z.object({
    action: z.literal("RESET"),
  }),
  z.object({
    action: z.literal("CREATE_EXPENSE"),
    title: z
      .string({ required_error: "Gider başlığı zorunludur." })
      .trim()
      .min(1, "Gider başlığı zorunludur.")
      .max(200),
    expenseTypeId: z.string().uuid("Gider türü zorunludur."),
    expenseDate: z.coerce.date({
      required_error: "Gider tarihi zorunludur.",
      invalid_type_error: "Geçerli bir tarih girin.",
    }),
    paymentMethod: z
      .enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"])
      .optional()
      .default("BANK_TRANSFER"),
    buildingId: optionalUuid(),
    supplierId: optionalUuid(),
    referenceNo: optionalText(),
    description: optionalText(),
  }),
]);

export const matchBankTransactionSchema = z.object({
  apartmentId: z.string().uuid("Daire seçimi zorunludur."),
  personId: optionalUuid(),
  createRule: z.boolean().optional().default(false),
  ruleName: optionalText(),
  containsText: optionalText(),
});

export const processBankTransactionSchema = z.object({
  personId: optionalUuid(),
  allocations: z
    .array(
      z.object({
        apartmentDebtId: z.string().uuid(),
        amount: requiredMoney("Dağıtım tutarı zorunludur."),
      }),
    )
    .min(1, "En az bir borç dağılımı gerekli."),
});

export const processBankTransactionAutoSchema = z.object({
  personId: optionalUuid(),
});

export const bankTransactionIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "En az bir hareket seçin.").max(100),
});

export const processBankTransactionBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "En az bir hareket seçin.").max(100),
  /** Riskli eşleşmeleri de işle (varsayılan: hayır). */
  includeRisky: z.boolean().optional().default(false),
  /**
   * PERIOD_CONFLICT grupları:
   * SKIP — toplu onaya alma (varsayılan)
   * SEQUENTIAL — işlem tarihine göre sırayla dağıt
   */
  resolvePeriodConflicts: z.enum(["SKIP", "SEQUENTIAL"]).optional().default("SKIP"),
  allocationOverrides: z
    .array(
      z.object({
        transactionId: z.string().uuid(),
        allocations: z
          .array(
            z.object({
              apartmentDebtId: z.string().uuid(),
              amount: z.number().positive("Allocation tutarı pozitif olmalıdır."),
            }),
          )
          .min(1),
      }),
    )
    .optional(),
});

export const createBankMatchingRuleSchema = z.object({
  bankAccountId: optionalUuid(),
  name: z
    .string({ required_error: "Kural adı zorunludur." })
    .trim()
    .min(1, "Kural adı zorunludur.")
    .max(120),
  containsText: z
    .string({ required_error: "Eşleşme ifadesi zorunludur." })
    .trim()
    .min(1, "Eşleşme ifadesi zorunludur.")
    .max(120),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
  personId: optionalUuid(),
  priority: z.coerce.number().int().min(1).max(1000).optional(),
});

export const updateBankMatchingRuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  containsText: z.string().trim().min(1).max(120).optional(),
  buildingId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  apartmentId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  personId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  priority: z.coerce.number().int().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const listBankMatchingRulesQuerySchema = z.object({
  bankAccountId: optionalUuid(),
  activeOnly: z
    .preprocess((value) => value === "true" || value === true, z.boolean())
    .optional()
    .default(false),
});

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;
export type ListBankAccountsQuery = z.infer<typeof listBankAccountsQuerySchema>;
export type CreateBankTransactionInput = z.infer<typeof createBankTransactionSchema>;
export type ListBankTransactionsQuery = z.infer<typeof listBankTransactionsQuerySchema>;
export type MatchBankTransactionInput = z.infer<typeof matchBankTransactionSchema>;
export type ProcessBankTransactionInput = z.infer<typeof processBankTransactionSchema>;
export type ProcessBankTransactionAutoInput = z.infer<typeof processBankTransactionAutoSchema>;
export type ProcessBankTransactionBatchInput = z.infer<typeof processBankTransactionBatchSchema>;
export type ClassifyBankDebitInput = z.infer<typeof classifyBankDebitSchema>;
export type CreateBankMatchingRuleInput = z.infer<typeof createBankMatchingRuleSchema>;
export type UpdateBankMatchingRuleInput = z.infer<typeof updateBankMatchingRuleSchema>;
export type ListBankMatchingRulesQuery = z.infer<typeof listBankMatchingRulesQuerySchema>;
