/**
 * Verifies preview matching no longer does per-row DB loads (logic-level).
 * Run: npx tsx scripts/verify-bank-statement-preview-batch.ts
 */
import assert from "node:assert/strict";
import {
  suggestStatementMatchFromContext,
  type StatementMatchContext,
} from "../src/utils/bank-statement-match";

const ctx: StatementMatchContext = {
  rules: [
    {
      containsText: "serdar topal",
      apartmentId: "apt-6",
      personId: "p-1",
      buildingId: "b-1",
    },
  ],
  apartments: [
    { id: "apt-6", number: "6", buildingId: "b-1", building: { name: "B Blok" } },
    { id: "apt-1", number: "1", buildingId: "b-1", building: { name: "B Blok" } },
  ],
  relations: [
    {
      personId: "p-1",
      apartmentId: "apt-6",
      apartment: { buildingId: "b-1" },
      person: { firstName: "Serdar", lastName: "Topal" },
    },
  ],
};

const rows = Array.from({ length: 200 }, (_, i) => ({
  description: i % 2 === 0 ? `EFT Gelen Serdar Topal daire 6 ${i}` : `Market harcama ${i}`,
}));

const started = Date.now();
let matched = 0;
for (const row of rows) {
  const suggestion = suggestStatementMatchFromContext(ctx, row.description);
  if (suggestion.matchStatus === "SUGGESTED") matched += 1;
}
const elapsed = Date.now() - started;

assert.ok(matched > 0, "expected some matches");
assert.ok(elapsed < 2000, `batch match should be fast, took ${elapsed}ms`);
console.log(
  JSON.stringify({
    scope: "verify_bank_statement_preview_batch",
    rowCount: rows.length,
    matched,
    elapsedMs: elapsed,
    ok: true,
  }),
);
