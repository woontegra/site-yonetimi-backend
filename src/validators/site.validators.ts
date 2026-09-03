import { z } from "zod";

const optionalTrimmed = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const listSitesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["aktif", "pasif", "hepsi"]).optional().default("hepsi"),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "Site adı zorunludur."),
  code: optionalTrimmed,
  address: optionalTrimmed,
  city: optionalTrimmed,
  district: optionalTrimmed,
  description: optionalTrimmed,
});

export const updateSiteSchema = createSiteSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const confirmSiteDeleteSchema = z.object({
  confirmName: z
    .string({ required_error: "Site adı zorunludur." })
    .trim()
    .min(1, "Site adı zorunludur.")
    .max(200),
});
export type ListSitesQuery = z.infer<typeof listSitesQuerySchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
