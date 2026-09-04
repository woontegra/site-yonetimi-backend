/**
 * Run: npx tsx scripts/verify-bank-statement-match-unit.ts
 */
import assert from "node:assert/strict";
import {
  classifyNameMatch,
  suggestStatementMatchFromContext,
  type StatementMatchContext,
} from "../src/utils/bank-statement-match";

function ctxFromPeople(
  people: Array<{
    apt: string;
    number: string;
    first: string;
    last: string;
    role?: "OWNER" | "TENANT";
  }>,
): StatementMatchContext {
  const apartments = [...new Set(people.map((p) => p.apt))].map((id) => {
    const row = people.find((p) => p.apt === id)!;
    return {
      id,
      number: row.number,
      buildingId: "b1",
      building: { name: "B Blok" },
    };
  });
  return {
    rules: [],
    apartments,
    relations: people.map((p, i) => ({
      personId: `p-${i}`,
      apartmentId: p.apt,
      relationType: p.role ?? "OWNER",
      apartment: { buildingId: "b1" },
      person: { firstName: p.first, lastName: p.last },
    })),
  };
}

const site = ctxFromPeople([
  { apt: "apt-1", number: "1", first: "M. Sinan", last: "Erkan" },
  { apt: "apt-2", number: "2", first: "Güler", last: "Ümüt" },
  { apt: "apt-4", number: "4", first: "Oya", last: "Kemik" },
  { apt: "apt-5", number: "5", first: "Münire", last: "Gevrecki" },
  { apt: "apt-6", number: "6", first: "Serdar", last: "Topal" },
  { apt: "apt-7", number: "7", first: "Tanyol", last: "Ergin" },
  { apt: "apt-8", number: "8", first: "Nihal", last: "Erbaş" },
  { apt: "apt-12", number: "12", first: "Mehmet", last: "Çevik" },
  { apt: "apt-15", number: "15", first: "Ali Şakir", last: "Özoğlu" },
]);

assert.equal(classifyNameMatch("Oya Kemik", "OYA KEMİK"), "FULL");
assert.equal(classifyNameMatch("Münire Gevrecki", "Hüseyin Gevrecki"), "SURNAME");
assert.equal(classifyNameMatch("M. Sinan Erkan", "Mehmet Sinan Erkan"), "INITIALS");
assert.equal(classifyNameMatch("Nihal Erbaş", "ZEKİ GÜZELSOY"), "NONE");

{
  const s = suggestStatementMatchFromContext(site, "FAST OYA KEMİK aidat");
  assert.equal(s.apartmentId, "apt-4");
  assert.equal(s.confidence, "HIGH");
  assert.match(s.reason, /malik adı tam eşleşti/i);
}

{
  const s = suggestStatementMatchFromContext(site, "FAST MEHMET ÇEVİK aidat");
  assert.equal(s.apartmentId, "apt-12");
  assert.equal(s.confidence, "HIGH");
}

{
  const s = suggestStatementMatchFromContext(site, "FAST Hüseyin Gevrecki aidat");
  assert.equal(s.apartmentId, "apt-5");
  assert.equal(s.confidence, "MEDIUM");
  assert.equal(s.matchKind, "SURNAME_ONLY");
  assert.match(s.reason, /soyadı/i);
}

{
  const s = suggestStatementMatchFromContext(site, "FAST Mehmet Sinan Erkan aidat");
  assert.equal(s.apartmentId, "apt-1");
  assert.ok(s.confidence === "MEDIUM" || s.confidence === "HIGH");
  assert.ok(s.matchKind === "INITIALS_NAME" || s.matchKind === "FULL_NAME_OWNER" || s.matchKind === "PARTIAL_NAME");
}

{
  const s = suggestStatementMatchFromContext(
    site,
    "Sistem FA FAST ZEKİ GÜZELSOY*Ağustos NO 8*FAST",
  );
  assert.equal(s.apartmentId, "apt-8");
  assert.equal(s.confidence, "MEDIUM");
  assert.equal(s.nameMismatch, true);
  assert.equal(s.matchKind, "NAME_MISMATCH_APARTMENT");
  assert.match(s.reason, /uyuşmuyor|numarası/i);
}

{
  const s = suggestStatementMatchFromContext(site, "FAST GÜLER ÜMÜT aidat");
  assert.equal(s.apartmentId, "apt-2");
  assert.equal(s.confidence, "HIGH");
}

{
  const s = suggestStatementMatchFromContext(site, "FAST ALİ ŞAKİR ÖZOĞLU aidat");
  assert.equal(s.apartmentId, "apt-15");
  assert.equal(s.confidence, "HIGH");
}

{
  const s = suggestStatementMatchFromContext(site, "FAST TANYOL ERGİN aidat");
  assert.equal(s.apartmentId, "apt-7");
  assert.equal(s.confidence, "HIGH");
}

{
  const s = suggestStatementMatchFromContext(
    site,
    "Sistem FA FAST Serdar Topal*Ağustos daire 6*FAST",
  );
  assert.equal(s.apartmentId, "apt-6");
  assert.equal(s.confidence, "HIGH");
  assert.equal(s.matchKind, "NAME_AND_APARTMENT");
}

console.log("verify-bank-statement-match-unit: OK");
