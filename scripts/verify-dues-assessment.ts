/**
 * Isolated dues definition + charge verification.
 * Never touches real customer sites (e.g. Hanlılar).
 *
 * Run: npx tsx scripts/verify-dues-assessment.ts
 */
import { prisma } from "../src/lib/prisma";
import { duesDefinitionService } from "../src/services/dues.service";
import { HttpError } from "../src/utils/httpError";

const STAMP = Date.now();
const TENANT_NAME = `__verify_dues_assessment_${STAMP}`;
const TENANT_SLUG = `verify-dues-${STAMP}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function cleanup(tenantId: string) {
  await prisma.apartmentDebt.deleteMany({ where: { tenantId } });
  await prisma.duesDefinition.deleteMany({ where: { tenantId } });
  await prisma.apartment.deleteMany({ where: { tenantId } });
  await prisma.building.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function main() {
  const tenant = await prisma.tenant.create({
    data: { name: TENANT_NAME, slug: TENANT_SLUG },
  });

  const site = await prisma.site.create({
    data: {
      tenantId: tenant.id,
      name: `__verify_dues_assessment_site_${STAMP}`,
    },
  });

  const buildingWithApts = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      name: `__verify_dues_assessment_b1_${STAMP}`,
      apartmentCount: 17,
    },
  });

  const emptyBuilding = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      name: `__verify_dues_assessment_empty_${STAMP}`,
      apartmentCount: 17,
    },
  });

  const apartments = await Promise.all(
    Array.from({ length: 17 }, (_, index) =>
      prisma.apartment.create({
        data: {
          tenantId: tenant.id,
          buildingId: buildingWithApts.id,
          number: String(index + 1),
        },
      }),
    ),
  );

  const otherSite = await prisma.site.create({
    data: {
      tenantId: tenant.id,
      name: `__verify_dues_assessment_other_${STAMP}`,
    },
  });
  const otherBuilding = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      siteId: otherSite.id,
      name: `__verify_dues_assessment_other_b_${STAMP}`,
    },
  });
  await prisma.apartment.create({
    data: {
      tenantId: tenant.id,
      buildingId: otherBuilding.id,
      number: "X1",
    },
  });

  try {
    const { dues } = await duesDefinitionService.create(tenant.id, site.id, {
      buildingId: buildingWithApts.id,
      name: "Eylül 2026 Aidatı",
      amount: 2500,
      periodYear: 2026,
      periodMonth: 9,
      dueDate: new Date("2026-09-10"),
      description: "verify",
    });

    const debtsAfterCreate = await prisma.apartmentDebt.count({
      where: { tenantId: tenant.id, duesDefinitionId: dues.id },
    });
    assert(debtsAfterCreate === 0, "Create must not create apartment debts");

    const preview = await duesDefinitionService.getChargePreview(tenant.id, site.id, dues.id);
    assert(preview.activeApartmentCount === 17, `expected 17 active, got ${preview.activeApartmentCount}`);
    assert(preview.pendingChargeCount === 17, `expected 17 pending, got ${preview.pendingChargeCount}`);
    assert(preview.alreadyChargedCount === 0, "expected no already charged");
    assert(
      Number(preview.totalChargeAmount) === 42500,
      `expected 42500 total, got ${preview.totalChargeAmount}`,
    );

    const { dues: emptyDues } = await duesDefinitionService.create(tenant.id, site.id, {
      buildingId: emptyBuilding.id,
      name: "Boş Bina Aidatı",
      amount: 100,
      periodYear: 2026,
      periodMonth: 9,
      dueDate: new Date("2026-09-10"),
    });
    const emptyPreview = await duesDefinitionService.getChargePreview(
      tenant.id,
      site.id,
      emptyDues.id,
    );
    assert(emptyPreview.pendingChargeCount === 0, "empty building should have 0 pending");
    try {
      await duesDefinitionService.chargeApartments(tenant.id, site.id, emptyDues.id);
      throw new Error("empty building charge should fail");
    } catch (error) {
      assert(error instanceof HttpError && error.statusCode === 409, "expected 409 for empty charge");
    }

    try {
      await duesDefinitionService.create(tenant.id, site.id, {
        buildingId: otherBuilding.id,
        name: "Wrong site",
        amount: 10,
        periodYear: 2026,
        periodMonth: 9,
        dueDate: new Date("2026-09-10"),
      });
      throw new Error("other-site building should be rejected");
    } catch (error) {
      assert(error instanceof HttpError, "expected HttpError for cross-site building");
    }

    const charged = await duesDefinitionService.chargeApartments(tenant.id, site.id, dues.id);
    assert(charged.createdCount === 17, `expected 17 debts, got ${charged.createdCount}`);
    assert(Number(charged.totalAmount) === 42500, `expected 42500, got ${charged.totalAmount}`);

    const debtCount = await prisma.apartmentDebt.count({
      where: { tenantId: tenant.id, duesDefinitionId: dues.id, status: "OPEN" },
    });
    assert(debtCount === 17, "all 17 debts must exist after charge");

    const otherSiteDebts = await prisma.apartmentDebt.count({
      where: { tenantId: tenant.id, buildingId: otherBuilding.id },
    });
    assert(otherSiteDebts === 0, "other site apartments must not be charged");

    const preview2 = await duesDefinitionService.getChargePreview(tenant.id, site.id, dues.id);
    assert(preview2.pendingChargeCount === 0, "second charge should have 0 pending");
    assert(preview2.alreadyChargedCount === 17, "all should be already charged");

    try {
      await duesDefinitionService.chargeApartments(tenant.id, site.id, dues.id);
      throw new Error("duplicate charge should fail");
    } catch (error) {
      assert(error instanceof HttpError && error.statusCode === 409, "expected 409 on duplicate charge");
    }

    // Inactive apartment must not be charged on a fresh definition
    await prisma.apartment.update({
      where: { id: apartments[0]!.id },
      data: { isActive: false },
    });
    const { dues: dues2 } = await duesDefinitionService.create(tenant.id, site.id, {
      buildingId: buildingWithApts.id,
      name: "Ekim 2026 Aidatı",
      amount: 1000,
      periodYear: 2026,
      periodMonth: 10,
      dueDate: new Date("2026-10-10"),
    });
    const previewInactive = await duesDefinitionService.getChargePreview(
      tenant.id,
      site.id,
      dues2.id,
    );
    assert(previewInactive.pendingChargeCount === 16, "inactive apartment excluded");
    await duesDefinitionService.chargeApartments(tenant.id, site.id, dues2.id);
    const inactiveDebt = await prisma.apartmentDebt.findFirst({
      where: { duesDefinitionId: dues2.id, apartmentId: apartments[0]!.id },
    });
    assert(!inactiveDebt, "inactive apartment must not receive debt");

    // Soft-delete definition must keep debts
    await duesDefinitionService.remove(tenant.id, site.id, dues.id);
    const keptDebts = await prisma.apartmentDebt.count({
      where: { tenantId: tenant.id, duesDefinitionId: dues.id },
    });
    assert(keptDebts === 17, "archiving definition must not delete debts");

    console.log(
      JSON.stringify(
        {
          ok: true,
          tenant: TENANT_NAME,
          checks: [
            "create_definition_no_debts",
            "17x2500=42500",
            "empty_building_blocked",
            "cross_site_building_blocked",
            "charge_creates_debts",
            "duplicate_charge_409",
            "inactive_excluded",
            "archive_keeps_debts",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup(tenant.id);
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    const leftover = await prisma.tenant.findMany({
      where: { name: { startsWith: "__verify_dues_assessment_" } },
      select: { id: true },
    });
    for (const item of leftover) {
      try {
        await cleanup(item.id);
      } catch {
        // best effort
      }
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
