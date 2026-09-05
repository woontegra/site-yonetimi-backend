import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashActivationToken } from "./activation-token.service";
import { publicActivationHref, publicAppHref } from "./mail-provider";
import { renderTenantWelcomeEmail } from "./templates";
import { redactSensitiveUrl, redactSecrets } from "../../utils/admin";

describe("activation invite email templates", () => {
  it("includes name, org, CTA, expiry and support without password", () => {
    const mail = renderTenantWelcomeEmail({
      managerName: "Ayşe Yılmaz",
      tenantName: "Demo Org",
      activationUrl: "http://localhost:3001/aktivasyon#token=abc123",
      expiresHours: 48,
      planLabel: "Demo",
      supportEmail: "destek@example.com",
    });
    assert.equal(mail.subject, "Site Yönetimi hesabınız oluşturuldu");
    assert.match(mail.html, /Ayşe Yılmaz/);
    assert.match(mail.html, /Demo Org/);
    assert.match(mail.html, /Hesabımı Etkinleştir/);
    assert.match(mail.html, /48 saat/);
    assert.match(mail.html, /destek@example.com/);
    assert.doesNotMatch(mail.html.toLowerCase(), /password|parola|şifre:/);
    assert.doesNotMatch(mail.text.toLowerCase(), /password|smtp/);
  });

  it("hashes tokens deterministically and does not equal raw", () => {
    const raw = "a".repeat(64);
    const a = hashActivationToken(raw);
    const b = hashActivationToken(raw);
    assert.equal(a, b);
    assert.notEqual(a, raw);
    assert.equal(a.length, 64);
  });
});

describe("activation link fragment", () => {
  it("builds #token= links and not ?token=", () => {
    const prev = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = "http://localhost:3001";
    try {
      const href = publicActivationHref("deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef");
      assert.ok(href);
      assert.match(href!, /\/aktivasyon#token=/);
      assert.doesNotMatch(href!, /\?token=/);
      assert.ok(!href!.includes("?"));
      const legacy = publicAppHref("/aktivasyon", { token: "legacy" });
      assert.match(legacy!, /\?token=legacy/);
    } finally {
      process.env.PUBLIC_APP_URL = prev;
    }
  });

  it("redacts token from urls and messages", () => {
    const url = redactSensitiveUrl("/aktivasyon?token=abcdef0123456789abcdef0123456789abcdef01");
    assert.ok(url?.includes("token=%5Bredacted%5D") || url?.includes("token=[redacted]"));
    const hashed = redactSecrets("failed token=abcdef0123456789abcdef0123456789abcdef0123456789");
    assert.ok(hashed);
    assert.doesNotMatch(hashed!, /abcdef0123456789/);
  });
});
