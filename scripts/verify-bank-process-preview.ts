/**
 * READ-ONLY: preview process-batch for pending matched txs (no Payment writes).
 * Run: npx tsx scripts/verify-bank-process-preview.ts
 */
import { PrismaClient } from "@prisma/client";
import { bankTransactionService } from "../src/services/bank-transaction.service";

const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.bankTransaction.findMany({
    where: {
      status: "ACTIVE",
      matchStatus: { in: ["SUGGESTED", "MATCHED"] },
      paymentId: null,
      direction: "CREDIT",
    },
    take: 10,
    select: {
      id: true,
      tenantId: true,
      description: true,
      amount: true,
      bankAccount: { select: { siteId: true } },
      matchedPerson: { select: { firstName: true, lastName: true } },
      matchedApartment: { select: { number: true, building: { select: { name: true } } } },
    },
  });

  if (txs.length === 0) {
    console.log("No pending matched CREDIT txs — skip.");
    return;
  }

  const tenantId = txs[0]!.tenantId;
  const siteId = txs[0]!.bankAccount.siteId;
  const ids = txs.map((t) => t.id);

  const preview = await bankTransactionService.previewProcessBatch(tenantId, siteId, ids);

  console.log(
    JSON.stringify(
      {
        count: preview.items.length,
        summary: preview.summary,
        items: preview.items.map((i) => ({
          id: i.id,
          apt: i.apartment ? `${i.apartment.building.name}/${i.apartment.number}` : null,
          person: i.matchedPerson,
          amount: i.amount,
          bulkSafe: i.bulkSafe,
          risky: i.risky,
          matchKind: i.matchKind,
          nameMismatch: i.nameMismatch,
          warning: i.warning,
          allocationTitles: i.allocations.map((a) => `${a.title}:${a.amount}`),
          paymentIdExists: false,
        })),
      },
      null,
      2,
    ),
  );

  // Assert none of these have payments (still)
  const still = await prisma.bankTransaction.count({
    where: { id: { in: ids }, paymentId: { not: null } },
  });
  if (still !== 0) throw new Error("Preview mutated payments!");
  console.log("verify-bank-process-preview: OK (no payments created)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
