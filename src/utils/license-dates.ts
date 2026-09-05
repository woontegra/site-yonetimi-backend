/**
 * Lisans tarihleri — tek kaynak (Europe/Istanbul).
 * "YYYY-MM-DD'ye kadar" = o günün İstanbul sonuna kadar geçerli.
 */

const TZ = "Europe/Istanbul";

export function istanbulYmd(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/** İstanbul takvim gününün son anı (UTC Date). TR şu an UTC+3 (DST yok). */
export function endOfIstanbulDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 20, 59, 59, 999));
}

export function startOfIstanbulDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
}

export function endOfDayFrom(date: Date): Date {
  const { year, month, day } = istanbulYmd(date);
  return endOfIstanbulDay(year, month, day);
}

/** Takvim günü ekle; sonuç o günün İstanbul sonu. */
export function addCalendarDaysEndOfDay(from: Date, days: number): Date {
  const { year, month, day } = istanbulYmd(from);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  return endOfIstanbulDay(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

/** Aktif lisans: mevcut endsAt üzerine; süresi dolmuş: max(now, endsAt) üzerine. */
export function extendBaseDate(endsAt: Date, now = new Date()): Date {
  return endsAt.getTime() > now.getTime() ? endsAt : now.getTime() > endsAt.getTime() ? now : endsAt;
}

/**
 * Kalan tam takvim günü (İstanbul).
 * Bitiş günü boyunca 0 (bugün bitiyor); sonrasında negatif.
 */
export function remainingCalendarDays(endsAt: Date, now = new Date()): number {
  const a = istanbulYmd(now);
  const b = istanbulYmd(endsAt);
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

export function isPastEnd(endsAt: Date, now = new Date()): boolean {
  return now.getTime() > endsAt.getTime();
}
