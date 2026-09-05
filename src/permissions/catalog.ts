import type { UserRole } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard.view",
  "sites.view",
  "sites.manage",
  "buildings.view",
  "buildings.manage",
  "apartments.view",
  "apartments.manage",
  "persons.view",
  "persons.manage",
  "dues.view",
  "dues.manage",
  "debts.view",
  "debts.create",
  "debts.cancel",
  "payments.view",
  "payments.create",
  "payments.cancel",
  "expenses.view",
  "expenses.create",
  "expenses.manage",
  "expenses.cancel",
  "banks.view",
  "banks.manage",
  "interest.view",
  "interest.manage",
  "financeReports.view",
  "assets.view",
  "assets.manage",
  "visitors.view",
  "visitors.manage",
  "employees.view",
  "employees.manage",
  "suppliers.view",
  "suppliers.manage",
  "announcements.view",
  "announcements.manage",
  "feedback.view",
  "feedback.manage",
  "messages.view",
  "messages.send",
  "whatsappTemplates.manage",
  "integrations.view",
  "integrations.manage",
  "siteSettings.manage",
  "users.view",
  "users.invite",
  "users.manage",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const PERMISSION_SET = new Set<string>(PERMISSIONS);

export type PermissionGroup = {
  id: string;
  label: string;
  items: Array<{ code: PermissionCode; label: string }>;
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "genel",
    label: "Genel",
    items: [{ code: "dashboard.view", label: "Dashboard görüntüleme" }],
  },
  {
    id: "yapi",
    label: "Yapı ve Sakinler",
    items: [
      { code: "sites.view", label: "Siteleri görüntüleme" },
      { code: "sites.manage", label: "Siteleri yönetme" },
      { code: "buildings.view", label: "Binaları görüntüleme" },
      { code: "buildings.manage", label: "Binaları yönetme" },
      { code: "apartments.view", label: "Daireleri görüntüleme" },
      { code: "apartments.manage", label: "Daireleri yönetme" },
      { code: "persons.view", label: "Kişileri görüntüleme" },
      { code: "persons.manage", label: "Kişileri yönetme" },
    ],
  },
  {
    id: "finans",
    label: "Finans",
    items: [
      { code: "dues.view", label: "Aidatları görüntüleme" },
      { code: "dues.manage", label: "Aidat oluşturma ve düzenleme" },
      { code: "debts.view", label: "Borçları görüntüleme" },
      { code: "debts.create", label: "Borç oluşturma" },
      { code: "debts.cancel", label: "Borç iptal etme" },
      { code: "payments.view", label: "Tahsilatları görüntüleme" },
      { code: "payments.create", label: "Tahsilat kaydetme" },
      { code: "payments.cancel", label: "Tahsilat iptal etme" },
      { code: "expenses.view", label: "Giderleri görüntüleme" },
      { code: "expenses.create", label: "Gider ekleme" },
      { code: "expenses.manage", label: "Gider düzenleme" },
      { code: "expenses.cancel", label: "Gider iptal etme" },
      { code: "banks.view", label: "Banka hesaplarını ve hareketlerini görüntüleme" },
      { code: "banks.manage", label: "Banka işlemlerini yönetme" },
      { code: "interest.view", label: "Faiz kararlarını görüntüleme" },
      { code: "interest.manage", label: "Faiz kararlarını yönetme ve faiz uygulama" },
      { code: "financeReports.view", label: "Finans raporlarını görüntüleme" },
    ],
  },
  {
    id: "operasyon",
    label: "Operasyon",
    items: [
      { code: "assets.view", label: "Demirbaşları görüntüleme" },
      { code: "assets.manage", label: "Demirbaşları yönetme" },
      { code: "visitors.view", label: "Ziyaretçileri görüntüleme" },
      { code: "visitors.manage", label: "Ziyaretçileri yönetme" },
      { code: "employees.view", label: "Çalışanları görüntüleme" },
      { code: "employees.manage", label: "Çalışanları yönetme" },
      { code: "suppliers.view", label: "Tedarikçileri görüntüleme" },
      { code: "suppliers.manage", label: "Tedarikçileri yönetme" },
    ],
  },
  {
    id: "iletisim",
    label: "İletişim",
    items: [
      { code: "announcements.view", label: "Duyuruları görüntüleme" },
      { code: "announcements.manage", label: "Duyuru oluşturma ve yönetme" },
      { code: "feedback.view", label: "Bilgi ve önerileri görüntüleme" },
      { code: "feedback.manage", label: "Bilgi ve önerileri yönetme" },
      { code: "messages.view", label: "Mesaj geçmişini görüntüleme" },
      { code: "messages.send", label: "Mesaj gönderme" },
      { code: "whatsappTemplates.manage", label: "WhatsApp şablonlarını yönetme" },
    ],
  },
  {
    id: "ayarlar",
    label: "Ayarlar",
    items: [
      { code: "integrations.view", label: "Entegrasyon durumlarını görüntüleme" },
      { code: "integrations.manage", label: "E-posta/WhatsApp bağlantılarını yönetme" },
      { code: "siteSettings.manage", label: "Site ayarlarını yönetme" },
      { code: "users.view", label: "Kullanıcıları görüntüleme" },
      { code: "users.invite", label: "Kullanıcı davet etme" },
      { code: "users.manage", label: "Kullanıcı ve yetki yönetme" },
    ],
  },
];

