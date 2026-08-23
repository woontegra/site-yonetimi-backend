import { z } from "zod";

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

function optionalDate() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    return value;
  }, z.coerce.date({ invalid_type_error: "Geçerli bir tarih girin." }).optional());
}

function optionalUuid() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  );
}

const initialAssignmentSchema = z
  .object({
    siteId: z.string({ required_error: "Site seçimi zorunludur." }).uuid("Site seçimi zorunludur."),
    scope: z.enum(["SITE", "BUILDING"], {
      required_error: "Kapsam seçimi zorunludur.",
    }),
    buildingId: optionalUuid(),
    startDate: optionalDate(),
    note: optionalText(),
  })
  .superRefine((data, ctx) => {
    if (data.scope === "BUILDING" && !data.buildingId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bina seçimi zorunludur.",
        path: ["buildingId"],
      });
    }
  });

export const createEmployeeSchema = z.object({
  firstName: z
    .string({ required_error: "Ad zorunludur." })
    .trim()
    .min(1, "Ad zorunludur.")
    .max(80),
  lastName: z
    .string({ required_error: "Soyad zorunludur." })
    .trim()
    .min(1, "Soyad zorunludur.")
    .max(80),
  phone: optionalText(),
  email: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().email("Geçerli bir e-posta girin.").optional(),
  ),
  address: optionalText(),
  jobTitle: z
    .string({ required_error: "Görev zorunludur." })
    .trim()
    .min(1, "Görev zorunludur.")
    .max(120),
  hireDate: optionalDate(),
  /** İlk görev yeri — create ile birlikte zorunlu. */
  assignment: initialAssignmentSchema,
});

export const updateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(40), z.null()]).optional(),
  ),
  email: z.preprocess((value) => {
    if (value === "" || value === null) return null;
    return value;
  }, z.union([z.string().trim().email("Geçerli bir e-posta girin."), z.null()]).optional()),
  address: z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.string().trim().max(500), z.null()]).optional(),
  ),
  jobTitle: z.string().trim().min(1).max(120).optional(),
  hireDate: z.preprocess((value) => {
    if (value === "" || value === null) return null;
    if (value === undefined) return undefined;
    return value;
  }, z.union([z.coerce.date(), z.null()]).optional()),
  isActive: z.boolean().optional(),
});

export const terminateEmployeeSchema = z.object({
  terminationDate: z.coerce.date({
    required_error: "İşten çıkış tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
});

export const listEmployeesQuerySchema = z.object({
  search: z.string().trim().optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["aktif", "pasif"]).optional(),
  jobTitle: z.string().trim().optional().transform((value) => value || undefined),
});

export const createAssignmentSchema = z.object({
  employeeId: z.string().uuid("Çalışan seçimi zorunludur."),
  scope: z.enum(["SITE", "BUILDING"], {
    required_error: "Kapsam seçimi zorunludur.",
  }),
  buildingId: optionalUuid(),
  startDate: optionalDate(),
  note: optionalText(),
}).superRefine((data, ctx) => {
  if (data.scope === "BUILDING" && !data.buildingId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bina seçimi zorunludur.",
      path: ["buildingId"],
    });
  }
});

export const endAssignmentSchema = z.object({
  endDate: z.coerce.date({
    required_error: "Bitiş tarihi zorunludur.",
    invalid_type_error: "Geçerli bir tarih girin.",
  }),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type TerminateEmployeeInput = z.infer<typeof terminateEmployeeSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>;
