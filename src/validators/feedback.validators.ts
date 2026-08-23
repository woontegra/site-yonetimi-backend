import { z } from "zod";

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

function optionalUuid() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return value;
  }, z.string().uuid().optional());
}

function nullableUuid() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === null) return null;
    return value;
  }, z.union([z.string().uuid(), z.null()]).optional());
}

export const feedbackTypeEnum = z.enum(["INFO", "SUGGESTION", "REQUEST", "COMPLAINT"]);
export const feedbackPriorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const feedbackStatusEnum = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export const listFeedbackCategoriesQuerySchema = z.object({
  search: z.string().trim().optional().transform((v) => v || undefined),
  status: z.enum(["aktif", "pasif", "hepsi"]).optional().default("hepsi"),
});

export const createFeedbackCategorySchema = z.object({
  name: z
    .string({ required_error: "Kategori adı zorunludur." })
    .trim()
    .min(1, "Kategori adı zorunludur.")
    .max(100, "Kategori adı en fazla 100 karakter olabilir."),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const updateFeedbackCategorySchema = z.object({
  name: z.string().trim().min(1, "Kategori adı zorunludur.").max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const listFeedbackRecordsQuerySchema = z.object({
  search: z.string().trim().optional().transform((v) => v || undefined),
  type: feedbackTypeEnum.optional(),
  status: feedbackStatusEnum.optional(),
  /** Açık = OPEN+IN_PROGRESS, çözülen = RESOLVED+CLOSED */
  statusGroup: z.enum(["open", "resolved", "all"]).optional(),
  priority: feedbackPriorityEnum.optional(),
  categoryId: optionalUuid(),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
  employeeId: optionalUuid(),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

const feedbackBodyBase = z.object({
  type: feedbackTypeEnum,
  title: z
    .string({ required_error: "Başlık zorunludur." })
    .trim()
    .min(1, "Başlık zorunludur.")
    .max(200, "Başlık en fazla 200 karakter olabilir."),
  description: z
    .string({ required_error: "Açıklama zorunludur." })
    .trim()
    .min(1, "Açıklama zorunludur.")
    .max(10000, "Açıklama en fazla 10000 karakter olabilir."),
  priority: feedbackPriorityEnum.default("NORMAL"),
  categoryId: nullableUuid(),
  buildingId: nullableUuid(),
  apartmentId: nullableUuid(),
  personId: nullableUuid(),
  employeeId: nullableUuid(),
});

export const createFeedbackRecordSchema = feedbackBodyBase;

export const updateFeedbackRecordSchema = z.object({
  type: feedbackTypeEnum.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(10000).optional(),
  priority: feedbackPriorityEnum.optional(),
  categoryId: nullableUuid(),
  buildingId: nullableUuid(),
  apartmentId: nullableUuid(),
  personId: nullableUuid(),
  employeeId: nullableUuid(),
});

export const changeFeedbackStatusSchema = z
  .object({
    status: feedbackStatusEnum,
    note: z
      .string()
      .trim()
      .max(2000, "Not en fazla 2000 karakter olabilir.")
      .optional()
      .transform((v) => v || undefined),
    resolution: z
      .string()
      .trim()
      .max(5000, "Çözüm en fazla 5000 karakter olabilir.")
      .optional()
      .transform((v) => v || undefined),
  })
  .superRefine((data, ctx) => {
    if (data.status === "RESOLVED" && !data.resolution) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Çözüldü durumu için çözüm açıklaması zorunludur.",
        path: ["resolution"],
      });
    }
  });

export type ListFeedbackCategoriesQuery = z.infer<typeof listFeedbackCategoriesQuerySchema>;
export type CreateFeedbackCategoryInput = z.infer<typeof createFeedbackCategorySchema>;
export type UpdateFeedbackCategoryInput = z.infer<typeof updateFeedbackCategorySchema>;
export type ListFeedbackRecordsQuery = z.infer<typeof listFeedbackRecordsQuerySchema>;
export type CreateFeedbackRecordInput = z.infer<typeof createFeedbackRecordSchema>;
export type UpdateFeedbackRecordInput = z.infer<typeof updateFeedbackRecordSchema>;
export type ChangeFeedbackStatusInput = z.infer<typeof changeFeedbackStatusSchema>;
