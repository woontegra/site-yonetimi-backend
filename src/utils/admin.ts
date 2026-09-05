import { HttpError } from "./httpError";

export function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return "—";
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export function formatDateTimeTr(value: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function slugifyTenantName(name: string): string {
  const map: Record<string, string> = {
    ç: "c",
    ğ: "g",
    ı: "i",
    ö: "o",
    ş: "s",
    ü: "u",
    â: "a",
  };
  const normalized = name
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || "tenant";
}

export function redactSecrets(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/EAA[A-Za-z0-9]+/g, "[redacted]")
    .replace(/(?:access[_-]?token|api[_-]?key|secret|password|resetToken|code)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/([?#&](?:token|resetToken|code|invite)=)[^&\s#]+/gi, "$1[redacted]")
    .replace(/[A-Fa-f0-9]{40,}/g, "[redacted]");
}

/** URL / query / body özetlerini log için maskele. */
export function redactSensitiveUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "http://local.invalid");
    for (const key of ["token", "code", "resetToken", "invite", "password"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.hash) {
      url.hash = url.hash.replace(/(token|code|resetToken)=([^&]+)/gi, "$1=[redacted]");
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return redactSecrets(raw);
  }
}

export function daysUntil(date: Date, from = new Date()): number {
  const ms = date.getTime() - from.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function addYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

export function assertUuidParam(id: string, message = "Geçersiz kayıt."): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, message);
  }
  return id;
}
