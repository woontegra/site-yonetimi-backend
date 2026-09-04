const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const tables = await prisma.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%apartment%debt%'
       OR table_name ILIKE '%ApartmentDebt%'
    ORDER BY table_schema, table_name
  `;
  console.log("tables:", JSON.stringify(tables, null, 2));

  // Prove Prisma model works
  const viaPrisma = await prisma.apartmentDebt.findFirst({
    select: { id: true },
  });
  console.log("prisma.apartmentDebt.findFirst:", viaPrisma?.id ? "OK" : "empty-but-ok");

  // Prove wrong quoted name fails
  try {
    await prisma.$queryRaw`SELECT id FROM "ApartmentDebt" LIMIT 1`;
    console.log('quoted "ApartmentDebt": unexpectedly OK');
  } catch (e) {
    console.log('quoted "ApartmentDebt" error code:', e?.meta?.code || e?.code || "?", String(e.message).slice(0, 120));
  }

  // Prove correct mapped name works
  try {
    const rows = await prisma.$queryRaw`SELECT id FROM "apartment_debts" LIMIT 1`;
    console.log('quoted "apartment_debts": OK rows=', Array.isArray(rows) ? rows.length : rows);
  } catch (e) {
    console.log('quoted "apartment_debts" FAILED:', e.message);
  }

  // Partial payment check for the 6 known pending-ish txs / apt 8
  const aptId = "f5b2c4fb-80e5-449d-b5ea-6d7e7ad044b9";
  const txs = await prisma.bankTransaction.findMany({
    where: {
      matchedApartmentId: aptId,
      OR: [
        { id: { in: [
          "db769b2a-8b58-422b-ab87-c231da911fb4",
          "24ab7761-32d2-45b6-a92a-1d4bc9dd7410",
        ] } },
        { paymentId: { not: null }, processedAt: { gte: new Date(Date.now() - 7 * 864e5) } },
      ],
    },
    select: {
      id: true,
      paymentId: true,
      matchStatus: true,
      amount: true,
      processedAt: true,
    },
  });
  console.log("apt8 bank txs state:", JSON.stringify(txs, null, 2));

  const recentPayments = await prisma.payment.findMany({
    where: {
      apartmentId: aptId,
      createdAt: { gte: new Date(Date.now() - 2 * 864e5) },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      createdAt: true,
      description: true,
      allocations: { select: { id: true, amount: true, apartmentDebtId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("recent apt8 payments (2d):", JSON.stringify(recentPayments, null, 2));

  const openDebts = await prisma.apartmentDebt.findMany({
    where: { apartmentId: aptId, status: "OPEN", cancelledAt: null },
    orderBy: [{ dueDate: "asc" }],
    select: {
      title: true,
      remainingAmount: true,
      status: true,
      periodYear: true,
      periodMonth: true,
    },
    take: 6,
  });
  console.log("open debts sample:", JSON.stringify(openDebts, null, 2));

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