export const VIEW_OF: Record<string, PermissionCode> = {
  "sites.manage": "sites.view",
  "buildings.manage": "buildings.view",
  "apartments.manage": "apartments.view",
  "persons.manage": "persons.view",
  "dues.manage": "dues.view",
  "debts.create": "debts.view",
  "debts.cancel": "debts.view",
  "payments.create": "payments.view",
  "payments.cancel": "payments.view",
  "expenses.create": "expenses.view",
  "expenses.manage": "expenses.view",
  "expenses.cancel": "expenses.view",
  "banks.manage": "banks.view",
  "assets.manage": "assets.view",
  "visitors.manage": "visitors.view",
  "employees.manage": "employees.view",
  "suppliers.manage": "suppliers.view",
  "announcements.manage": "announcements.view",
  "feedback.manage": "feedback.view",
  "messages.send": "messages.view",
  "integrations.manage": "integrations.view",
  "users.invite": "users.view",
  "users.manage": "users.view",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ORGANIZASYON_SAHIBI: "Organizasyon Sahibi",
  SITE_YONETICISI: "Organizasyon Sahibi",
  YONETICI: "Yönetici",
  MUHASEBE: "Muhasebe",
  MUHASEBE_PERSONELI: "Muhasebe",
  OPERASYON: "Operasyon",
  YONETIM_PERSONELI: "Operasyon",
  GORUNTULEYICI: "Görüntüleyici",
  SINIRLI_YETKILI: "Görüntüleyici",
};

export function isOwnerRole(role: UserRole): boolean {
  return role === "ORGANIZASYON_SAHIBI" || role === "SITE_YONETICISI";
}

const ALL = [...PERMISSIONS];

const VIEW_ONLY = PERMISSIONS.filter((code) => code.endsWith(".view"));

const ACCOUNTING: PermissionCode[] = [
  "dashboard.view",
  "sites.view",
  "buildings.view",
  "apartments.view",
  "persons.view",
  "dues.view",
  "dues.manage",
  "debts.view",
  "debts.create",
  "debts.cancel",
  "payments.view",
  "payments.create",
  "payments.cancel",
  "expenses.view",
  "expenses.create",
  "expenses.manage",
  "expenses.cancel",
  "banks.view",
  "banks.manage",
  "interest.view",
  "interest.manage",
  "financeReports.view",
];

const OPERATIONS: PermissionCode[] = [
  "dashboard.view",
  "sites.view",
  "buildings.view",
  "buildings.manage",
  "apartments.view",
  "apartments.manage",
  "persons.view",
  "persons.manage",
  "assets.view",
  "assets.manage",
  "visitors.view",
  "visitors.manage",
  "employees.view",
  "employees.manage",
  "suppliers.view",
  "suppliers.manage",
  "announcements.view",
  "announcements.manage",
  "feedback.view",
  "feedback.manage",
];

const MANAGER: PermissionCode[] = PERMISSIONS.filter(
  (code) => code !== "users.invite" && code !== "users.manage" && code !== "integrations.manage",
);

export function defaultPermissionsForRole(role: UserRole): PermissionCode[] {
  if (isOwnerRole(role)) return ALL;
  if (role === "YONETICI") return [...MANAGER];
  if (role === "MUHASEBE" || role === "MUHASEBE_PERSONELI") return [...ACCOUNTING];
  if (role === "OPERASYON" || role === "YONETIM_PERSONELI") return [...OPERATIONS];
  return [...VIEW_ONLY];
}

export function sanitizePermissions(input: unknown): PermissionCode[] {
  const source = Array.isArray(input) ? input : [];
  const next = new Set<PermissionCode>();
  for (const item of source) {
    if (typeof item === "string" && PERMISSION_SET.has(item)) {
      next.add(item as PermissionCode);
    }
  }
  return applyPermissionDependencies([...next]);
}

export function applyPermissionDependencies(codes: PermissionCode[]): PermissionCode[] {
  const next = new Set(codes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const code of [...next]) {
      const view = VIEW_OF[code];
      if (view && !next.has(view)) {
        next.add(view);
        changed = true;
      }
    }
  }
  return PERMISSIONS.filter((code) => next.has(code));
}

export function stripWritesWithoutView(codes: PermissionCode[]): PermissionCode[] {
  const set = new Set(codes);
  for (const [write, view] of Object.entries(VIEW_OF)) {
    if (!set.has(view)) set.delete(write as PermissionCode);
  }
  return PERMISSIONS.filter((code) => set.has(code));
}

export function effectivePermissions(role: UserRole, stored: unknown): PermissionCode[] {
  if (isOwnerRole(role)) return ALL;
  const custom = Array.isArray(stored) ? stored : [];
  if (custom.length === 0) return defaultPermissionsForRole(role);
  return sanitizePermissions(custom);
}

export const ASSIGNABLE_ROLES: UserRole[] = [
  "ORGANIZASYON_SAHIBI",
  "YONETICI",
  "MUHASEBE",
  "OPERASYON",
  "GORUNTULEYICI",
];

