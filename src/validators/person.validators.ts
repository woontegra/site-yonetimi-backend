import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function optionalEmail() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.string().trim().email("Geçerli bir e-posta girin.").optional());
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

export const createPersonSchema = z.object({
  firstName: z
    .string({ required_error: "Ad zorunludur." })
    .trim()
    .min(1, "Ad zorunludur."),
  lastName: z
    .string({ required_error: "Soyad zorunludur." })
    .trim()
    .min(1, "Soyad zorunludur."),
  phone: optionalText(),
  email: optionalEmail(),
  nationalId: optionalText(),
  gender: optionalText(),
  occupation: optionalText(),
  birthDate: optionalDate(),
  note: optionalText(),
  isActive: z.boolean().optional(),
});

export const updatePersonSchema = z.object({
  firstName: z.string().trim().min(1, "Ad zorunludur.").optional(),
  lastName: z.string().trim().min(1, "Soyad zorunludur.").optional(),
  phone: optionalText(),
  email: optionalEmail(),
  nationalId: optionalText(),
  gender: optionalText(),
  occupation: optionalText(),
  birthDate: optionalDate(),
  note: optionalText(),
  isActive: z.boolean().optional(),
});

export const listPersonsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["aktif", "pasif"]).optional(),
  relationType: z.enum(["OWNER", "TENANT"]).optional(),
  buildingId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  apartmentId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
});

export const createPersonWithRelationSchema = createPersonSchema
  .extend({
    apartmentId: z.string().uuid().optional(),
    relationType: z.enum(["OWNER", "TENANT"]).optional(),
  })
  .refine((data) => !data.apartmentId || data.relationType, {
    message: "İlişki türü zorunludur.",
  });

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type CreatePersonWithRelationInput = z.infer<typeof createPersonWithRelationSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type ListPersonsQuery = z.infer<typeof listPersonsQuerySchema>;
