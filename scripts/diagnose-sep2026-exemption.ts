import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TENANT = "b932002a-ec1e-46dd-bba2-816322a7a363";
const BLD = "e378d1c5-3e6e-48f5-a487-4ebc9987a1dc";
const DEF = "98644e4e-fe6d-4d41-83ce-2a514b164944";

async function main() {
  const apt6 = await p.apartment.findFirst({
    where: { buildingId: BLD, number: "6", deletedAt: null },
    select: { id: true, number: true },
  });
  const exemptions = apt6
    ? await p.apartmentDuesExemption.findMany({
        where: { tenantId: TENANT, apartmentId: apt6.id, isActive: true },
        select: {
          id: true,
          exemptionType: true,
          reason: true,
          note: true,
          startDate: true,
          endDate: true,
          isActive: true,
        },
      })
    : [];
  const debtStatus = await p.apartmentDebt.groupBy({
    by: ["status"],
    where: { duesDefinitionId: DEF },
    _count: true,
    _sum: { remainingAmount: true, originalAmount: true },
  });
  const allocationCount = await p.paymentAllocation.count({
    where: { apartmentDebt: { duesDefinitionId: DEF } },
  });
  console.log(JSON.stringify({ apt6, exemptions, debtStatus, allocationCount }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
