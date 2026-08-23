import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function requiredMoney(message: string) {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.number({ required_error: message, invalid_type_error: "Tutar sayısal olmalıdır." }).gt(0, "Tutar 0'dan büyük olmalıdır."));
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

const allocationSchema = z.object({
  apartmentDebtId: z.string().uuid("Borç seçimi zorunludur."),
  amount: requiredMoney("Dağıtım tutarı zorunludur."),
});

export const createPaymentSchema = z.object({
  apartmentId: z
    .string({ required_error: "Daire seçimi zorunludur." })
    .trim()
    .min(1, "Daire seçimi zorunludur.")
    .uuid("Daire seçimi zorunludur."),
  personId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  amount: requiredMoney("Ödeme tutarı zorunludur."),
  paymentDate: z.coerce.date({
    required_error: "Ödeme tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"], {
    required_error: "Ödeme yöntemi zorunludur.",
    invalid_type_error: "Ödeme yöntemi zorunludur.",
  }),
  referenceNo: optionalText(),
  description: optionalText(),
  allocations: z.array(allocationSchema).min(1, "En az bir borç dağılımı gerekli."),
});

export const listPaymentsQuerySchema = z.object({
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
  apartmentDebtId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"]).optional(),
  status: z.enum(["COMPLETED", "CANCELLED"]).optional(),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
