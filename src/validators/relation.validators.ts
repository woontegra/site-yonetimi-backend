import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

export const createRelationSchema = z.object({
  apartmentId: z
    .string({ required_error: "Daire seçimi zorunludur." })
    .trim()
    .min(1, "Daire seçimi zorunludur.")
    .uuid("Daire seçimi zorunludur."),
  personId: z
    .string({ required_error: "Kişi seçimi zorunludur." })
    .trim()
    .min(1, "Kişi seçimi zorunludur.")
    .uuid("Kişi seçimi zorunludur."),
  relationType: z.enum(["OWNER", "TENANT"], {
    required_error: "İlişki türü zorunludur.",
    invalid_type_error: "İlişki türü zorunludur.",
  }),
  startDate: optionalDate(),
  endDate: optionalDate(),
  isPrimary: z.boolean().optional(),
  note: optionalText(),
});

export const updateRelationSchema = z.object({
  relationType: z.enum(["OWNER", "TENANT"]).optional(),
  startDate: optionalDate(),
  endDate: optionalDate(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  note: optionalText(),
});

export const endRelationSchema = z.object({
  endDate: optionalDate(),
});

export const listRelationsQuerySchema = z.object({
  apartmentId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  personId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  relationType: z.enum(["OWNER", "TENANT"]).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateRelationInput = z.infer<typeof createRelationSchema>;
export type UpdateRelationInput = z.infer<typeof updateRelationSchema>;
export type EndRelationInput = z.infer<typeof endRelationSchema>;
export type ListRelationsQuery = z.infer<typeof listRelationsQuerySchema>;
