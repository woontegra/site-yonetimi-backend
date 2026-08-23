import { z } from "zod";

export const messageChannelSchema = z.enum(["WHATSAPP", "SMS"]);
export const relationTypeSchema = z.enum(["TENANT", "OWNER"]);
export const messageStatusSchema = z.enum([
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "CANCELLED",
]);

export const listMessageTemplatesQuerySchema = z.object({
  channel: messageChannelSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const upsertMessageTemplateSchema = z.object({
  name: z
    .string({ required_error: "Şablon adı zorunludur." })
    .trim()
    .min(1, "Şablon adı zorunludur.")
    .max(120, "Şablon adı en fazla 120 karakter olabilir."),
  channel: messageChannelSchema,
  body: z
    .string({ required_error: "Şablon içeriği zorunludur." })
    .trim()
    .min(1, "Şablon içeriği zorunludur.")
    .max(2000, "Şablon içeriği en fazla 2000 karakter olabilir."),
  isActive: z.boolean().optional(),
  whatsAppTemplateId: z.string().uuid().optional().nullable(),
  whatsAppParameterMapping: z.record(z.string(), z.string()).optional().nullable(),
});

export const debtReminderPreviewQuerySchema = z.object({
  channel: messageChannelSchema.default("WHATSAPP"),
  relationTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(",")
          : ["TENANT", "OWNER"];
      const parsed = raw
        .map((item) => String(item).trim().toUpperCase())
        .filter((item): item is "TENANT" | "OWNER" => item === "TENANT" || item === "OWNER");
      return parsed.length > 0 ? parsed : (["TENANT", "OWNER"] as Array<"TENANT" | "OWNER">);
    }),
  buildingId: z.string().uuid().optional(),
  overdueOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  templateId: z.string().uuid().optional(),
});

export const debtReminderSendSchema = z.object({
  channel: messageChannelSchema,
  templateId: z.string().uuid({ message: "Geçerli bir şablon seçin." }),
  relationTypes: z
    .array(relationTypeSchema)
    .min(1, "En az bir ilişki tipi seçin.")
    .default(["TENANT", "OWNER"]),
  buildingId: z.string().uuid().optional().nullable(),
  overdueOnly: z.boolean().optional().default(false),
  recipients: z
    .array(
      z.object({
        personId: z.string().uuid(),
        apartmentId: z.string().uuid(),
      }),
    )
    .min(1, "En az bir alıcı seçin."),
});

export const listCommunicationMessagesQuerySchema = z.object({
  channel: messageChannelSchema.optional(),
  status: messageStatusSchema.optional(),
  batchId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListMessageTemplatesQuery = z.infer<typeof listMessageTemplatesQuerySchema>;
export type UpsertMessageTemplateInput = z.infer<typeof upsertMessageTemplateSchema>;
export type DebtReminderPreviewQuery = z.infer<typeof debtReminderPreviewQuerySchema>;
export type DebtReminderSendInput = z.infer<typeof debtReminderSendSchema>;
export type ListCommunicationMessagesQuery = z.infer<typeof listCommunicationMessagesQuerySchema>;
