/**
 * Geçici tenant ile daire listesi zenginleştirme + aidat muafiyeti doğrulaması.
 * Hanlılar verisine dokunmaz. Bitince temizler.
 */
import {
  ApartmentDuesExemptionReason,
  ApartmentDuesExemptionType,
  PrismaClient,
} from "@prisma/client";
import { apartmentService } from "../src/services/apartment.service";
import { apartmentDuesExemptionService } from "../src/services/apartment-dues-exemption.service";
import { duesDefinitionService } from "../src/services/dues.service";

const prisma = new PrismaClient();
const PREFIX = "__verify_apt_exemption_";

async function main() {
  const stamp = Date.now();
  const actor = await prisma.user.create({
    data: {
      email: `${PREFIX}${stamp}@example.test`,
      passwordHash: "x",
      fullName: "Verify Actor",
    },
  });

  const tenant = await prisma.tenant.create({
    data: { name: `${PREFIX}${stamp}`, slug: `${PREFIX}${stamp}` },
  });

  const site = await prisma.site.create({
    data: { tenantId: tenant.id, name: "Verify Site" },
  });

  const building = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      name: "A Blok",
    },
  });

  const apts = [];
  for (let i = 1; i <= 3; i++) {
    apts.push(
      await prisma.apartment.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          number: String(i),
          floor: String(i),
          roomType: "2+1",
          squareMeters: 90,
        },
      }),
    );
  }

  const owner = await prisma.person.create({
    data: {
      tenantId: tenant.id,
      firstName: "Ali",
      lastName: "Malik",
      phone: "5550000001",
    },
  });
  const tenantPerson = await prisma.person.create({
    data: {
      tenantId: tenant.id,
      firstName: "Veli",
      lastName: "Kiraci",
      phone: "5550000002",
    },
  });

  await prisma.apartmentPersonRelation.create({
    data: {
      tenantId: tenant.id,
      apartmentId: apts[0]!.id,
      personId: owner.id,
      relationType: "OWNER",
      isActive: true,
      isPrimary: true,
    },
  });
  await prisma.apartmentPersonRelation.create({
    data: {
      tenantId: tenant.id,
      apartmentId: apts[1]!.id,
      personId: owner.id,
      relationType: "OWNER",
      isActive: true,
    },
  });
  await prisma.apartmentPersonRelation.create({
    data: {
      tenantId: tenant.id,
      apartmentId: apts[1]!.id,
      personId: tenantPerson.id,
      relationType: "TENANT",
      isActive: true,
      isPrimary: true,
    },
  });

  const listed = await apartmentService.list(tenant.id, site.id, { page: 1, perPage: 50 });
  const byNumber = Object.fromEntries(listed.items.map((item) => [item.number, item]));

  const checks: Record<string, boolean> = {
    ownerVisibleApt1: byNumber["1"]?.ownerLabel === "Ali Malik",
    residentOwnerOccupied: byNumber["1"]?.residentLabel === "Malik oturuyor",
    tenantVisibleApt2: byNumber["2"]?.residentLabel === "Veli Kiraci",
    occupancyTenant: byNumber["2"]?.occupancy === "TENANT_OCCUPIED",
    vacantApt3: byNumber["3"]?.occupancy === "VACANT",
  };

  await apartmentDuesExemptionService.create(tenant.id, site.id, apts[0]!.id, actor.id, {
    exemptionType: ApartmentDuesExemptionType.FULL,
    value: null,
    startDate: new Date(Date.UTC(2026, 8, 1)),
    endDate: new Date(Date.UTC(2026, 8, 30)),
    reason: ApartmentDuesExemptionReason.MANAGER,
    note: "temp",
  });

  const scopeIn = await duesDefinitionService.getChargeScopePreview(tenant.id, site.id, {
    buildingId: building.id,
    periodYear: 2026,
    periodMonth: 9,
    amount: 2500,
  });
  checks.exemptInPeriod = scopeIn.exemptCount === 1 && scopeIn.pendingChargeCount === 2;
  checks.totalInPeriod = scopeIn.totalChargeAmount === "5000.00";

  const scopeOut = await duesDefinitionService.getChargeScopePreview(tenant.id, site.id, {
    buildingId: building.id,
    periodYear: 2026,
    periodMonth: 10,
    amount: 2500,
  });
  checks.normalOutsidePeriod = scopeOut.exemptCount === 0 && scopeOut.pendingChargeCount === 3;

  const created = await duesDefinitionService.create(tenant.id, site.id, {
    buildingId: building.id,
    name: "Eylul Test",
    amount: 2500,
    periodYear: 2026,
    periodMonth: 9,
    dueDate: new Date(Date.UTC(2026, 8, 15)),
    chargeImmediately: true,
  });
  checks.createdDebts = created.createdCount === 2;

  const debtsBeforeRevoke = await prisma.apartmentDebt.count({
    where: { tenantId: tenant.id, duesDefinitionId: created.dues.id },
  });
  checks.noFakeZeroDebt = debtsBeforeRevoke === 2;

  const exemptions = await apartmentDuesExemptionService.listForApartment(
    tenant.id,
    site.id,
    apts[0]!.id,
  );
  const activeId = exemptions.items.find((item) => item.isActive)?.id;
  if (activeId) {
    await apartmentDuesExemptionService.revoke(tenant.id, site.id, activeId, actor.id);
  }

  const afterRevoke = await duesDefinitionService.getChargeScopePreview(tenant.id, site.id, {
    buildingId: building.id,
    periodYear: 2026,
    periodMonth: 11,
    amount: 2500,
  });
  checks.afterRevokeFuture = afterRevoke.exemptCount === 0 && afterRevoke.pendingChargeCount === 3;

  const debtsUnchanged = await prisma.apartmentDebt.count({
    where: { tenantId: tenant.id, duesDefinitionId: created.dues.id },
  });
  checks.pastDebtsPreserved = debtsUnchanged === 2;

  const otherTenant = await prisma.tenant.create({
    data: { name: `${PREFIX}other_${stamp}`, slug: `${PREFIX}other_${stamp}` },
  });
  const otherPerson = await prisma.person.create({
    data: {
      tenantId: otherTenant.id,
      firstName: "Leak",
      lastName: "Person",
      phone: "5559999999",
    },
  });
  // Attempt cross-tenant relation should not appear even if forced wrongly:
  // We only verify list scopes by tenantId.
  const listedAgain = await apartmentService.list(tenant.id, site.id, { page: 1, perPage: 50 });
  checks.noOtherTenantPerson = listedAgain.items.every(
    (item) =>
      !(item.owners ?? []).some((p) => p.id === otherPerson.id) &&
      !(item.tenants ?? []).some((p) => p.id === otherPerson.id),
  );

  console.log(JSON.stringify({ checks, failed: Object.entries(checks).filter(([, ok]) => !ok) }, null, 2));

  await prisma.apartmentDebt.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.duesDefinition.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.apartmentDuesExemption.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.apartmentPersonRelation.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.apartment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.person.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
  await prisma.building.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.site.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
  await prisma.user.deleteMany({ where: { id: actor.id } });

  if (Object.values(checks).some((ok) => !ok)) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
