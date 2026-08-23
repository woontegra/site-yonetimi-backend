/**
 * Platform admin lisans muafiyeti — saf karar tablosu.
 * Kullanıcı verisi oluşturmaz / silmez. Tam build değildir.
 * Kullanım: npx tsx scripts/verify-license-exemption.ts
 */
import {
  decideLicenseAccess,
  isLicenseEnforcementEnabled,
  isSubscriptionCurrentlyValid,
} from "../src/services/entitlement.service";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const expired = { status: "EXPIRED" as const, endsAt: new Date("2020-01-01T00:00:00.000Z") };
const active = {
  status: "ACTIVE" as const,
  endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

function main() {
  assert(isLicenseEnforcementEnabled() === false, "bu fazda LICENSE_ENFORCEMENT açık olmamalı");

  const adminNoSub = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: true,
    subscription: null,
    enforcementEnabled: true,
  });
  assert(adminNoSub.allowed && adminNoSub.exempt, "admin + abonelik yok: muaf ve açık");
  assert(adminNoSub.reason === "platform_admin_exempt", "admin nedeni exempt olmalı");

  const adminExpired = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: true,
    subscription: expired,
    enforcementEnabled: true,
  });
  assert(adminExpired.allowed && adminExpired.exempt, "admin + süresi dolmuş: yine açık");

  const tenantActive = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: active,
    enforcementEnabled: true,
  });
  assert(tenantActive.allowed && !tenantActive.exempt, "normal + aktif abonelik: bağlı ve açık");

  const tenantExpiredLocked = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: expired,
    enforcementEnabled: true,
  });
  assert(!tenantExpiredLocked.allowed && !tenantExpiredLocked.exempt, "normal + dolmuş + kilit: kapalı");

  const tenantExpiredUnlocked = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: expired,
    enforcementEnabled: false,
  });
  assert(tenantExpiredUnlocked.allowed && !tenantExpiredUnlocked.exempt, "normal + dolmuş + kilit kapalı: mevcut davranış");

  const tenantMissingUnlocked = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: null,
    enforcementEnabled: false,
  });
  assert(tenantMissingUnlocked.allowed && !tenantMissingUnlocked.exempt, "normal + kayıt yok + kilit kapalı: açık");

  const revoked = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: expired,
    enforcementEnabled: true,
  });
  assert(!revoked.exempt, "yetki kalkınca muafiyet biter");

  const inactiveAdmin = decideLicenseAccess({
    isActive: false,
    isPlatformAdmin: true,
    subscription: null,
    enforcementEnabled: true,
  });
  assert(!inactiveAdmin.allowed && !inactiveAdmin.exempt, "pasif hesap sırf admin diye geçmez");

  assert(isSubscriptionCurrentlyValid(null) === true, "kayıt yokken mevcut geçerlilik true kalır");
  assert(isSubscriptionCurrentlyValid(expired) === false, "EXPIRED geçersizdir");
  assert(isSubscriptionCurrentlyValid(active) === true, "ACTIVE geçerlidir");

  console.log("Lisans muafiyeti karar tablosu geçti.");
}

main();
