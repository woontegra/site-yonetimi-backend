import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function requiredMoney(requiredMessage: string) {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number({ required_error: requiredMessage, invalid_type_error: "Tutar sayısal olmalıdır." }).gt(0, "Tutar 0'dan büyük olmalıdır."));
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

export const createDuesDefinitionSchema = z.object({
  buildingId: z
    .string({ required_error: "Bina seçimi zorunludur." })
    .trim()
    .min(1, "Bina seçimi zorunludur.")
    .uuid("Bina seçimi zorunludur."),
  name: z
    .string({ required_error: "Aidat adı zorunludur." })
    .trim()
    .min(1, "Aidat adı zorunludur."),
  amount: requiredMoney("Tutar zorunludur."),
  periodYear: z.coerce
    .number({ required_error: "Yıl zorunludur.", invalid_type_error: "Yıl zorunludur." })
    .int("Yıl geçerli olmalıdır.")
    .min(2000, "Yıl geçerli olmalıdır.")
    .max(2100, "Yıl geçerli olmalıdır."),
  periodMonth: z.coerce
    .number({ required_error: "Ay zorunludur.", invalid_type_error: "Ay zorunludur." })
    .int("Ay geçerli olmalıdır.")
    .min(1, "Ay 1–12 arasında olmalıdır.")
    .max(12, "Ay 1–12 arasında olmalıdır."),
  dueDate: z.coerce.date({
    required_error: "Son ödeme tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
  description: optionalText(),
});

export const updateDuesDefinitionSchema = z.object({
  buildingId: z.string().uuid("Bina seçimi zorunludur.").optional(),
  name: z.string().trim().min(1, "Aidat adı zorunludur.").optional(),
  amount: z.coerce.number().gt(0, "Tutar 0'dan büyük olmalıdır.").optional(),
  periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
  dueDate: optionalDate(),
  description: optionalText(),
  isActive: z.boolean().optional(),
});

export const listDuesDefinitionsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  buildingId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  periodYear: z.coerce.number().int().optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
  status: z.enum(["aktif", "pasif"]).optional(),
});

export type CreateDuesDefinitionInput = z.infer<typeof createDuesDefinitionSchema>;
export type UpdateDuesDefinitionInput = z.infer<typeof updateDuesDefinitionSchema>;
export type ListDuesDefinitionsQuery = z.infer<typeof listDuesDefinitionsQuerySchema>;
