import { z } from "zod";

export const whatsAppConnectSchema = z.object({
  wabaId: z
    .string({ required_error: "WABA ID zorunludur." })
    .trim()
    .min(1, "WABA ID zorunludur."),
  phoneNumberId: z
    .string({ required_error: "Telefon numarası ID zorunludur." })
    .trim()
    .min(1, "Telefon numarası ID zorunludur."),
  accessToken: z
    .string({ required_error: "Erişim anahtarı zorunludur." })
    .trim()
    .min(1, "Erişim anahtarı zorunludur."),
});

export const whatsAppTemplateStatusSchema = z.enum([
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "UNKNOWN",
]);

export const listWhatsAppTemplatesQuerySchema = z.object({
  status: whatsAppTemplateStatusSchema.optional(),
  language: z.string().trim().optional(),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
});

export type WhatsAppConnectInput = z.infer<typeof whatsAppConnectSchema>;
export type ListWhatsAppTemplatesQuery = z.infer<typeof listWhatsAppTemplatesQuerySchema>;

const parameterMappingSchema = z.record(
  z.string().regex(/^\d+$/, "Değişken anahtarı sayı olmalıdır."),
  z.enum([
    "adSoyad",
    "siteAdi",
    "binaAdi",
    "daireNo",
    "borcTutari",
    "vadeTarihi",
    "borcAciklamasi",
  ]),
);

export const createFromLibrarySchema = z.object({
  libraryKey: z
    .string({ required_error: "Kütüphane anahtarı zorunludur." })
    .trim()
    .min(1, "Kütüphane anahtarı zorunludur."),
});

export const createCustomTemplateSchema = z.object({
  displayName: z
    .string({ required_error: "Görünen ad zorunludur." })
    .trim()
    .min(1, "Görünen ad zorunludur.")
    .max(120, "Görünen ad en fazla 120 karakter olabilir."),
  name: z.string().trim().min(1).max(512).optional(),
  language: z
    .string({ required_error: "Dil kodu zorunludur." })
    .trim()
    .min(2, "Dil kodu zorunludur.")
    .max(10),
  category: z
    .string({ required_error: "Kategori zorunludur." })
    .trim()
    .min(1, "Kategori zorunludur."),
  bodyText: z
    .string({ required_error: "Şablon metni zorunludur." })
    .trim()
    .min(1, "Şablon metni zorunludur."),
  parameterMapping: parameterMappingSchema,
});

export const updateDraftTemplateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(512).optional(),
    language: z.string().trim().min(2).max(10).optional(),
    category: z.string().trim().min(1).optional(),
    bodyText: z.string().trim().min(1).optional(),
    parameterMapping: parameterMappingSchema.optional(),
  })
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.name !== undefined ||
      data.language !== undefined ||
      data.category !== undefined ||
      data.bodyText !== undefined ||
      data.parameterMapping !== undefined,
    { message: "Güncellenecek en az bir alan belirtin." },
  );

export const templateIdParamSchema = z.object({
  id: z.string().uuid("Geçersiz şablon kimliği."),
});

export type CreateFromLibraryInput = z.infer<typeof createFromLibrarySchema>;
export type CreateCustomTemplateInput = z.infer<typeof createCustomTemplateSchema>;
export type UpdateDraftTemplateInput = z.infer<typeof updateDraftTemplateSchema>;
