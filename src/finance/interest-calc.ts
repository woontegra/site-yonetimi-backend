import { Prisma } from "@prisma/client";
import {
  formatTurkeyDateInput,
  turkeyDateToUtcMidnight,
} from "../utils/turkey-date";

/**
 * Aylık basit faiz (Kooperatif referans Motor A ile uyumlu davranış):
 *
 * 1) İlk faiz ayı = vade tarihinin bulunduğu takvim ayından SONRAKI ay.
 *    Örn. vade 10.09.2026 → ilk faiz dönemi Ekim 2026.
 * 2) Gün bazlı oransal ay / 30-360 / bileşik faiz YOKTUR.
 * 3) Ay M için faiz = roundHalfUp(P × aylıkOran% / 100, 2)
 *    P = orijinal ana para − (vade sonrası, COMPLETED ödemelerin M-1 ayının son gününe kadar
 *    düşülmüş toplam tahsisatı).
 * 4) Ödeme gününde ay içi bölünmez: kesim tarihi bir önceki ayın son günüdür.
 * 5) INTEREST türü borçlar ana para hesabına katılmaz (faiz üzerine faiz yok).
 */
export const INTEREST_FORMULA_TR =
  "Aylık basit faiz: yuvarla(kalan_ana_para × aylık_oran% / 100). İlk faiz ayı = vade ayından sonraki ay. Ana para = orijinal tutar − (faiz ayından önceki ayın son gününe kadar tamamlanmış ödemeler). Gün oransalı ve bileşik faiz yok.";

const ZERO = new Prisma.Decimal(0);

export function roundMoneyHalfUp(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function computeMonthlyInterest(
  principal: Prisma.Decimal,
  monthlyRatePercent: Prisma.Decimal,
): Prisma.Decimal {
  if (principal.lte(0) || monthlyRatePercent.lte(0)) return ZERO;
  return roundMoneyHalfUp(principal.mul(monthlyRatePercent).div(100));
}

export function periodCode(year: number, month: number): number {
  return year * 100 + month;
}

export function comparePeriod(
  yearA: number,
  monthA: number,
  yearB: number,
  monthB: number,
): number {
  return periodCode(yearA, monthA) - periodCode(yearB, monthB);
}

export function addMonths(year: number, month: number, delta: number): {
  year: number;
  month: number;
} {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Vade ayının ertesi takvim ayı. */
export function firstInterestPeriod(dueDate: Date): { year: number; month: number } {
  const y = dueDate.getUTCFullYear();
  const m = dueDate.getUTCMonth() + 1;
  return addMonths(y, m, 1);
}

export function lastDayOfMonthUtc(year: number, month: number): Date {
  // Ayın son günü: sonraki ayın 0. günü
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return turkeyDateToUtcMidnight(year, month, lastDay);
}

/** Faiz ayı M için ana para kesim tarihi = (M−1) ayının son günü. */
export function principalCutoffDate(interestYear: number, interestMonth: number): Date {
  const prev = addMonths(interestYear, interestMonth, -1);
  return lastDayOfMonthUtc(prev.year, prev.month);
}

export function* iterateMonths(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): Generator<{ year: number; month: number }> {
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    yield { year, month };
    const next = addMonths(year, month, 1);
    year = next.year;
    month = next.month;
  }
}

export type PaymentSlice = {
  paymentDate: Date;
  amount: Prisma.Decimal;
};

/**
 * Belirli bir faiz ayı için faize esas kalan ana para.
 * Yalnız paymentDate <= cutoff olan COMPLETED tahsisatlar düşülür.
 */
export function remainingPrincipalForInterestMonth(
  originalAmount: Prisma.Decimal,
  payments: PaymentSlice[],
  interestYear: number,
  interestMonth: number,
): Prisma.Decimal {
  const cutoff = principalCutoffDate(interestYear, interestMonth);
  const cutoffIso = formatTurkeyDateInput(cutoff);
  let paid = ZERO;
  for (const p of payments) {
    const payIso = formatTurkeyDateInput(p.paymentDate);
    if (payIso <= cutoffIso) {
      paid = paid.add(p.amount);
    }
  }
  const remaining = originalAmount.sub(paid);
  return remaining.gt(0) ? roundMoneyHalfUp(remaining) : ZERO;
}

export function monthCoveredByDecision(
  interestYear: number,
  interestMonth: number,
  decisionStart: Date,
  decisionEnd: Date,
): boolean {
  const monthStart = turkeyDateToUtcMidnight(interestYear, interestMonth, 1);
  const monthEnd = lastDayOfMonthUtc(interestYear, interestMonth);
  const start = turkeyDateToUtcMidnight(
    decisionStart.getUTCFullYear(),
    decisionStart.getUTCMonth() + 1,
    decisionStart.getUTCDate(),
  );
  const end = turkeyDateToUtcMidnight(
    decisionEnd.getUTCFullYear(),
    decisionEnd.getUTCMonth() + 1,
    decisionEnd.getUTCDate(),
  );
  return formatTurkeyDateInput(monthStart) <= formatTurkeyDateInput(end)
    && formatTurkeyDateInput(monthEnd) >= formatTurkeyDateInput(start);
}

export function buildInterestTitle(sourceTitle: string, year: number, month: number): string {
  const months = [
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
  ];
  const label = `${months[month - 1] ?? month} ${year}`;
  const base = sourceTitle.trim() || "Borç";
  return `${base} Gecikme Faizi (${label})`;
}

export function buildCalculationNote(input: {
  principalBase: Prisma.Decimal;
  monthlyRate: Prisma.Decimal;
  interestAmount: Prisma.Decimal;
  periodYear: number;
  periodMonth: number;
  cutoffDate: Date;
}): string {
  return [
    INTEREST_FORMULA_TR,
    `Dönem: ${input.periodMonth}.${input.periodYear}`,
    `Kesim tarihi: ${formatTurkeyDateInput(input.cutoffDate)}`,
    `Esas ana para: ${input.principalBase.toFixed(2)} ₺`,
    `Aylık oran: %${input.monthlyRate.toFixed(4)}`,
    `Hesaplanan faiz: ${input.interestAmount.toFixed(2)} ₺`,
  ].join(" | ");
}
