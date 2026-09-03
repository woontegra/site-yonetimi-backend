import { z } from "zod";
import { parseTurkeyDateInput } from "../utils/turkey-date";

const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalıdır.")
  .transform((value) => parseTurkeyDateInput(value));

export const createApartmentDuesExemptionSchema = z
  .object({
    exemptionType: z.enum(["FULL", "PERCENT", "FIXED"]),
    value: z.number().finite().optional().nullable(),
    startDate: dateInput,
    endDate: dateInput.nullable().optional(),
    indefinite: z.boolean().optional(),
    reason: z.enum(["MANAGER", "STAFF", "BOARD_DECISION", "OTHER"]),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.exemptionType === "FULL") {
      if (data.value != null) {
        ctx.addIssue({ code: "custom", message: "Tam muafiyette tutar/yüzde girilmez.", path: ["value"] });
      }
    } else if (data.exemptionType === "PERCENT") {
      if (data.value == null || data.value <= 0 || data.value > 100) {
        ctx.addIssue({
          code: "custom",
          message: "Yüzde indirim 0 ile 100 arasında olmalıdır.",
          path: ["value"],
        });
      }
    } else if (data.value == null || data.value <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Sabit indirim tutarı 0'dan büyük olmalıdır.",
        path: ["value"],
      });
    }

    const indefinite = data.indefinite === true || data.endDate == null;
    if (!indefinite && data.endDate && data.endDate.getTime() < data.startDate.getTime()) {
      ctx.addIssue({
        code: "custom",
        message: "Bitiş tarihi başlangıçtan önce olamaz.",
        path: ["endDate"],
      });
    }
  })
  .transform((data) => ({
    exemptionType: data.exemptionType,
    value: data.exemptionType === "FULL" ? null : (data.value ?? null),
    startDate: data.startDate,
    endDate: data.indefinite === true ? null : (data.endDate ?? null),
    reason: data.reason,
    note: data.note?.trim() ? data.note.trim() : null,
  }));

export const updateApartmentDuesExemptionSchema = z
  .object({
    exemptionType: z.enum(["FULL", "PERCENT", "FIXED"]).optional(),
    value: z.number().finite().optional().nullable(),
    startDate: dateInput.optional(),
    endDate: dateInput.nullable().optional(),
    indefinite: z.boolean().optional(),
    reason: z.enum(["MANAGER", "STAFF", "BOARD_DECISION", "OTHER"]).optional(),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.exemptionType === "PERCENT" && data.value != null && (data.value <= 0 || data.value > 100)) {
      ctx.addIssue({
        code: "custom",
        message: "Yüzde indirim 0 ile 100 arasında olmalıdır.",
        path: ["value"],
      });
    }
    if (data.exemptionType === "FIXED" && data.value != null && data.value <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Sabit indirim tutarı 0'dan büyük olmalıdır.",
        path: ["value"],
      });
    }
  });

export type CreateApartmentDuesExemptionInput = z.infer<typeof createApartmentDuesExemptionSchema>;
export type UpdateApartmentDuesExemptionInput = z.infer<typeof updateApartmentDuesExemptionSchema>;
