/**
 * Sentetik birim testleri — FIFO daire grubu dağıtımı (DB yazmaz).
 * Çalıştır: npx tsx scripts/test-bank-batch-allocate.ts
 */
import { Prisma } from "@prisma/client";
import {
  planApartmentBatchAllocations,
  type BatchTxInput,
  type DebtSnapshot,
} from "../src/utils/bank-batch-allocate";

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

function debt(
  id: string,
  year: number,
  month: number,
  remaining: number,
  title?: string,
): DebtSnapshot {
  return {
    id,
    title: title ?? `${month}/${year} Aidatı`,
    periodYear: year,
    periodMonth: month,
    remainingAmount: d(remaining),
    dueDate: new Date(Date.UTC(year, month - 1, 1)),
  };
}

function tx(
  id: string,
  amount: number,
  date: string,
  description: string,
  apartmentId = "apt-8",
): BatchTxInput {
  return {
    id,
    amount: d(amount),
    transactionDate: new Date(date),
    description,
    referenceNo: null,
    apartmentId,
  };
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log("  OK ", msg);
  } else {
    failed += 1;
    console.error("  FAIL", msg);
  }
}

console.log("1) 2500 + 10000 = 12500 → en eski 5 borç, Eylül'e çift yazım yok");
{
  const debts = [
    debt("d9", 2026, 9, 2500, "Eylül 2026 Aidatı"),
    debt("d10", 2026, 10, 2500, "Ekim 2026 Aidatı"),
    debt("d11", 2026, 11, 2500, "Kasım 2026 Aidatı"),
    debt("d12", 2026, 12, 2500, "Aralık 2026 Aidatı"),
    debt("d1", 2027, 1, 2500, "Ocak 2027 Aidatı"),
    debt("d2", 2027, 2, 2500, "Şubat 2027 Aidatı"),
  ];
  const plan = planApartmentBatchAllocations(debts, [
    tx("zeki", 10000, "2026-09-01T10:00:00Z", "ZEKİ GÜZELSOY*EYLÜL EKİM KASIM ARALIK"),
    tx("nihal", 2500, "2026-09-02T10:00:00Z", "EYLÜL 2026*NİHAL ERBAŞ"),
  ]);
  assert(plan.status === "READY", `READY (${plan.status})`);
  assert(plan.totalIncoming === "12500.00", "toplam 12500");
  assert(plan.remainderTotal === "0.00", "dağıtılamayan 0");
  assert(plan.debtsCovered === 5, "5 borç");
  assert(plan.unifiedAllocations.map((a) => a.title).join("|") ===
    "Eylül 2026 Aidatı|Ekim 2026 Aidatı|Kasım 2026 Aidatı|Aralık 2026 Aidatı|Ocak 2027 Aidatı",
    "en eski 5 dönem sırası");
  assert(
    plan.unifiedAllocations.every((a) => a.amount === "2500.00"),
    "her borç 2500",
  );
  const eylCount = plan.unifiedAllocations.filter((a) => a.apartmentDebtId === "d9").length;
  assert(eylCount === 1 && plan.unifiedAllocations[0]!.amount === "2500.00", "Eylül tek kez 2500");
  // Zeki önce → 4 borç; Nihal → 5. borç (Ocak); açıklama Eylül dese de
  const nihal = plan.transactionPlans.find((p) => p.transactionId === "nihal")!;
  assert(nihal.allocations[0]?.apartmentDebtId === "d1", "Nihal Ocak'a (FIFO, açıklama yok sayılır)");
}

console.log("2) Farklı gönderenler tek daire toplamında");
{
  const debts = [
    debt("a", 2026, 9, 2500),
    debt("b", 2026, 10, 2500),
  ];
  const plan = planApartmentBatchAllocations(debts, [
    tx("s1", 2500, "2026-09-01T10:00:00Z", "Nihal"),
    tx("s2", 2500, "2026-09-02T10:00:00Z", "Zeki"),
  ]);
  assert(plan.transactionPlans.length === 2, "2 ayrı hareket planı (Payment ayrımı)");
  assert(plan.totalIncoming === "5000.00", "birleşik toplam");
  assert(plan.unifiedAllocations.length === 2, "2 borç");
}

console.log("3) Fazla ödeme → dağıtılamayan bakiye");
{
  const debts = [debt("only", 2026, 9, 2500)];
  const plan = planApartmentBatchAllocations(debts, [
    tx("a", 2500, "2026-09-01T10:00:00Z", "x"),
    tx("b", 2500, "2026-09-02T10:00:00Z", "y"),
  ]);
  assert(plan.status === "OVERPAYMENT", "OVERPAYMENT");
  assert(Number(plan.remainderTotal) === 2500, "2500 dağıtılamayan");
  assert(plan.unifiedAllocations[0]?.amount === "2500.00", "tek borç max 2500");
}

console.log("4) Başka daire etkilenmez (ayrı plan)");
{
  const debts8 = [debt("8a", 2026, 9, 2500), debt("8b", 2026, 10, 2500)];
  const debts4 = [debt("4a", 2026, 9, 2500)];
  const p8 = planApartmentBatchAllocations(debts8, [
    tx("t8", 2500, "2026-09-01T10:00:00Z", "apt8", "apt-8"),
  ]);
  const p4 = planApartmentBatchAllocations(debts4, [
    tx("t4", 2500, "2026-09-01T10:00:00Z", "apt4", "apt-4"),
  ]);
  assert(p8.unifiedAllocations[0]?.apartmentDebtId === "8a", "daire 8 kendi borcu");
  assert(p4.unifiedAllocations[0]?.apartmentDebtId === "4a", "daire 4 kendi borcu");
}

console.log("\nSonuç:", { passed, failed });
if (failed > 0) process.exit(1);
