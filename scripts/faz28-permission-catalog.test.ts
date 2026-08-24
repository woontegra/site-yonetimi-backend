import assert from "node:assert/strict";
import {
  applyPermissionDependencies,
  defaultPermissionsForRole,
  effectivePermissions,
  isOwnerRole,
  sanitizePermissions,
  stripWritesWithoutView,
} from "../src/permissions/catalog";

assert.equal(isOwnerRole("ORGANIZASYON_SAHIBI"), true);
assert.equal(isOwnerRole("SITE_YONETICISI"), true);
assert.equal(isOwnerRole("YONETICI"), false);

const viewer = defaultPermissionsForRole("GORUNTULEYICI");
assert.ok(viewer.every((code) => code.endsWith(".view")));
assert.ok(!viewer.includes("payments.create"));

const accounting = defaultPermissionsForRole("MUHASEBE");
assert.ok(accounting.includes("payments.create"));
assert.ok(!accounting.includes("users.manage"));

assert.ok(applyPermissionDependencies(["payments.create"]).includes("payments.view"));
assert.ok(sanitizePermissions(["payments.create", "not-a-code"]).includes("payments.view"));
assert.ok(effectivePermissions("ORGANIZASYON_SAHIBI", []).includes("users.manage"));
assert.equal(effectivePermissions("MUHASEBE", ["payments.view"]).includes("payments.create"), false);
assert.equal(stripWritesWithoutView(["payments.create"]).includes("payments.create"), false);

console.log("faz28 permission catalog tests: ok");
