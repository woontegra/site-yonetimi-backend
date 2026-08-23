/**
 * Assert script for WhatsApp template body helpers.
 * Run: npx tsx scripts/test-whatsapp-template-body.ts
 */
import assert from "node:assert/strict";
import {
  bodyToNamedPreviewBody,
  buildComponentsJson,
  countBodyVariables,
  normalizeMetaTemplateName,
  validateBodyForMeta,
} from "../src/utils/whatsapp-template-body";

assert.equal(validateBodyForMeta("").valid, false);
assert.equal(validateBodyForMeta("   ").valid, false);

assert.equal(validateBodyForMeta("Merhaba dünya.").valid, true);
assert.equal(
  validateBodyForMeta("Sayın {{1}}, borcunuz {{2}} tutarındadır.").valid,
  true,
);

assert.equal(validateBodyForMeta("{{1}} merhaba").valid, false);
assert.equal(validateBodyForMeta("merhaba {{1}}").valid, false);
assert.equal(validateBodyForMeta("{{1}}").valid, false);
assert.equal(validateBodyForMeta("Metin {{1}} {{3}}.").valid, false);

const components = buildComponentsJson("Sayın {{1}}, borcunuz {{2}}.");
assert.equal(components.length, 1);
assert.equal(components[0]?.type, "BODY");
assert.equal(components[0]?.text, "Sayın {{1}}, borcunuz {{2}}.");

assert.equal(
  bodyToNamedPreviewBody("Sayın {{1}}, {{2}} yönetimi.", { "1": "adSoyad", "2": "siteAdi" }),
  "Sayın {{adSoyad}}, {{siteAdi}} yönetimi.",
);

assert.equal(normalizeMetaTemplateName("Aidat Hatırlatma"), "aidat_hatirlatma");
assert.equal(normalizeMetaTemplateName("Gecikmiş Aidat (Özel)"), "gecikmis_aidat_ozel");
assert.equal(normalizeMetaTemplateName("İstanbul Şişli"), "istanbul_sisli");

assert.equal(countBodyVariables("{{1}} ve {{2}}"), 2);
assert.equal(countBodyVariables("değişkensiz"), 0);

console.log("whatsapp-template-body: all assertions passed");
