import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function dateYmd() {
  return z
    .string({ required_error: "Tarih zorunludur." })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalıdır.");
}

export const createInterestDecisionSchema = z
  .object({
    name: z
      .string({ required_error: "Karar adı zorunludur." })
      .trim()
      .min(1, "Karar adı zorunludur.")
      .max(200, "Karar adı en fazla 200 karakter olabilir."),
    startDate: dateYmd(),
    endDate: dateYmd(),
    /** Yüzde olarak aylık oran (ör. 5 = %5). */
    monthlyRate: z.preprocess((value) => {
      if (value === "" || value === undefined || value === null) return undefined;
      return value;
    }, z.coerce.number({
      required_error: "Faiz oranı zorunludur.",
      invalid_type_error: "Faiz oranı sayısal olmalıdır.",
    }).gt(0, "Faiz oranı 0'dan büyük olmalıdır.").max(50, "Aylık faiz oranı en fazla %50 olabilir.")),
    ratePeriod: z.enum(["MONTHLY"]).default("MONTHLY"),
    description: optionalText(),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).default("DRAFT"),
  })
  .superRefine((data, ctx) => {
    if (data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
        path: ["endDate"],
      });
    }
  });

export const updateInterestDecisionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    startDate: dateYmd().optional(),
    endDate: dateYmd().optional(),
    monthlyRate: z.coerce
      .number()
      .gt(0, "Faiz oranı 0'dan büyük olmalıdır.")
      .max(50, "Aylık faiz oranı en fazla %50 olabilir.")
      .optional(),
    description: optionalText(),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
        path: ["endDate"],
      });
    }
  });

export const listInterestDecisionsQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const interestPreviewSchema = z
  .object({
    decisionId: z.string().uuid("Faiz kararı seçimi zorunludur."),
    fromYear: z.coerce.number().int().min(2000).max(2100),
    fromMonth: z.coerce.number().int().min(1).max(12),
    toYear: z.coerce.number().int().min(2000).max(2100),
    toMonth: z.coerce.number().int().min(1).max(12),
    buildingId: z.string().uuid().optional(),
    apartmentId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    const from = data.fromYear * 100 + data.fromMonth;
    const to = data.toYear * 100 + data.toMonth;
    if (from > to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Başlangıç dönemi bitiş döneminden sonra olamaz.",
        path: ["toMonth"],
      });
    }
  });

export const interestApplySchema = interestPreviewSchema;

export type CreateInterestDecisionInput = z.infer<typeof createInterestDecisionSchema>;
export type UpdateInterestDecisionInput = z.infer<typeof updateInterestDecisionSchema>;
export type ListInterestDecisionsQuery = z.infer<typeof listInterestDecisionsQuerySchema>;
export type InterestPreviewInput = z.infer<typeof interestPreviewSchema>;
export type InterestApplyInput = z.infer<typeof interestApplySchema>;
