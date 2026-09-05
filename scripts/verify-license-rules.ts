/**
 * Demo/Yıllık lisans kuralları — saf birim testleri.
 * Kullanım: npx tsx scripts/verify-license-rules.ts
 */
import { LICENSE_ANNUAL_DAYS, LICENSE_DEMO_DAYS, computeLicensePrice } from "../src/config/license.config";
import {
  addCalendarDaysEndOfDay,
  extendBaseDate,
  istanbulYmd,
  remainingCalendarDays,
} from "../src/utils/license-dates";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

function main() {
  assert(LICENSE_DEMO_DAYS === 7, "demo 7 gün");
  assert(LICENSE_ANNUAL_DAYS === 365, "yıllık 365 gün");

  const convertDay = new Date("2026-09-07T12:00:00+03:00");
  const demoEnds = addCalendarDaysEndOfDay(new Date("2026-09-12T12:00:00+03:00"), 0);
  // demo bitiş günü sonu
  const annualEnds = addCalendarDaysEndOfDay(demoEnds, 365);
  const ymd = istanbulYmd(annualEnds);
  assert(ymd.year === 2027 && ymd.month === 9 && ymd.day === 12, `yıllık bitiş 12.09.2027 oldu: ${ymd.year}-${ymd.month}-${ymd.day}`);

  const expiredEnds = new Date("2026-08-01T20:59:59.999Z");
  const now = new Date("2026-09-07T10:00:00.000Z");
  const renewBase = extendBaseDate(expiredEnds, now);
  const renewed = addCalendarDaysEndOfDay(renewBase, 365);
  assert(remainingCalendarDays(renewed, now) === 365, "dolmuş yıllık yenileme 365 gün");

  const activeEnds = new Date("2026-10-10T20:59:59.999Z");
  const renewActive = addCalendarDaysEndOfDay(extendBaseDate(activeEnds, new Date("2026-10-01T10:00:00.000Z")), 365);
  const y = istanbulYmd(renewActive);
  assert(y.year === 2027 && y.month === 10 && y.day === 10, "aktif yenileme bitiş +365");

  const p = computeLicensePrice(4000, 20);
  assert(p.vatAmount === 800 && p.grossPrice === 4800, "KDV decimal");

  console.log("Lisans kuralları testleri geçti.");
}

main();
