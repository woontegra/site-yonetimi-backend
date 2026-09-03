import { z } from "zod";

export const adminPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
});

export const adminTenantListQuerySchema = adminPageQuerySchema.extend({
  filter: z.enum(["aktif", "pasif", "deneme", "lisansli"]).optional(),
});

export const adminUserListQuerySchema = adminPageQuerySchema.extend({
  status: z.enum(["aktif", "pasif"]).optional(),
  tenantId: z.string().uuid().optional(),
});

export const adminSiteListQuerySchema = adminPageQuerySchema.extend({
  tenantId: z.string().uuid().optional(),
  status: z.enum(["aktif", "pasif"]).optional(),
  setupStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]).optional(),
  city: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
});

export const adminSubscriptionListQuerySchema = adminPageQuerySchema.extend({
  status: z.enum(["TRIAL", "ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"]).optional(),
});

export const adminIntegrationListQuerySchema = adminPageQuerySchema.extend({
  status: z.enum(["DISCONNECTED", "CONNECTED", "ERROR"]).optional(),
});

export const adminCommunicationListQuerySchema = adminPageQuerySchema.extend({
  tenantId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  provider: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  status: z.enum(["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const adminAuditListQuerySchema = adminPageQuerySchema.extend({
  tenantId: z.string().uuid().optional(),
  action: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  targetType: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  targetId: z.string().uuid().optional(),
});

export const adminNoteSchema = z.object({
  content: z
    .string({ required_error: "Not içeriği zorunludur." })
    .trim()
    .min(1, "Not içeriği zorunludur.")
    .max(4000, "Not en fazla 4000 karakter olabilir."),
});

export const adminExtendSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  endsAt: z.coerce.date().optional(),
  plan: z.enum(["DEMO", "STANDARD", "PROFESSIONAL"]).optional(),
});

export const adminTrialSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
});

export const adminDeleteTenantSchema = z.object({
  confirmName: z
    .string({ required_error: "Tenant adı zorunludur." })
    .trim()
    .min(1, "Tenant adı zorunludur.")
    .max(120),
});

export const adminPlanSchema = z.object({
  plan: z.enum(["DEMO", "STANDARD", "PROFESSIONAL"]),
});

export const adminEndsAtSchema = z.object({
  endsAt: z.coerce.date({ required_error: "Bitiş tarihi zorunludur." }),
});

export const adminCreateTenantSchema = z
  .object({
    name: z
      .string({ required_error: "Organizasyon adı zorunludur." })
      .trim()
      .min(2, "Organizasyon adı en az 2 karakter olmalıdır.")
      .max(120, "Organizasyon adı en fazla 120 karakter olabilir."),
    managerFullName: z
      .string({ required_error: "Yönetici adı soyadı zorunludur." })
      .trim()
      .min(2, "Yönetici adı soyadı zorunludur.")
      .max(120),
    managerEmail: z
      .string({ required_error: "Yönetici e-posta adresi zorunludur." })
      .trim()
      .email("Geçerli bir e-posta girin.")
      .toLowerCase(),
    plan: z.enum(["DEMO", "PROFESSIONAL"]).default("DEMO"),
    trialDays: z.coerce.number().int().min(1).max(90).optional(),
    licenseTerm: z.enum(["1m", "3m", "6m", "1y", "custom"]).optional(),
    endsAt: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.plan === "PROFESSIONAL" && (data.licenseTerm ?? "1y") === "custom") {
      if (!data.endsAt) {
        ctx.addIssue({ code: "custom", message: "Özel bitiş tarihi zorunludur.", path: ["endsAt"] });
        return;
      }
      if (data.endsAt.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", message: "Bitiş tarihi geçmiş olamaz.", path: ["endsAt"] });
      }
    }
  });

export const adminEmailIntegrationSchema = z.object({
  senderName: z.string().trim().min(1, "Gönderici adı zorunludur.").max(120),
  senderEmail: z.string().trim().email("Geçerli bir gönderici e-posta girin.").toLowerCase(),
  replyToEmail: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().email("Geçerli bir Reply-To e-posta girin.").toLowerCase().optional(),
  ),
  smtpHost: z.string().trim().min(1, "SMTP sunucusu zorunludur.").max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecurity: z.enum(["SSL_TLS", "STARTTLS"]),
  smtpUsername: z.string().trim().min(1, "SMTP kullanıcı adı zorunludur.").max(255),
  smtpPassword: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    }),
  notificationEmail: z.string().trim().email("Geçerli bir bildirim e-postası girin.").toLowerCase(),
  isActive: z.boolean().default(true),
});

export const adminEmailSetActiveSchema = z.object({
  isActive: z.boolean(),
});

export const adminEmailTestSendSchema = z.object({
  recipientEmail: z
    .string()
    .trim()
    .email("Geçerli bir alıcı e-posta girin.")
    .toLowerCase()
    .optional(),
});

export const adminEmailDeliveryListQuerySchema = adminPageQuerySchema.extend({
  status: z.enum(["PENDING", "SENT", "FAILED"]).optional(),
  type: z
    .enum(["TENANT_WELCOME_ACTIVATION", "PLATFORM_NEW_TENANT_NOTIFICATION", "SMTP_TEST"])
    .optional(),
  tenantId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
