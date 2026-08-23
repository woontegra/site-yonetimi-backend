import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** PATCH ile özel adresi temizlemek için null kabul eder. */
function nullableText() {
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

/** Boş bırakılabilir; girilmişse pozitif tam sayı olmalı. null = temizle. */
function optionalPositiveInt(gtMessage: string, intMessage: string) {
  return z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === null) return null;
    return value;
  }, z.union([
    z.null(),
    z.coerce
      .number({ invalid_type_error: intMessage })
      .int(intMessage)
      .gt(0, gtMessage),
  ]).optional());
}

export const createBuildingSchema = z.object({
  name: z
    .string({ required_error: "Bina adı zorunludur." })
    .trim()
    .min(1, "Bina adı zorunludur."),
  code: optionalText(),
  address: optionalText(),
  city: optionalText(),
  district: optionalText(),
  description: optionalText(),
  apartmentCount: optionalPositiveInt(
    "Daire sayısı 0'dan büyük olmalıdır.",
    "Daire sayısı tam sayı olmalıdır.",
  ),
  floorCount: optionalPositiveInt(
    "Kat sayısı 0'dan büyük olmalıdır.",
    "Kat sayısı tam sayı olmalıdır.",
  ),
});

export const updateBuildingSchema = z.object({
  name: z.string().trim().min(1, "Bina adı zorunludur.").optional(),
  code: optionalText(),
  address: nullableText(),
  city: nullableText(),
  district: nullableText(),
  description: optionalText(),
  apartmentCount: optionalPositiveInt(
    "Daire sayısı 0'dan büyük olmalıdır.",
    "Daire sayısı tam sayı olmalıdır.",
  ),
  floorCount: optionalPositiveInt(
    "Kat sayısı 0'dan büyük olmalıdır.",
    "Kat sayısı tam sayı olmalıdır.",
  ),
  isActive: z.boolean().optional(),
});

export const listBuildingsQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["aktif", "pasif"]).optional(),
});

export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingSchema>;
export type ListBuildingsQuery = z.infer<typeof listBuildingsQuerySchema>;
