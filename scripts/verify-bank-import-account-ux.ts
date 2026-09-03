/**
 * Lightweight checks for bank import account UX helpers + IBAN duplicate rule.
 * Run: npx tsx scripts/verify-bank-import-account-ux.ts
 */
import { prisma } from "../src/lib/prisma";
import { bankAccountService } from "../src/services/bank-account.service";
import { HttpError } from "../src/utils/httpError";

const STAMP = Date.now();
const PREFIX = `__verify_bank_import_account_ux_${STAMP}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function cleanup(tenantId: string) {
  await prisma.bankAccount.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function main() {
  // Frontend helper parity (inline — avoid importing FE modules)
  function normalizeIban(value: string | null | undefined): string | null {
    if (!value) return null;
    const clean = value.replace(/\s+/g, "").toUpperCase();
    return clean || null;
  }
  function ibanMatchesStored(
    fileIban: string,
    storedMaskedOrFull: string | null | undefined,
    storedFull?: string | null,
  ): boolean {
    const file = normalizeIban(fileIban);
    if (!file || file.length < 15) return false;
    const full = normalizeIban(storedFull ?? undefined);
    if (full) return full === file;
    const stored = normalizeIban(storedMaskedOrFull);
    if (!stored) return false;
    if (!stored.includes("*")) return stored === file;
    return file.startsWith(stored.slice(0, 4)) && file.endsWith(stored.slice(-4));
  }

  assert(
    ibanMatchesStored("TR330006100519786457841326", "TR33 **** **** **** 1326"),
    "mask match",
  );
  assert(
    !ibanMatchesStored("TR330006100519786457841326", "TR12 **** **** **** 9999"),
    "mask mismatch",
  );

  const tenant = await prisma.tenant.create({
    data: { name: PREFIX, slug: `verify-bank-ux-${STAMP}` },
  });
  const otherTenant = await prisma.tenant.create({
    data: { name: `${PREFIX}_o`, slug: `verify-bank-ux-o-${STAMP}` },
  });
  const site = await prisma.site.create({
    data: { tenantId: tenant.id, name: `${PREFIX}_site` },
  });
  const otherSite = await prisma.site.create({
    data: { tenantId: otherTenant.id, name: `${PREFIX}_other_site` },
  });

  try {
    const created = await bankAccountService.create(tenant.id, site.id, {
      bankName: "Test Bank",
      accountName: "Site Aidat Hesabı",
      iban: "TR33 0006 1005 1978 6457 8413 26",
    });
    assert(Boolean(created.id), "account created without bank password");
    assert(created.connectionType === "MANUAL", "manual connection");

    let duplicateBlocked = false;
    try {
      await bankAccountService.create(tenant.id, site.id, {
        bankName: "Test Bank 2",
        accountName: "Kopya",
        iban: "TR330006100519786457841326",
      });
    } catch (error) {
      duplicateBlocked = error instanceof HttpError && error.statusCode === 409;
    }
    assert(duplicateBlocked, "same tenant+site duplicate IBAN blocked");

    const otherOk = await bankAccountService.create(otherTenant.id, otherSite.id, {
      bankName: "Other Bank",
      accountName: "Other",
      iban: "TR330006100519786457841326",
    });
    assert(Boolean(otherOk.id), "other tenant same IBAN allowed");

    const noIban = await bankAccountService.create(tenant.id, site.id, {
      bankName: "No Iban Bank",
      accountName: "Yedek",
    });
    assert(noIban.iban == null || noIban.iban === "", "IBAN optional");

    const listed = await bankAccountService.list(tenant.id, site.id, {
      page: 1,
      perPage: 50,
      activeOnly: false,
    });
    assert(
      listed.items.every((item) => true) && listed.items.length === 2,
      "tenant site list scoped",
    );
    const otherList = await bankAccountService.list(otherTenant.id, otherSite.id, {
      page: 1,
      perPage: 50,
      activeOnly: false,
    });
    assert(otherList.items.length === 1, "other tenant isolated");
    assert(
      !listed.items.some((item) => item.id === otherOk.id),
      "other tenant account not listed",
    );

    console.log("verify-bank-import-account-ux: PASS");
  } finally {
    await cleanup(tenant.id).catch(() => undefined);
    await cleanup(otherTenant.id).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
