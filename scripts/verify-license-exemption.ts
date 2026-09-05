/**
 * Platform admin lisans muafiyeti + salt okunur karar tablosu.
 * Kullanım: npx tsx scripts/verify-license-exemption.ts
 */
import {
  decideLicenseAccess,
  isSubscriptionCurrentlyValid,
} from "../src/services/entitlement.service";
import {
  addCalendarDaysEndOfDay,
  extendBaseDate,
  remainingCalendarDays,
} from "../src/utils/license-dates";
import { computeLicensePrice, demoPriceSnapshot } from "../src/config/license.config";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const expired = { status: "EXPIRED" as const, endsAt: new Date("2020-01-01T00:00:00.000Z") };
const active = {
  status: "ACTIVE" as const,
  endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

function main() {
  const adminNoSub = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: true,
    subscription: null,
  });
  assert(adminNoSub.writable && adminNoSub.exempt, "admin + abonelik yok: muaf ve yazılabilir");

  const adminExpired = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: true,
    subscription: expired,
  });
  assert(adminExpired.writable && adminExpired.exempt, "admin + süresi dolmuş: yine yazılabilir");

  const tenantActive = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: active,
  });
  assert(tenantActive.writable && !tenantActive.exempt, "normal + aktif: yazılabilir");

  const tenantExpired = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: expired,
  });
  assert(
    tenantExpired.allowed && !tenantExpired.writable && tenantExpired.readOnly,
    "normal + dolmuş: okur, yazamaz",
  );

  assert(isSubscriptionCurrentlyValid(null) === true, "kayıt yokken geçerli sayılır");
  assert(isSubscriptionCurrentlyValid(expired) === false, "EXPIRED geçersizdir");
  assert(isSubscriptionCurrentlyValid(active) === true, "ACTIVE geçerlidir");

  const price = computeLicensePrice(4000, 20);
  assert(price.netPrice === 4000, "net 4000");
  assert(price.vatAmount === 800, "KDV 800");
  assert(price.grossPrice === 4800, "toplam 4800");
  assert(demoPriceSnapshot().grossPrice === 0, "demo 0");

  const now = new Date("2026-09-07T10:00:00.000Z");
  const ends = addCalendarDaysEndOfDay(now, 7);
  assert(remainingCalendarDays(ends, now) === 7, "7 gün kalan");

  const past = new Date("2026-08-01T10:00:00.000Z");
  const baseExpired = extendBaseDate(past, now);
  assert(baseExpired.getTime() === now.getTime(), "dolmuş uzatma bugünden");

  const future = new Date("2026-10-01T10:00:00.000Z");
  assert(extendBaseDate(future, now).getTime() === future.getTime(), "aktif uzatma endsAt üzerinden");

  console.log("Lisans karar / fiyat / tarih testleri geçti.");
}

main();
