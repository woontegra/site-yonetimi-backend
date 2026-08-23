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

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  );
}

export const createVisitorSchema = z.object({
  firstName: z
    .string({ required_error: "Ad zorunludur." })
    .trim()
    .min(1, "Ad zorunludur.")
    .max(80),
  lastName: z
    .string({ required_error: "Soyad zorunludur." })
    .trim()
    .min(1, "Soyad zorunludur.")
    .max(80),
  phone: optionalText(),
  nationalId: optionalText(),
  note: optionalText(),
});

export const updateVisitorSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(40), z.null()]).optional(),
  ),
  nationalId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(20), z.null()]).optional(),
  ),
  note: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(2000), z.null()]).optional(),
  ),
});

export const listVisitorsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const createVisitSchema = z.object({
  visitorId: z.string().uuid("Misafir seçimi zorunludur."),
  apartmentId: z.string().uuid("Daire seçimi zorunludur."),
  hostPersonId: optionalUuid(),
  purpose: optionalText(),
  vehiclePlate: optionalText(),
  checkInAt: optionalDate(),
  note: optionalText(),
});

export const updateVisitSchema = z.object({
  hostPersonId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().uuid(), z.null()]).optional(),
  ),
  purpose: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(200), z.null()]).optional(),
  ),
  vehiclePlate: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(30), z.null()]).optional(),
  ),
  checkInAt: z.coerce.date().optional(),
  checkOutAt: z.preprocess((value) => {
    if (value === "" || value === null) return null;
    if (value === undefined) return undefined;
    return value;
  }, z.union([z.coerce.date(), z.null()]).optional()),
  note: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(2000), z.null()]).optional(),
  ),
});

export const listVisitsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  buildingId: optionalUuid(),
  apartmentId: optionalUuid(),
  visitorId: optionalUuid(),
  status: z.enum(["EXPECTED", "INSIDE", "COMPLETED", "CANCELLED"]).optional(),
  statusGroup: z.enum(["active", "history"]).optional(),
  vehiclePlate: z.string().trim().optional().transform((value) => value || undefined),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
});

export type CreateVisitorInput = z.infer<typeof createVisitorSchema>;
export type UpdateVisitorInput = z.infer<typeof updateVisitorSchema>;
export type ListVisitorsQuery = z.infer<typeof listVisitorsQuerySchema>;
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
export type ListVisitsQuery = z.infer<typeof listVisitsQuerySchema>;
