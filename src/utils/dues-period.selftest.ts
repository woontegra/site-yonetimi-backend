/**
 * Targeted checks for multi-period assessment helpers.
 * Run: npx tsx src/utils/dues-period.selftest.ts
 */
import {
  MAX_ASSESSMENT_PERIODS,
  computeDueDate,
  expandCustomMonths,
  expandFullYear,
  expandPeriodRange,
  formatDueDateInput,
  suggestedPeriodName,
} from "./dues-period";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run() {
  const single = expandPeriodRange(2026, 9, 2026, 9);
  assert(single.length === 1, "Tek ay → 1 dönem");
  assert(single[0]?.periodMonth === 9 && single[0]?.periodYear === 2026, "Eylül 2026");

  const autumn = expandPeriodRange(2026, 9, 2026, 11);
  assert(autumn.length === 3, "Eylül–Kasım → 3 dönem");

  const wrap = expandPeriodRange(2026, 11, 2027, 2);
  assert(wrap.length === 4, "Kasım 2026–Şubat 2027 → 4 dönem");
  assert(
    wrap.map((p) => `${p.periodYear}-${p.periodMonth}`).join(",") ===
      "2026-11,2026-12,2027-1,2027-2",
    "Yıl geçişi sırası",
  );

  const year = expandFullYear(2027);
  assert(year.length === 12, "Tüm 2027 → 12 dönem");
  assert(year[0]?.periodMonth === 1 && year[11]?.periodMonth === 12, "Ocak–Aralık");

  const custom = expandCustomMonths(2026, [1, 3, 6]);
  assert(custom.length === 3, "Özel aylar → 3 dönem");
  assert(
    custom.map((p) => p.periodMonth).join(",") === "1,3,6",
    "Ocak, Mart, Haziran",
  );

  const due10 = formatDueDateInput(computeDueDate(2026, 9, 10));
  assert(due10 === "2026-09-10", `Her ayın 10'u: got ${due10}`);
  assert(formatDueDateInput(computeDueDate(2026, 10, 10)) === "2026-10-10", "Ekim 10");
  assert(formatDueDateInput(computeDueDate(2026, 11, 10)) === "2026-11-10", "Kasım 10");

  const febEnd = formatDueDateInput(computeDueDate(2026, 2, "END"));
  assert(febEnd === "2026-02-28", `Şubat 2026 ay sonu: got ${febEnd}`);
  const febLeap = formatDueDateInput(computeDueDate(2028, 2, "END"));
  assert(febLeap === "2028-02-29", `Şubat 2028 ay sonu: got ${febLeap}`);
  assert(formatDueDateInput(computeDueDate(2026, 4, "END")) === "2026-04-30", "Nisan 30");
  assert(formatDueDateInput(computeDueDate(2026, 1, "END")) === "2026-01-31", "Ocak 31");

  assert(suggestedPeriodName(2026, 9) === "Eylül 2026 Aidatı", "Başlık");

  let threw = false;
  try {
    expandPeriodRange(2026, 11, 2026, 9);
  } catch {
    threw = true;
  }
  assert(threw, "Bitiş < başlangıç reddedilmeli");

  threw = false;
  try {
    expandPeriodRange(2025, 1, 2027, 2); // 26 months
  } catch {
    threw = true;
  }
  assert(threw, `En fazla ${MAX_ASSESSMENT_PERIODS} ay`);

  // 17 daire, 1 sürekli muaf, 3 ay → 48 borç (hesap doğrulaması)
  const apartments = 17;
  const alwaysExempt = 1;
  const months = 3;
  const debts = (apartments - alwaysExempt) * months;
  assert(debts === 48, "17 daire / 1 muaf / 3 ay → 48 borç");

  console.log("dues-period.selftest: OK");
  console.log(`MAX_ASSESSMENT_PERIODS=${MAX_ASSESSMENT_PERIODS}`);
}

run();
