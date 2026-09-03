import { Prisma } from "@prisma/client";

/** Türkiye takvim günü parçaları (Europe/Istanbul). */
export function turkeyCalendarParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/**
 * Türkiye takvim tarihini UTC gece yarısı anı olarak saklar (YYYY-MM-DD kayması önlenir).
 * Karşılaştırmalar startOfUtcCalendarDay ile yapılır.
 */
export function turkeyDateToUtcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseTurkeyDateInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("Geçersiz tarih.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return turkeyDateToUtcMidnight(year, month, day);
}

export function startOfUtcCalendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function formatTurkeyDateInput(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Aidat dönemi referansı: ayın ilk günü (Türkiye takvimi). */
export function duesPeriodReferenceDate(periodYear: number, periodMonth: number): Date {
  return turkeyDateToUtcMidnight(periodYear, periodMonth, 1);
}

export function isUtcDayInInclusiveRange(
  reference: Date,
  start: Date,
  end: Date | null | undefined,
): boolean {
  const ref = startOfUtcCalendarDay(reference).getTime();
  const from = startOfUtcCalendarDay(start).getTime();
  if (ref < from) return false;
  if (!end) return true;
  const to = startOfUtcCalendarDay(end).getTime();
  return ref <= to;
}

export function turkeyTodayUtcMidnight(): Date {
  const { year, month, day } = turkeyCalendarParts(new Date());
  return turkeyDateToUtcMidnight(year, month, day);
}

export function daysUntilUtc(from: Date, to: Date): number {
  const a = startOfUtcCalendarDay(from).getTime();
  const b = startOfUtcCalendarDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function applyDuesExemptionAmount(
  baseAmount: Prisma.Decimal,
  exemption: { exemptionType: "FULL" | "PERCENT" | "FIXED"; value: Prisma.Decimal | null },
): { skip: boolean; amount: Prisma.Decimal } {
  if (exemption.exemptionType === "FULL") {
    return { skip: true, amount: new Prisma.Decimal(0) };
  }
  if (exemption.exemptionType === "PERCENT") {
    const pct = exemption.value ?? new Prisma.Decimal(0);
    const factor = new Prisma.Decimal(1).minus(pct.div(100));
    const amount = baseAmount.mul(factor);
    return {
      skip: false,
      amount: amount.lessThan(0) ? new Prisma.Decimal(0) : amount.toDecimalPlaces(2),
    };
  }
  const fixed = exemption.value ?? new Prisma.Decimal(0);
  const amount = baseAmount.minus(fixed);
  return {
    skip: false,
    amount: amount.lessThan(0) ? new Prisma.Decimal(0) : amount.toDecimalPlaces(2),
  };
}
