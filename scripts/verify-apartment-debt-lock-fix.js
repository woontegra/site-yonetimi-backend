/**
 * 42P01 düzeltmesi doğrulama — gerçek Payment oluşturmaz.
 * Çalıştır: node scripts/verify-apartment-debt-lock-fix.js
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  let wrongFailed = false;
  try {
    await prisma.$queryRaw`SELECT id FROM "ApartmentDebt" LIMIT 1`;
  } catch (e) {
    wrongFailed =
      String(e.meta?.code) === "42P01" || String(e.message).includes("42P01");
  }
  console.log("wrong ApartmentDebt still 42P01:", wrongFailed);

  const aptId = "f5b2c4fb-80e5-449d-b5ea-6d7e7ad044b9";
  const debts = await prisma.apartmentDebt.findMany({
    where: { apartmentId: aptId, status: "OPEN", cancelledAt: null },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, remainingAmount: true },
    take: 5,
  });
  console.log(
    "prisma findMany oldest 5:",
    debts.map((d) => `${d.title}:${d.remainingAmount}`),
  );

  const src = fs.readFileSync("src/services/bank-transaction.service.ts", "utf8");
  const hasBad = /FROM\s+"ApartmentDebt"/.test(src);
  console.log('service has FROM "ApartmentDebt":', hasBad);

  const txs = await prisma.bankTransaction.findMany({
    where: {
      id: {
        in: [
          "db769b2a-8b58-422b-ab87-c231da911fb4",
          "24ab7761-32d2-45b6-a92a-1d4bc9dd7410",
        ],
      },
    },
    select: { id: true, paymentId: true, matchStatus: true },
  });
  const noPartial = txs.every((t) => t.paymentId == null && t.matchStatus !== "PROCESSED");
  console.log("no partial payments on failed attempt:", noPartial);

  await prisma.$transaction(async (tx) => {
    const open = await tx.apartmentDebt.findMany({
      where: { apartmentId: aptId, status: "OPEN", cancelledAt: null },
      orderBy: [{ dueDate: "asc" }],
      select: { id: true },
      take: 5,
    });
    console.log("transaction prisma.apartmentDebt read OK:", open.length >= 5);
  });

  // Also confirm correct physical name works if ever needed
  const okRows = await prisma.$queryRaw`SELECT id FROM "apartment_debts" LIMIT 1`;
  console.log("physical apartment_debts selectable:", Array.isArray(okRows) && okRows.length === 1);

  await prisma.$disconnect();
  if (!wrongFailed || hasBad || !noPartial) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
