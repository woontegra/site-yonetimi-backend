import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** Boş string / null → null (alanı temizle); undefined → dokunma. */
function nullableOptionalText() {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    });
}

function optionalBoolean() {
  return z
    .union([z.boolean(), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value));
}

function optionalSquareMeters() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce
    .number({ invalid_type_error: "Metrekare sayısal olmalıdır." })
    .gt(0, "Metrekare 0'dan büyük olmalıdır.")
    .optional());
}

export const createApartmentSchema = z.object({
  buildingId: z
    .string({ required_error: "Bina seçimi zorunludur." })
    .trim()
    .min(1, "Bina seçimi zorunludur.")
    .uuid("Bina seçimi zorunludur."),
  number: z
    .string({ required_error: "Daire numarası zorunludur." })
    .trim()
    .min(1, "Daire numarası zorunludur."),
  floor: nullableOptionalText(),
  roomType: nullableOptionalText(),
  squareMeters: optionalSquareMeters(),
  hasBalcony: optionalBoolean(),
  description: optionalText(),
  isActive: z.boolean().optional(),
});

export const updateApartmentSchema = z.object({
  buildingId: z.string().uuid("Bina seçimi zorunludur.").optional(),
  number: z.string().trim().min(1, "Daire numarası zorunludur.").optional(),
  floor: nullableOptionalText(),
  roomType: nullableOptionalText(),
  squareMeters: optionalSquareMeters(),
  hasBalcony: optionalBoolean(),
  description: optionalText(),
  isActive: z.boolean().optional(),
});

export const listApartmentsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  buildingId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  floor: z.string().trim().optional().transform((value) => value || undefined),
  roomType: z.string().trim().optional().transform((value) => value || undefined),
  status: z.enum(["aktif", "pasif"]).optional(),
});

export type CreateApartmentInput = z.infer<typeof createApartmentSchema>;
export type UpdateApartmentInput = z.infer<typeof updateApartmentSchema>;
export type ListApartmentsQuery = z.infer<typeof listApartmentsQuerySchema>;
