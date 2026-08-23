import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

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

const setupStatusEnum = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]);

export const updateSetupStatusSchema = z.object({
  status: setupStatusEnum,
});

const bulkBuildingItemSchema = z.object({
  name: z
    .string({ required_error: "Bina adı zorunludur." })
    .trim()
    .min(1, "Bina adı zorunludur."),
  code: z.union([z.string(), z.null()]).optional().transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }),
  apartmentNumbers: z.array(z.string().trim().min(1)).optional(),
});

export const bulkBuildingsSchema = z.object({
  buildings: z.array(bulkBuildingItemSchema).min(1, "En az bir bina girilmelidir."),
});

const bulkApartmentItemSchema = z.object({
  number: z
    .string({ required_error: "Daire numarası zorunludur." })
    .trim()
    .min(1, "Daire numarası zorunludur."),
  floor: nullableText(),
  roomType: nullableText(),
});

export const bulkApartmentsSchema = z.object({
  buildingId: z.string().uuid("Geçerli bir bina seçin."),
  apartments: z
    .array(bulkApartmentItemSchema)
    .min(1, "En az bir daire girilmelidir.")
    .max(500, "Tek seferde en fazla 500 daire eklenebilir."),
});

const assignPersonSchema = z.object({
  firstName: z
    .string({ required_error: "Ad zorunludur." })
    .trim()
    .min(1, "Ad zorunludur."),
  lastName: z
    .string({ required_error: "Soyad zorunludur." })
    .trim()
    .min(1, "Soyad zorunludur."),
  phone: optionalText(),
  email: optionalText(),
});

export const assignResidentSchema = z
  .object({
    apartmentId: z.string().uuid("Geçerli bir daire seçin."),
    relationType: z.enum(["OWNER", "TENANT"]),
    personId: z.string().uuid().optional(),
    person: assignPersonSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((data) => data.personId || data.person, {
    message: "Kişi seçilmeli veya yeni kişi bilgisi girilmelidir.",
  });

export const importRowSchema = z.object({
  buildingName: z.string().trim(),
  apartmentNumber: z.string().trim(),
  floor: nullableText(),
  roomType: nullableText(),
  ownerFirstName: optionalText(),
  ownerLastName: optionalText(),
  ownerPhone: optionalText(),
  tenantFirstName: optionalText(),
  tenantLastName: optionalText(),
  tenantPhone: optionalText(),
});

export const importPreviewSchema = z.object({
  rows: z.array(importRowSchema).max(1000, "Önizleme en fazla 1000 satır destekler."),
});

const importCommitRowsSchema = z.object({
  rows: z.array(importRowSchema).max(500, "İçe aktarma en fazla 500 satır destekler."),
});

export const importCommitSchema = z.union([
  importCommitRowsSchema,
  importCommitRowsSchema.extend({
    confirmed: z.literal(true),
  }),
]);

/** Sakinler adımı — mevcut dairelere OWNER/TENANT aktarımı (bina/daire oluşturmaz). */
export const residentImportRowSchema = z.object({
  buildingName: optionalText(),
  apartmentNumber: z.string().trim(),
  ownerFirstName: optionalText(),
  ownerLastName: optionalText(),
  ownerPhone: optionalText(),
  ownerEmail: optionalText(),
  tenantFirstName: optionalText(),
  tenantLastName: optionalText(),
  tenantPhone: optionalText(),
  tenantEmail: optionalText(),
});

export const residentImportPreviewSchema = z.object({
  rows: z
    .array(residentImportRowSchema)
    .max(1000, "Önizleme en fazla 1000 satır destekler."),
});

const residentImportCommitRowsSchema = z.object({
  rows: z
    .array(residentImportRowSchema)
    .max(500, "Tek seferde en fazla 500 kayıt aktarabilirsiniz."),
});

export const residentImportCommitSchema = z.union([
  residentImportCommitRowsSchema,
  residentImportCommitRowsSchema.extend({
    confirmed: z.literal(true),
  }),
]);

export type UpdateSetupStatusInput = z.infer<typeof updateSetupStatusSchema>;
export type BulkBuildingsInput = z.infer<typeof bulkBuildingsSchema>;
export type BulkApartmentsInput = z.infer<typeof bulkApartmentsSchema>;
export type AssignResidentInput = z.infer<typeof assignResidentSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
export type ResidentImportRowInput = z.infer<typeof residentImportRowSchema>;
export type ResidentImportPreviewInput = z.infer<typeof residentImportPreviewSchema>;
export type ResidentImportCommitInput = z.infer<typeof residentImportCommitSchema>;
