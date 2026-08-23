import { z } from "zod";

function optionalText(max = 200) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
}

function nullableText(max = 200) {
  return z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(max), z.null()]).optional(),
  );
}

function optionalMoney() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return value;
  }, z.coerce.number({ invalid_type_error: "Tutar sayısal olmalıdır." }).min(0, "Tutar negatif olamaz.").optional());
}

function nullableMoney() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === null) return null;
    return value;
  }, z.union([z.coerce.number().min(0, "Tutar negatif olamaz."), z.null()]).optional());
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

function nullableDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === null) return null;
    return value;
  }, z.union([z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }), z.null()]).optional());
}

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  );
}

function nullableUuid() {
  return z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  );
}

export const assetStatusEnum = z.enum([
  "ACTIVE",
  "IN_MAINTENANCE",
  "OUT_OF_SERVICE",
  "LOST",
  "SCRAPPED",
  "DISPOSED",
]);

export const listAssetCategoriesQuerySchema = z.object({
  search: z.string().trim().optional().transform((v) => v || undefined),
  status: z.enum(["aktif", "pasif", "hepsi"]).optional().default("hepsi"),
});

export const createAssetCategorySchema = z.object({
  name: z
    .string({ required_error: "Kategori adı zorunludur." })
    .trim()
    .min(1, "Kategori adı zorunludur.")
    .max(100, "Kategori adı en fazla 100 karakter olabilir."),
  description: optionalText(500),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const updateAssetCategorySchema = z.object({
  name: z.string().trim().min(1, "Kategori adı zorunludur.").max(100).optional(),
  description: nullableText(500),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const listAssetsQuerySchema = z.object({
  search: z.string().trim().optional().transform((v) => v || undefined),
  categoryId: optionalUuid(),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
  status: assetStatusEnum.optional(),
  upcomingMaintenanceDays: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(365).optional(),
  ),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const createAssetSchema = z.object({
  name: z
    .string({ required_error: "Demirbaş adı zorunludur." })
    .trim()
    .min(1, "Demirbaş adı zorunludur.")
    .max(200, "Demirbaş adı en fazla 200 karakter olabilir."),
  code: optionalText(60),
  assetCategoryId: optionalUuid(),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
  quantity: z.coerce
    .number({ required_error: "Adet zorunludur.", invalid_type_error: "Adet sayısal olmalıdır." })
    .int("Adet tam sayı olmalıdır.")
    .min(1, "Adet en az 1 olmalıdır.")
    .default(1),
  unit: optionalText(40),
  purchaseDate: optionalDate(),
  purchasePrice: optionalMoney(),
  currentValue: optionalMoney(),
  supplierName: optionalText(200),
  location: optionalText(200),
  brand: optionalText(120),
  model: optionalText(120),
  serialNumber: optionalText(120),
  warrantyEndDate: optionalDate(),
  status: assetStatusEnum.optional().default("ACTIVE"),
  description: optionalText(2000),
});

export const updateAssetSchema = z.object({
  name: z.string().trim().min(1, "Demirbaş adı zorunludur.").max(200).optional(),
  code: nullableText(60),
  assetCategoryId: nullableUuid(),
  buildingId: nullableUuid(),
  apartmentId: nullableUuid(),
  quantity: z.coerce.number().int().min(1, "Adet en az 1 olmalıdır.").optional(),
  unit: nullableText(40),
  purchaseDate: nullableDate(),
  purchasePrice: nullableMoney(),
  currentValue: nullableMoney(),
  supplierName: nullableText(200),
  location: nullableText(200),
  brand: nullableText(120),
  model: nullableText(120),
  serialNumber: nullableText(120),
  warrantyEndDate: nullableDate(),
  status: assetStatusEnum.optional(),
  description: nullableText(2000),
  note: optionalText(1000),
});

export const changeAssetStatusSchema = z.object({
  status: assetStatusEnum,
  note: optionalText(1000),
});

export const changeAssetLocationSchema = z.object({
  buildingId: nullableUuid(),
  location: nullableText(200),
  note: optionalText(1000),
});

export const listAssetMaintenancesQuerySchema = z.object({
  type: z.string().trim().max(100).optional().transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export const createAssetMaintenanceSchema = z.object({
  type: z
    .string({ required_error: "Bakım türü zorunludur." })
    .trim()
    .min(1, "Bakım türü zorunludur.")
    .max(100, "Bakım türü en fazla 100 karakter olabilir."),
  maintenanceDate: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.date({
      required_error: "Bakım tarihi zorunludur.",
      invalid_type_error: "Geçerli bir tarih girin.",
    }),
  ),
  description: z
    .string({ required_error: "Açıklama zorunludur." })
    .trim()
    .min(1, "Açıklama zorunludur.")
    .max(2000, "Açıklama en fazla 2000 karakter olabilir."),
  cost: optionalMoney(),
  performedBy: optionalText(200),
  nextMaintenanceDate: optionalDate(),
  note: optionalText(1000),
});

export const updateAssetMaintenanceSchema = z.object({
  type: z.string().trim().min(1, "Bakım türü zorunludur.").max(100).optional(),
  maintenanceDate: optionalDate(),
  description: z.string().trim().min(1, "Açıklama zorunludur.").max(2000).optional(),
  cost: nullableMoney(),
  performedBy: nullableText(200),
  nextMaintenanceDate: nullableDate(),
  note: nullableText(1000),
});

export type ListAssetCategoriesQuery = z.infer<typeof listAssetCategoriesQuerySchema>;
export type CreateAssetCategoryInput = z.infer<typeof createAssetCategorySchema>;
export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategorySchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type ChangeAssetStatusInput = z.infer<typeof changeAssetStatusSchema>;
export type ChangeAssetLocationInput = z.infer<typeof changeAssetLocationSchema>;
export type ListAssetMaintenancesQuery = z.infer<typeof listAssetMaintenancesQuerySchema>;
export type CreateAssetMaintenanceInput = z.infer<typeof createAssetMaintenanceSchema>;
export type UpdateAssetMaintenanceInput = z.infer<typeof updateAssetMaintenanceSchema>;
