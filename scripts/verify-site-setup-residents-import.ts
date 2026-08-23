/**
 * Isolated FAZ 19 residents-import check.
 * Never uses preview-session / the operator's real tenant or Hanlılar Sitesi.
 * Creates its own tenant+site, imports, then deletes only what it created.
 *
 * Run: npx tsx scripts/verify-site-setup-residents-import.ts
 */
import { prisma } from "../src/lib/prisma";
import { siteSetupService } from "../src/services/site-setup.service";

const STAMP = Date.now();
const TENANT_NAME = `__verify_site_setup_${STAMP}`;
const TENANT_SLUG = `verify-ss-${STAMP}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
    },
  });

  const site = await prisma.site.create({
    data: {
      tenantId: tenant.id,
      name: `VERIFY Isolated Site ${STAMP}`,
    },
  });

  const building = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      name: "VERIFY Blok",
    },
  });

  const apt1 = await prisma.apartment.create({
    data: { tenantId: tenant.id, buildingId: building.id, number: "1" },
  });
  const apt2 = await prisma.apartment.create({
    data: { tenantId: tenant.id, buildingId: building.id, number: "2" },
  });

  try {
    const preview = await siteSetupService.previewResidentsImport(tenant.id, site.id, [
      {
        apartmentNumber: "1",
        ownerFirstName: "Bulk1",
        ownerLastName: "Owner",
        ownerPhone: "05321000001",
        tenantFirstName: "BulkT1",
        tenantLastName: "Tenant",
        tenantPhone: "05331000001",
      },
      {
        apartmentNumber: "2",
        ownerFirstName: "Bulk2",
        ownerLastName: "Owner",
        ownerPhone: "05321000002",
      },
    ]);

    assert(preview.errorCount === 0, `preview errors: ${JSON.stringify(preview.rows)}`);

    const commit = await siteSetupService.commitResidentsImport(tenant.id, site.id, [
      {
        apartmentNumber: "1",
        ownerFirstName: "Bulk1",
        ownerLastName: "Owner",
        ownerPhone: "05321000001",
        tenantFirstName: "BulkT1",
        tenantLastName: "Tenant",
        tenantPhone: "05331000001",
      },
      {
        apartmentNumber: "2",
        ownerFirstName: "Bulk2",
        ownerLastName: "Owner",
        ownerPhone: "05321000002",
      },
    ]);

    assert(commit.personsCreated === 3, `personsCreated=${commit.personsCreated}`);
    assert(commit.ownersLinked === 2, `ownersLinked=${commit.ownersLinked}`);
    assert(commit.tenantsLinked === 1, `tenantsLinked=${commit.tenantsLinked}`);

    const isolatedPersons = await prisma.person.count({
      where: { tenantId: tenant.id, deletedAt: null },
    });
    assert(isolatedPersons === 3, `isolated person count ${isolatedPersons}`);

    const hanlilarLeak = await prisma.person.count({
      where: {
        deletedAt: null,
        tenantId: { not: tenant.id },
        firstName: "Bulk1",
        lastName: "Owner",
        phone: { contains: "5321000001" },
      },
    });
    assert(hanlilarLeak === 0, "isolated import leaked onto another tenant");

    console.log("verify-site-setup-residents-import: ok", {
      tenantId: tenant.id,
      siteId: site.id,
      apartmentIds: [apt1.id, apt2.id],
      commit,
    });
  } finally {
    await prisma.apartmentPersonRelation.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.person.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.apartment.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.building.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.site.deleteMany({ where: { id: site.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    const leftover = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
    if (leftover) {
      await prisma.apartmentPersonRelation.deleteMany({ where: { tenantId: leftover.id } }).catch(() => undefined);
      await prisma.person.deleteMany({ where: { tenantId: leftover.id } }).catch(() => undefined);
      await prisma.apartment.deleteMany({ where: { tenantId: leftover.id } }).catch(() => undefined);
      await prisma.building.deleteMany({ where: { tenantId: leftover.id } }).catch(() => undefined);
      await prisma.site.deleteMany({ where: { tenantId: leftover.id } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: leftover.id } }).catch(() => undefined);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
