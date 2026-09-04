import { prisma } from "../src/lib/prisma";

async function main() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const [bankTx, payments, allocations] = await Promise.all([
    prisma.bankTransaction.count({ where: { createdAt: { gte: since } } }),
    prisma.payment.count({ where: { createdAt: { gte: since } } }),
    prisma.paymentAllocation.count({ where: { createdAt: { gte: since } } }),
  ]);
  console.log(
    JSON.stringify({
      scope: "readonly_financial_check",
      sinceHours: 2,
      bankTransactionCount: bankTx,
      paymentCount: payments,
      paymentAllocationCount: allocations,
      note: "preview_endpoint_does_not_write_financial_records",
    }),
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String(error));
  await prisma.$disconnect();
  process.exit(1);
});
