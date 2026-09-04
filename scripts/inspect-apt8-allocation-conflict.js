const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const apt = await prisma.apartment.findFirst({
    where: { number: "8", building: { name: { contains: "B" } }, deletedAt: null },
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true, siteId: true } },
      relations: {
        where: { isActive: true, endDate: null },
        select: {
          relationType: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
      debts: {
        where: { cancelledAt: null },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          periodYear: true,
          periodMonth: true,
          originalAmount: true,
          remainingAmount: true,
          status: true,
          allocations: {
            select: {
              id: true,
              amount: true,
              payment: { select: { id: true, status: true, amount: true } },
            },
          },
        },
      },
    },
  });

  const txs = await prisma.bankTransaction.findMany({
    where: {
      matchedApartmentId: apt?.id,
      status: "ACTIVE",
      paymentId: null,
      direction: "CREDIT",
    },
    orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      transactionDate: true,
      amount: true,
      description: true,
      senderName: true,
      referenceNo: true,
      matchedApartmentId: true,
      paymentId: true,
      matchStatus: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        apartment: apt
          ? {
              id: apt.id,
              label: `${apt.building.name} / ${apt.number}`,
              siteId: apt.building.siteId,
              relations: apt.relations.map(
                (r) => `${r.relationType}:${r.person.firstName} ${r.person.lastName}`,
              ),
              debts: apt.debts.map((d) => ({
                id: d.id,
                title: d.title,
                period: d.periodYear && d.periodMonth ? `${d.periodYear}-${d.periodMonth}` : null,
                original: String(d.originalAmount),
                remaining: String(d.remainingAmount),
                status: d.status,
                allocationSum: d.allocations
                  .filter((a) => a.payment.status !== "CANCELLED")
                  .reduce((s, a) => s + Number(a.amount), 0)
                  .toFixed(2),
                allocations: d.allocations.map((a) => ({
                  id: a.id,
                  amount: String(a.amount),
                  paymentId: a.payment.id,
                  paymentStatus: a.payment.status,
                })),
              })),
            }
          : null,
        transactions: txs.map((t) => ({
          id: t.id,
          date: t.transactionDate.toISOString().slice(0, 10),
          amount: String(t.amount),
          senderName: t.senderName,
          description: t.description,
          apartmentId: t.matchedApartmentId,
          paymentId: t.paymentId,
          matchStatus: t.matchStatus,
        })),
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
