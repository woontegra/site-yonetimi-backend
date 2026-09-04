/**
 * READ-ONLY checks: debit ATM txs not in payment counters; classify API guards.
 * Does NOT create expenses or mutate the six payment-pending credits.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const site = await prisma.bankAccount.findFirst({
    where: { deletedAt: null },
    select: { tenantId: true, siteId: true },
  });
  if (!site) {
    console.log("No bank account — skip");
    return;
  }

  const { tenantId, siteId } = site;
  const txWhere = {
    tenantId,
    bankAccount: { siteId, deletedAt: null },
    status: "ACTIVE" as const,
  };

  const [pendingMatch, unmatchedCredit, unclassifiedDebit, debitInPending] = await Promise.all([
    prisma.bankTransaction.count({
      where: {
        ...txWhere,
        direction: "CREDIT",
        matchStatus: { in: ["SUGGESTED", "MATCHED"] },
        paymentId: null,
      },
    }),
    prisma.bankTransaction.count({
      where: { ...txWhere, matchStatus: "UNMATCHED", direction: "CREDIT" },
    }),
    prisma.bankTransaction.count({
      where: {
        ...txWhere,
        direction: "DEBIT",
        OR: [{ debitClass: "UNCLASSIFIED" }, { debitClass: null }],
        expenseId: null,
      },
    }),
    prisma.bankTransaction.count({
      where: {
        ...txWhere,
        direction: "DEBIT",
        matchStatus: { in: ["SUGGESTED", "MATCHED"] },
        paymentId: null,
      },
    }),
  ]);

  const atmSamples = await prisma.bankTransaction.findMany({
    where: {
      ...txWhere,
      direction: "DEBIT",
      description: { contains: "BANKAMATIK", mode: "insensitive" },
    },
    take: 5,
    select: {
      id: true,
      amount: true,
      debitClass: true,
      matchStatus: true,
      paymentId: true,
      expenseId: true,
      description: true,
    },
  });

  if (debitInPending !== 0) {
    throw new Error(`DEBIT txs incorrectly counted as pending match: ${debitInPending}`);
  }

  for (const atm of atmSamples) {
    if (atm.paymentId) throw new Error(`ATM tx has payment: ${atm.id}`);
    if (atm.matchStatus !== "UNMATCHED") {
      throw new Error(`ATM tx should be UNMATCHED for apartment match: ${atm.id}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        pendingMatch,
        unmatchedCredit,
        unclassifiedDebit,
        debitInPending,
        atmSamples: atmSamples.map((a) => ({
          id: a.id,
          amount: String(a.amount),
          debitClass: a.debitClass,
          expenseId: a.expenseId,
          desc: a.description.slice(0, 60),
        })),
        cashModel: false,
      },
      null,
      2,
    ),
  );
  console.log("verify-bank-debit-separation: OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
