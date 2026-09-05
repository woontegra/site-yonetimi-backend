import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { planFifoAllocations, planUnifiedFifoForAmounts } from "./allocation";
import type { OpenDebtForPlan } from "./allocation";
import type { ProposedAllocationLine } from "./types";

function debt(
  id: string,
  remaining: string,
  title: string,
  year: number,
  month: number,
): OpenDebtForPlan {
  return {
    id,
    title,
    periodYear: year,
    periodMonth: month,
    remainingAmount: new Prisma.Decimal(remaining),
    dueDate: new Date(Date.UTC(year, month - 1, 5)),
  };
}

describe("planFifoAllocations", () => {
  it("blocks nothing and allocates partial remainder correctly", () => {
    const debts = [
      debt("d1", "2500.00", "Eylül", 2026, 9),
      debt("d2", "2500.00", "Ekim", 2026, 10),
    ];
    const plan = planFifoAllocations(new Prisma.Decimal("1000"), debts);
    assert.equal(plan.lines.length, 1);
    assert.equal(plan.lines[0]!.amount, "1000.00");
    assert.equal(plan.lines[0]!.remainingAfter, "1500.00");
    assert.equal(plan.remainder.toFixed(2), "0.00");
  });

  it("does not allocate to a fully paid debt when remaining is zero", () => {
    const debts = [
      debt("d1", "0.00", "Eylül", 2026, 9),
      debt("d2", "2500.00", "Ekim", 2026, 10),
    ];
    const plan = planFifoAllocations(new Prisma.Decimal("2500"), debts);
    assert.equal(plan.lines.length, 1);
    assert.equal(plan.lines[0]!.apartmentDebtId, "d2");
    assert.equal(plan.remainder.toFixed(2), "0.00");
  });

  it("returns remainder when amount exceeds open debts", () => {
    const debts = [debt("d1", "2500.00", "Eylül", 2026, 9)];
    const plan = planFifoAllocations(new Prisma.Decimal("3000"), debts);
    assert.equal(plan.lines[0]!.amount, "2500.00");
    assert.equal(plan.remainder.toFixed(2), "500.00");
  });
});

describe("planUnifiedFifoForAmounts (daire 8 senaryosu)", () => {
  it("distributes 2500 + 10000 across five months without double-paying September", () => {
    const debts = [
      debt("sep", "2500.00", "Eylül", 2026, 9),
      debt("oct", "2500.00", "Ekim", 2026, 10),
      debt("nov", "2500.00", "Kasım", 2026, 11),
      debt("dec", "2500.00", "Aralık", 2026, 12),
      debt("jan", "2500.00", "Ocak", 2027, 1),
    ];
    const plan = planUnifiedFifoForAmounts(
      [new Prisma.Decimal("2500"), new Prisma.Decimal("10000")],
      debts,
    );
    assert.equal(plan.totalIncoming.toFixed(2), "12500.00");
    assert.equal(plan.remainder.toFixed(2), "0.00");
    assert.equal(plan.lines.length, 5);
    assert.deepEqual(
      plan.lines.map((line: ProposedAllocationLine) => ({
        id: line.apartmentDebtId,
        amount: line.amount,
      })),
      [
        { id: "sep", amount: "2500.00" },
        { id: "oct", amount: "2500.00" },
        { id: "nov", amount: "2500.00" },
        { id: "dec", amount: "2500.00" },
        { id: "jan", amount: "2500.00" },
      ],
    );
  });

  it("allocation totals never exceed debt remaining", () => {
    const debts = [
      debt("a", "100.50", "A", 2026, 1),
      debt("b", "200.25", "B", 2026, 2),
    ];
    const plan = planFifoAllocations(new Prisma.Decimal("250.75"), debts);
    const byId = new Map(debts.map((item) => [item.id, item.remainingAmount]));
    for (const line of plan.lines) {
      assert.ok(new Prisma.Decimal(line.amount).lte(byId.get(line.apartmentDebtId)!));
    }
  });
});
