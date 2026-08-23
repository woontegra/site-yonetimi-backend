import { z } from "zod";

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

const uuidList = z.array(z.string().uuid()).default([]);

/** Prisma AnnouncementAudienceType */
export const announcementAudienceEnum = z.enum(["ALL_SITE", "BUILDINGS", "APARTMENTS"]);
/** Prisma AnnouncementPriority */
export const announcementPriorityEnum = z.enum(["NORMAL", "IMPORTANT", "URGENT"]);
/** Prisma AnnouncementStatus */
export const announcementStatusEnum = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "CANCELLED"]);

export const listAnnouncementsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  status: announcementStatusEnum.optional(),
  priority: announcementPriorityEnum.optional(),
  audienceType: announcementAudienceEnum.optional(),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

const announcementBodyBase = z.object({
  title: z
    .string({ required_error: "Başlık zorunludur." })
    .trim()
    .min(1, "Başlık zorunludur.")
    .max(200, "Başlık en fazla 200 karakter olabilir."),
  content: z
    .string({ required_error: "İçerik zorunludur." })
    .trim()
    .min(1, "İçerik zorunludur.")
    .max(10000, "İçerik en fazla 10000 karakter olabilir."),
  audienceType: announcementAudienceEnum,
  priority: announcementPriorityEnum.default("NORMAL"),
  buildingIds: uuidList,
  apartmentIds: uuidList,
  publishAt: nullableDate(),
  expiresAt: nullableDate(),
});

function refineAudience(
  data: {
    audienceType: "ALL_SITE" | "BUILDINGS" | "APARTMENTS";
    buildingIds: string[];
    apartmentIds: string[];
  },
  ctx: z.RefinementCtx,
) {
  if (data.audienceType === "BUILDINGS" && data.buildingIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "En az bir bina seçmelisiniz.",
      path: ["buildingIds"],
    });
  }
  if (data.audienceType === "APARTMENTS" && data.apartmentIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "En az bir daire seçmelisiniz.",
      path: ["apartmentIds"],
    });
  }
  if (
    data.audienceType === "ALL_SITE" &&
    (data.buildingIds.length > 0 || data.apartmentIds.length > 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tüm site hedefinde bina/daire seçilemez.",
      path: ["audienceType"],
    });
  }
}

export const createAnnouncementSchema = announcementBodyBase.superRefine(refineAudience);

export const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(10000).optional(),
    audienceType: announcementAudienceEnum.optional(),
    priority: announcementPriorityEnum.optional(),
    buildingIds: z.array(z.string().uuid()).optional(),
    apartmentIds: z.array(z.string().uuid()).optional(),
    publishAt: nullableDate(),
    expiresAt: nullableDate(),
  })
  .superRefine((data, ctx) => {
    if (!data.audienceType) return;
    refineAudience(
      {
        audienceType: data.audienceType,
        buildingIds: data.buildingIds ?? [],
        apartmentIds: data.apartmentIds ?? [],
      },
      ctx,
    );
  });

export const previewAudienceSchema = z
  .object({
    audienceType: announcementAudienceEnum,
    buildingIds: uuidList,
    apartmentIds: uuidList,
  })
  .superRefine(refineAudience);

export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type PreviewAudienceInput = z.infer<typeof previewAudienceSchema>;
