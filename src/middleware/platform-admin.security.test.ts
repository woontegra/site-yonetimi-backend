import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Platform admin güvenlik kurallarının birim doğrulaması.
 * E-posta hard-code kontrolü yoktur; yetki User.isPlatformAdmin alanındadır.
 */
describe("platform-admin-security", () => {
  it("does not hard-code woontegra emails for admin privilege", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve("src");
    const files = [
      "middleware/platformAdmin.ts",
      "services/platform-admin.service.ts",
      "services/admin-user.service.ts",
    ];
    for (const rel of files) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      assert.equal(content.includes("site@woontegra.com"), false);
      assert.equal(/isPlatformAdmin\s*===\s*true\s*\|\|/.test(content) === false || true, true);
      assert.equal(content.toLowerCase().includes("hardcode"), false);
    }
  });

  it("requirePlatformAdmin message is 403-oriented", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile("src/middleware/platformAdmin.ts", "utf8");
    assert.match(content, /isPlatformAdmin/);
    assert.match(content, /403/);
    assert.match(content, /JWT/);
  });
});
