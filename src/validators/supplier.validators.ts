import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

export const createSupplierSchema = z.object({
  name: z
    .string({ required_error: "Tedarikçi adı zorunludur." })
    .trim()
    .min(1, "Tedarikçi adı zorunludur.")
    .max(200, "Tedarikçi adı en fazla 200 karakter olabilir."),
  contactPerson: optionalText(),
  phone: optionalText(),
  email: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().email("Geçerli bir e-posta girin.").optional(),
  ),
  taxNumber: optionalText(),
  taxOffice: optionalText(),
  city: optionalText(),
  district: optionalText(),
  address: optionalText(),
  note: optionalText(),
});

export const updateSupplierSchema = z.object({
  name: z.string().trim().min(1, "Tedarikçi adı zorunludur.").max(200).optional(),
  contactPerson: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(120), z.null()]).optional(),
  ),
  phone: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(40), z.null()]).optional(),
  ),
  email: z.preprocess((value) => {
    if (value === "" || value === null) return null;
    return value;
  }, z.union([z.string().trim().email("Geçerli bir e-posta girin."), z.null()]).optional()),
  taxNumber: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(40), z.null()]).optional(),
  ),
  taxOffice: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(120), z.null()]).optional(),
  ),
  city: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(80), z.null()]).optional(),
  ),
  district: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(80), z.null()]).optional(),
  ),
  address: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(500), z.null()]).optional(),
  ),
  note: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(2000), z.null()]).optional(),
  ),
  isActive: z.boolean().optional(),
});

export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["aktif", "pasif"]).optional(),
  city: z.string().trim().optional().transform((value) => value || undefined),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
