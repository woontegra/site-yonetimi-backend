const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const txs = await prisma.bankTransaction.findMany({
    where: {
      direction: "CREDIT",
      status: "ACTIVE",
      paymentId: null,
      matchStatus: { in: ["SUGGESTED", "MATCHED"] },
      matchedApartmentId: { not: null },
    },
    select: {
      id: true,
      matchedApartmentId: true,
      amount: true,
      matchedApartment: {
        select: { number: true, building: { select: { name: true } } },
      },
    },
  });
  const by = new Map();
  for (const t of txs) {
    const k = t.matchedApartmentId;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const multi = [...by.entries()]
    .filter(([, a]) => a.length > 1)
    .map(([id, arr]) => ({
      apartmentId: id,
      label: arr[0].matchedApartment
        ? `${arr[0].matchedApartment.building.name}/${arr[0].matchedApartment.number}`
        : id,
      count: arr.length,
      total: arr.reduce((s, t) => s + Number(t.amount), 0).toFixed(2),
    }));
  console.log(
    JSON.stringify(
      { pendingMatchedCredits: txs.length, multiApartmentCount: multi.length, multi },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
})();
