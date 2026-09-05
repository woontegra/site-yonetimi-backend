/**
 * License write-guard exemption matrix (no DB).
 * npx tsx scripts/verify-license-guard-exemptions.ts
 */
import { decideLicenseAccess } from "../src/services/entitlement.service";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

const expired = { status: "EXPIRED" as const, endsAt: new Date("2020-01-01T00:00:00.000Z") };
const active = { status: "ACTIVE" as const, endsAt: new Date(Date.now() + 86400000 * 30) };

function main() {
  // Auth/profile are outside requireTenant — documented by route audit.
  // Guard decisions:
  const tenantExpired = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: expired,
  });
  assert(tenantExpired.allowed && !tenantExpired.writable, "expired tenant: read ok, write blocked");

  const adminExpired = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: true,
    subscription: expired,
  });
  assert(adminExpired.writable && adminExpired.exempt, "platform admin writable when expired");

  const tenantActive = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: active,
  });
  assert(tenantActive.writable, "active tenant writable");

  const suspended = decideLicenseAccess({
    isActive: true,
    isPlatformAdmin: false,
    subscription: { status: "SUSPENDED", endsAt: active.endsAt },
  });
  assert(!suspended.writable && suspended.readOnly, "suspended is read-only");

  console.log("License guard exemption decision matrix passed.");
}

main();
