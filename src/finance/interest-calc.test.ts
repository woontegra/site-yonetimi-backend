import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeMonthlyInterest,
  firstInterestPeriod,
  principalCutoffDate,
  remainingPrincipalForInterestMonth,
  roundMoneyHalfUp,
} from "./interest-calc";

describe("interest-calc", () => {
  it("rounds half-up to kuruş", () => {
    assert.equal(roundMoneyHalfUp(new Prisma.Decimal("1.225")).toFixed(2), "1.23");
    assert.equal(roundMoneyHalfUp(new Prisma.Decimal("1.224")).toFixed(2), "1.22");
  });

  it("computes monthly simple interest", () => {
    const amount = computeMonthlyInterest(new Prisma.Decimal("1500"), new Prisma.Decimal("5"));
    assert.equal(amount.toFixed(2), "75.00");
  });

  it("first interest period is calendar month after due month", () => {
    const due = new Date(Date.UTC(2026, 8, 10)); // 10.09.2026
    const first = firstInterestPeriod(due);
    assert.deepEqual(first, { year: 2026, month: 10 });
  });

  it("principal cutoff is last day of previous month", () => {
    const cutoff = principalCutoffDate(2026, 10);
    assert.equal(cutoff.toISOString().slice(0, 10), "2026-09-30");
  });

  it("partial payments reduce principal for later months", () => {
    const original = new Prisma.Decimal("2500");
    const payments = [
      { paymentDate: new Date(Date.UTC(2026, 8, 20)), amount: new Prisma.Decimal("1000") },
    ];
    // Ekim 2026 → kesim 30.09.2026; 20.09 ödemesi düşülür → 1500
    const oct = remainingPrincipalForInterestMonth(original, payments, 2026, 10);
    assert.equal(oct.toFixed(2), "1500.00");
    // Eylül 2026 → kesim 31.08.2026; 20.09 ödemesi henüz yok → 2500
    const sep = remainingPrincipalForInterestMonth(original, payments, 2026, 9);
    assert.equal(sep.toFixed(2), "2500.00");
  });
});
