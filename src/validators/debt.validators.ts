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

export const createApartmentDebtSchema = z.object({
  buildingId: z
    .string({ required_error: "Bina seçimi zorunludur." })
    .trim()
    .min(1, "Bina seçimi zorunludur.")
    .uuid("Bina seçimi zorunludur."),
  apartmentId: z
    .string({ required_error: "Daire seçimi zorunludur." })
    .trim()
    .min(1, "Daire seçimi zorunludur.")
    .uuid("Daire seçimi zorunludur."),
  title: z
    .string({ required_error: "Borç başlığı zorunludur." })
    .trim()
    .min(1, "Borç başlığı zorunludur."),
  amount: requiredMoney("Tutar zorunludur."),
  dueDate: z.coerce.date({
    required_error: "Son ödeme tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
  description: optionalText(),
  periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
});

export const updateApartmentDebtSchema = z.object({
  title: z.string().trim().min(1, "Borç başlığı zorunludur.").optional(),
  dueDate: optionalDate(),
  description: optionalText(),
  amount: z.coerce.number().gt(0, "Tutar 0'dan büyük olmalıdır.").optional(),
});

export const listApartmentDebtsQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  buildingId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  apartmentId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  duesDefinitionId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  type: z.enum(["DUES", "MANUAL", "INTEREST"]).optional(),
  status: z.enum(["OPEN", "PAID", "CANCELLED"]).optional(),
  periodYear: z.coerce.number().int().optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
  dueFrom: optionalDate(),
  dueTo: optionalDate(),
});

export type CreateApartmentDebtInput = z.infer<typeof createApartmentDebtSchema>;
export type UpdateApartmentDebtInput = z.infer<typeof updateApartmentDebtSchema>;
export type ListApartmentDebtsQuery = z.infer<typeof listApartmentDebtsQuerySchema>;
