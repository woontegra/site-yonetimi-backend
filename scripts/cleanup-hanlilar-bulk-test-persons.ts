/**
 * One-shot cleanup: fake Bulk* Owner / BulkT* Tenant persons written to
 * Hanlılar Sitesi B Blok during an ad-hoc FAZ 19.2 import/commit probe.
 * Does not wipe apartments, debts, payments, or real residents.
 */
import { prisma } from "../src/lib/prisma";

const SITE_NAME = "Hanlılar Sitesi B Blok";
const OWNER_NAME = /^Bulk\d+$/;
const TENANT_NAME = /^BulkT\d+$/;
const OWNER_PHONE = /^\+9053220000\d{2}$/;
const TENANT_PHONE = /^\+9053320000\d{2}$/;

function isFakeBulkPerson(person: { firstName: string; lastName: string; phone: string | null }) {
  if (person.lastName === "Owner" && OWNER_NAME.test(person.firstName) && person.phone && OWNER_PHONE.test(person.phone)) {
    return true;
  }
  if (person.lastName === "Tenant" && TENANT_NAME.test(person.firstName) && person.phone && TENANT_PHONE.test(person.phone)) {
    return true;
  }
  return false;
}

async function extraLinks(personId: string, tenantId: string) {
  const [payments, bankTx, bankRules, visits, feedback, messages] = await Promise.all([
    prisma.payment.count({ where: { personId, tenantId } }),
    prisma.bankTransaction.count({ where: { matchedPersonId: personId, tenantId } }),
    prisma.bankMatchingRule.count({ where: { personId, tenantId, deletedAt: null } }),
    prisma.visit.count({ where: { hostPersonId: personId, tenantId } }),
    prisma.feedbackRecord.count({ where: { personId, tenantId, deletedAt: null } }),
    prisma.communicationMessage.count({ where: { personId, tenantId } }),
  ]);
  return { payments, bankTx, bankRules, visits, feedback, messages };
}

async function main() {
  const site = await prisma.site.findFirst({
    where: { name: SITE_NAME, deletedAt: null },
    select: { id: true, tenantId: true, name: true },
  });
  if (!site) {
    throw new Error(`${SITE_NAME} bulunamadı.`);
  }

  const apartmentIds = (
    await prisma.apartment.findMany({
      where: {
        tenantId: site.tenantId,
        deletedAt: null,
        building: { siteId: site.id, deletedAt: null },
      },
      select: { id: true },
    })
  ).map((row) => row.id);

  const apartmentCountBefore = apartmentIds.length;
  const debtCountBefore = await prisma.apartmentDebt.count({
    where: { tenantId: site.tenantId, apartmentId: { in: apartmentIds } },
  });
  const paymentCountBefore = await prisma.payment.count({
    where: { tenantId: site.tenantId, apartmentId: { in: apartmentIds } },
  });
  const expenseCountBefore = await prisma.expense.count({
    where: { tenantId: site.tenantId, siteId: site.id },
  });

  const candidates = await prisma.person.findMany({
    where: {
      tenantId: site.tenantId,
      deletedAt: null,
      OR: [
        { firstName: { startsWith: "Bulk" }, lastName: "Owner" },
        { firstName: { startsWith: "BulkT" }, lastName: "Tenant" },
      ],
    },
    include: {
      relations: {
        include: {
          apartment: {
            select: {
              id: true,
              number: true,
              building: { select: { name: true, siteId: true } },
            },
          },
        },
      },
    },
  });

  const deletable: typeof candidates = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const person of candidates) {
    const name = `${person.firstName} ${person.lastName}`;
    if (!isFakeBulkPerson(person)) {
      skipped.push({ name, reason: "isim/telefon kalıbı kesin sahte değil" });
      continue;
    }

    const offSite = person.relations.filter((rel) => rel.apartment.building.siteId !== site.id);
    if (offSite.length > 0) {
      skipped.push({ name, reason: "başka sitede daire ilişkisi var" });
      continue;
    }

    const links = await extraLinks(person.id, person.tenantId);
    const extraTotal = Object.values(links).reduce((sum, n) => sum + n, 0);
    if (extraTotal > 0) {
      skipped.push({ name, reason: `finans/işlem ilişkisi var: ${JSON.stringify(links)}` });
      continue;
    }

    deletable.push(person);
  }

  const relationIds = deletable.flatMap((person) => person.relations.map((rel) => rel.id));
  const personIds = deletable.map((person) => person.id);

  await prisma.$transaction(async (tx) => {
    if (relationIds.length > 0) {
      await tx.apartmentPersonRelation.deleteMany({ where: { id: { in: relationIds } } });
    }
    if (personIds.length > 0) {
      await tx.person.updateMany({
        where: { id: { in: personIds } },
        data: { deletedAt: new Date(), isActive: false },
      });
    }
  });

  const apartmentCountAfter = await prisma.apartment.count({
    where: {
      tenantId: site.tenantId,
      deletedAt: null,
      building: { siteId: site.id, deletedAt: null },
    },
  });
  const remainingFake = await prisma.person.count({
    where: {
      tenantId: site.tenantId,
      deletedAt: null,
      OR: [
        { firstName: { startsWith: "Bulk" }, lastName: "Owner" },
        { firstName: { startsWith: "BulkT" }, lastName: "Tenant" },
      ],
    },
  });
  const debtCountAfter = await prisma.apartmentDebt.count({
    where: { tenantId: site.tenantId, apartmentId: { in: apartmentIds } },
  });
  const paymentCountAfter = await prisma.payment.count({
    where: { tenantId: site.tenantId, apartmentId: { in: apartmentIds } },
  });
  const expenseCountAfter = await prisma.expense.count({
    where: { tenantId: site.tenantId, siteId: site.id },
  });

  console.log(
    JSON.stringify(
      {
        site: site.name,
        personsDeleted: personIds.length,
        relationsDeleted: relationIds.length,
        skipped,
        remainingActiveFakePersons: remainingFake,
        apartmentsBefore: apartmentCountBefore,
        apartmentsAfter: apartmentCountAfter,
        debtsUnchanged: debtCountBefore === debtCountAfter,
        paymentsUnchanged: paymentCountBefore === paymentCountAfter,
        expensesUnchanged: expenseCountBefore === expenseCountAfter,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
