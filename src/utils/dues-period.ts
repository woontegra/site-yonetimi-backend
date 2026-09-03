import { turkeyDateToUtcMidnight } from "./turkey-date";

export const MAX_ASSESSMENT_PERIODS = 24;

export type PeriodRef = { periodYear: number; periodMonth: number };

export type DueDay = number | "END";

const MONTH_LABELS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

export function formatPeriodLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? month} ${year}`;
}

export function suggestedPeriodName(year: number, month: number): string {
  return `${formatPeriodLabel(year, month)} Aidatı`;
}

export function periodIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromPeriodIndex(index: number): PeriodRef {
  const periodYear = Math.floor(index / 12);
  const periodMonth = (index % 12) + 1;
  return { periodYear, periodMonth };
}

export function expandPeriodRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): PeriodRef[] {
  const start = periodIndex(startYear, startMonth);
  const end = periodIndex(endYear, endMonth);
  if (end < start) {
    throw new Error("Bitiş dönemi başlangıç döneminden önce olamaz.");
  }
  const count = end - start + 1;
  if (count > MAX_ASSESSMENT_PERIODS) {
    throw new Error(`Tek işlemde en fazla ${MAX_ASSESSMENT_PERIODS} ay seçilebilir.`);
  }
  const periods: PeriodRef[] = [];
  for (let i = start; i <= end; i += 1) periods.push(fromPeriodIndex(i));
  return periods;
}

export function expandFullYear(year: number): PeriodRef[] {
  return Array.from({ length: 12 }, (_, i) => ({ periodYear: year, periodMonth: i + 1 }));
}

export function expandCustomMonths(year: number, months: number[]): PeriodRef[] {
  const unique = [...new Set(months)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (unique.length === 0) throw new Error("En az bir ay seçilmelidir.");
  if (unique.length > MAX_ASSESSMENT_PERIODS) {
    throw new Error(`Tek işlemde en fazla ${MAX_ASSESSMENT_PERIODS} ay seçilebilir.`);
  }
  return unique.map((periodMonth) => ({ periodYear: year, periodMonth }));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Son ödeme gününü Türkiye takvim günü (UTC midnight) olarak üretir. */
export function computeDueDate(year: number, month: number, dueDay: DueDay): Date {
  if (dueDay === "END") {
    return turkeyDateToUtcMidnight(year, month, daysInMonth(year, month));
  }
  const day = Math.min(Math.max(1, Math.floor(dueDay)), 28);
  const capped = Math.min(day, daysInMonth(year, month));
  return turkeyDateToUtcMidnight(year, month, capped);
}

export function formatDueDateInput(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
