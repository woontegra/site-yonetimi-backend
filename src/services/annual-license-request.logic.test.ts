/**
 * Yıllık lisans talep / fiyat — saf birim testleri (prisma yok).
 * npx tsx src/services/annual-license-request.logic.test.ts
 */
import { computeLicensePrice, LICENSE_ANNUAL_DAYS, LICENSE_DEMO_DAYS } from "../config/license.config";
import { addCalendarDaysEndOfDay } from "../utils/license-dates";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

/** convertToAnnual ile aynı taban seçimi — saf kopya. */
function projectedAnnualEndsAt(
  subscription: { plan: string; endsAt: Date } | null,
  now = new Date(),
): Date {
  if (!subscription) return addCalendarDaysEndOfDay(now, LICENSE_ANNUAL_DAYS);
  const base =
    subscription.plan === "DEMO" && subscription.endsAt.getTime() > now.getTime()
      ? subscription.endsAt
      : now;
  return addCalendarDaysEndOfDay(base, LICENSE_ANNUAL_DAYS);
}

function main() {
  const price = computeLicensePrice(4000, 20);
  assert(price.netPrice === 4000, "net");
  assert(price.vatAmount === 800, "vat");
  assert(price.grossPrice === 4800, "gross");
  assert(LICENSE_DEMO_DAYS === 7, "demo days");
  assert(LICENSE_ANNUAL_DAYS === 365, "annual days");

  const now = new Date("2026-09-05T12:00:00+03:00");
  const demoEnds = addCalendarDaysEndOfDay(new Date("2026-09-10T12:00:00+03:00"), 0);
  const projected = projectedAnnualEndsAt({ plan: "DEMO", endsAt: demoEnds }, now);
  const expected = addCalendarDaysEndOfDay(demoEnds, 365);
  assert(projected.getTime() === expected.getTime(), "demo remaining days preserved");

  const fromNow = projectedAnnualEndsAt(
    { plan: "DEMO", endsAt: new Date("2026-08-01T20:59:59.999Z") },
    now,
  );
  const expectedNow = addCalendarDaysEndOfDay(now, 365);
  assert(fromNow.getTime() === expectedNow.getTime(), "expired demo starts from now");

  console.log("Annual license request logic tests passed.");
}

main();
