/**
 * Isolated bank statement import verification.
 * Never touches real customer data (e.g. Hanlılar).
 *
 * Run: npx tsx scripts/verify-bank-statement-import.ts
 */
import { prisma } from "../src/lib/prisma";
import { bankStatementImportService } from "../src/services/bank-statement-import.service";
import { paymentService } from "../src/services/payment.service";
import { computeBankImportFingerprint } from "../src/utils/bank-fingerprint";
import { suggestStatementMatch } from "../src/utils/bank-statement-match";

const STAMP = Date.now();
const PREFIX = `__verify_bank_statement_import_${STAMP}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function foldTurkish(value: string): string {
  return value
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/Ş/g, "s")
    .replace(/Ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/Ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function normalizeHeaderLocal(value: string): string {
  return foldTurkish(value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " "));
}

function parseCellDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    let year = dmy[3]!;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseMoneyCell(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  let text = String(value).trim().replace(/[₺TL\s]/gi, "");
  text = text.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const neg = text.startsWith("-");
  text = text.replace(/^-/, "");
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  return Number((neg ? -Math.abs(num) : num).toFixed(2));
}

async function cleanup(tenantId: string) {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { tenantId } } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.bankTransaction.deleteMany({ where: { tenantId } });
  await prisma.bankMatchingRule.deleteMany({ where: { tenantId } });
  await prisma.bankColumnMappingTemplate.deleteMany({ where: { tenantId } });
  await prisma.bankAccount.deleteMany({ where: { tenantId } });
  await prisma.apartmentDebt.deleteMany({ where: { tenantId } });
  await prisma.duesDefinition.deleteMany({ where: { tenantId } });
  await prisma.apartmentPersonRelation.deleteMany({ where: { tenantId } });
  await prisma.person.deleteMany({ where: { tenantId } });
  await prisma.apartment.deleteMany({ where: { tenantId } });
  await prisma.building.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function main() {
  // --- Header / parse unit checks (no Excel file) ---
  assert(normalizeHeaderLocal("İşlem Tarihi") === "islem tarihi", "TR header fold");
  assert(normalizeHeaderLocal("  Açıklama ") === "aciklama", "description header");
  assert(parseCellDate("15.09.2026") === "2026-09-15", "DMY date");
  assert(parseCellDate(45950) != null, "excel serial date");
  assert(parseMoneyCell("2.500,00") === 2500, "TR money");
  assert(parseMoneyCell("-1.000") === -1000, "signed money");

  const tenant = await prisma.tenant.create({
    data: { name: PREFIX, slug: `verify-bank-${STAMP}` },
  });
  const otherTenant = await prisma.tenant.create({
    data: { name: `${PREFIX}_other`, slug: `verify-bank-other-${STAMP}` },
  });

  let ok = false;
  try {
    const site = await prisma.site.create({
      data: { tenantId: tenant.id, name: `${PREFIX}_site` },
    });
    const otherSite = await prisma.site.create({
      data: { tenantId: otherTenant.id, name: `${PREFIX}_other_site` },
    });
    const building = await prisma.building.create({
      data: {
        tenantId: tenant.id,
        siteId: site.id,
        name: "B Blok",
        apartmentCount: 5,
      },
    });
    const apt12 = await prisma.apartment.create({
      data: { tenantId: tenant.id, buildingId: building.id, number: "12" },
    });
    const apt5 = await prisma.apartment.create({
      data: { tenantId: tenant.id, buildingId: building.id, number: "5" },
    });
    const person = await prisma.person.create({
      data: {
        tenantId: tenant.id,
        firstName: "Ayşe",
        lastName: "Yılmaz",
      },
    });
    const ambiguousA = await prisma.person.create({
      data: { tenantId: tenant.id, firstName: "Ali", lastName: "Demir" },
    });
    const ambiguousB = await prisma.person.create({
      data: { tenantId: tenant.id, firstName: "Ali", lastName: "Demir" },
    });
    await prisma.apartmentPersonRelation.create({
      data: {
        tenantId: tenant.id,
        apartmentId: apt12.id,
        personId: person.id,
        relationType: "OWNER",
        isActive: true,
      },
    });
    await prisma.apartmentPersonRelation.create({
      data: {
        tenantId: tenant.id,
        apartmentId: apt12.id,
        personId: ambiguousA.id,
        relationType: "TENANT",
        isActive: true,
      },
    });
    await prisma.apartmentPersonRelation.create({
      data: {
        tenantId: tenant.id,
        apartmentId: apt5.id,
        personId: ambiguousB.id,
        relationType: "OWNER",
        isActive: true,
      },
    });

    const bank = await prisma.bankAccount.create({
      data: {
        tenantId: tenant.id,
        siteId: site.id,
        bankName: "Verify Bank",
        accountName: "Ana Hesap",
      },
    });
    const otherBank = await prisma.bankAccount.create({
      data: {
        tenantId: otherTenant.id,
        siteId: otherSite.id,
        bankName: "Other Bank",
        accountName: "Other",
      },
    });

    const duesAug = await prisma.duesDefinition.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        name: "Ağustos 2026 Aidatı",
        amount: 2500,
        periodYear: 2026,
        periodMonth: 8,
        dueDate: new Date("2026-08-10"),
      },
    });
    const duesSep = await prisma.duesDefinition.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        name: "Eylül 2026 Aidatı",
        amount: 2500,
        periodYear: 2026,
        periodMonth: 9,
        dueDate: new Date("2026-09-10"),
      },
    });

    await prisma.apartmentDebt.createMany({
      data: [
        {
          tenantId: tenant.id,
          buildingId: building.id,
          apartmentId: apt12.id,
          duesDefinitionId: duesAug.id,
          type: "DUES",
          title: "Ağustos 2026 Aidatı",
          originalAmount: 2500,
          remainingAmount: 2500,
          dueDate: new Date("2026-08-10"),
          periodYear: 2026,
          periodMonth: 8,
          status: "OPEN",
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          apartmentId: apt12.id,
          duesDefinitionId: duesSep.id,
          type: "DUES",
          title: "Eylül 2026 Aidatı",
          originalAmount: 2500,
          remainingAmount: 2500,
          dueDate: new Date("2026-09-10"),
          periodYear: 2026,
          periodMonth: 9,
          status: "OPEN",
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          apartmentId: apt5.id,
          duesDefinitionId: duesSep.id,
          type: "DUES",
          title: "Eylül 2026 Aidatı",
          originalAmount: 2500,
          remainingAmount: 2500,
          dueDate: new Date("2026-09-10"),
          periodYear: 2026,
          periodMonth: 9,
          status: "OPEN",
        },
      ],
    });

    // Block + apartment match
    const blockMatch = await suggestStatementMatch(
      tenant.id,
      site.id,
      bank.id,
      "FAST HAVALE B Blok Daire 12 AYSE YILMAZ",
    );
    assert(blockMatch.apartmentId === apt12.id, "block+apartment should match apt12");
    assert(blockMatch.confidence === "HIGH", "block match high confidence");

    // Unique name
    const nameMatch = await suggestStatementMatch(
      tenant.id,
      site.id,
      bank.id,
      "EFT Gonderen AYSE YILMAZ aidat",
    );
    assert(nameMatch.apartmentId === apt12.id, "unique name match");
    assert(nameMatch.confidence === "MEDIUM", "name medium confidence");

    // Ambiguous name — must not auto-select
    const amb = await suggestStatementMatch(
      tenant.id,
      site.id,
      bank.id,
      "Havale ALI DEMIR",
    );
    assert(amb.apartmentId == null, "ambiguous name must not auto-match");
    assert(amb.candidateCount > 1, "ambiguous candidate count");

    // Preview: no Payment before commit
    const preview = await bankStatementImportService.preview(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-15",
          direction: "CREDIT",
          amount: 5000,
          description: "B Blok Daire 12 aidat AYSE YILMAZ",
          referenceNo: "REF-5000",
        },
        {
          transactionDate: "2026-09-15",
          direction: "DEBIT",
          amount: 100,
          description: "POS gider",
          referenceNo: "REF-OUT",
        },
        {
          transactionDate: "2026-09-16",
          direction: "CREDIT",
          amount: 1000,
          description: "Bilinmeyen gonderici",
          referenceNo: "REF-UNK",
        },
      ],
    });

    assert(preview.summary.creditCount === 2, "credit count");
    assert(preview.summary.debitCount === 1, "debit count");
    assert(preview.summary.autoMatchedCount === 1, "auto matched");
    const paymentsBefore = await prisma.payment.count({ where: { tenantId: tenant.id } });
    assert(paymentsBefore === 0, "preview must not create payments");

    const matchedPreview = preview.rows.find((r) => r.previewStatus === "READY" && r.match?.apartmentId);
    assert(matchedPreview?.canAutoProcess === true, "full allocation should allow process");
    assert((matchedPreview?.allocationPreview?.length ?? 0) === 2, "split across 2 debts");

    // Commit matched + process
    const commit1 = await bankStatementImportService.commit(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-15",
          direction: "CREDIT",
          amount: 5000,
          description: "B Blok Daire 12 aidat AYSE YILMAZ",
          referenceNo: "REF-5000",
          fingerprint: matchedPreview!.fingerprint,
          matchedApartmentId: apt12.id,
          matchedPersonId: person.id,
          processPayment: true,
        },
        {
          transactionDate: "2026-09-15",
          direction: "DEBIT",
          amount: 100,
          description: "POS gider",
          referenceNo: "REF-OUT",
          processPayment: false,
        },
        {
          transactionDate: "2026-09-16",
          direction: "CREDIT",
          amount: 1000,
          description: "Bilinmeyen gonderici",
          referenceNo: "REF-UNK",
          processPayment: false,
          createRule: false,
        },
      ],
    });

    assert(commit1.createdCount === 3, `created 3 got ${commit1.createdCount}`);
    assert(commit1.processedPayments === 1, "one payment processed");

    const debtsAfter = await prisma.apartmentDebt.findMany({
      where: { tenantId: tenant.id, apartmentId: apt12.id },
      orderBy: { dueDate: "asc" },
    });
    assert(
      debtsAfter.every((d) => Number(d.remainingAmount) === 0 && d.status === "PAID"),
      "apt12 debts fully paid",
    );

    // Duplicate fingerprint
    const fp = computeBankImportFingerprint({
      transactionDate: "2026-09-15",
      direction: "CREDIT",
      amount: 5000,
      description: "B Blok Daire 12 aidat AYSE YILMAZ",
      referenceNo: "REF-5000",
    });
    const previewDup = await bankStatementImportService.preview(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-15",
          direction: "CREDIT",
          amount: 5000,
          description: "B Blok Daire 12 aidat AYSE YILMAZ",
          referenceNo: "REF-5000",
        },
      ],
    });
    assert(previewDup.rows[0]?.previewStatus === "DUPLICATE", "duplicate flagged");
    assert(previewDup.rows[0]?.fingerprint === fp, "fingerprint stable");

    const commitDup = await bankStatementImportService.commit(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-15",
          direction: "CREDIT",
          amount: 5000,
          description: "B Blok Daire 12 aidat AYSE YILMAZ",
          referenceNo: "REF-5000",
          fingerprint: fp,
          processPayment: true,
          matchedApartmentId: apt12.id,
        },
      ],
    });
    assert(commitDup.duplicateSkipped === 1, "duplicate skipped on commit");
    assert(commitDup.createdCount === 0, "no second create");

    // Other tenant same reference must not block
    const otherPreview = await bankStatementImportService.preview(otherTenant.id, otherSite.id, {
      bankAccountId: otherBank.id,
      rows: [
        {
          transactionDate: "2026-09-15",
          direction: "CREDIT",
          amount: 5000,
          description: "B Blok Daire 12 aidat AYSE YILMAZ",
          referenceNo: "REF-5000",
        },
      ],
    });
    assert(otherPreview.rows[0]?.previewStatus !== "DUPLICATE", "other tenant not blocked");

    // Manual match + rule + partial payment on apt5
    const commitPartial = await bankStatementImportService.commit(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-20",
          direction: "CREDIT",
          amount: 1000,
          description: "Gonderen Ali Demir ozel",
          referenceNo: "REF-PARTIAL",
          matchedApartmentId: apt5.id,
          processPayment: true,
          createRule: true,
          containsText: "Ali Demir ozel",
          ruleName: "Ali Demir kural",
        },
      ],
    });
    assert(commitPartial.processedPayments === 1, "partial processed");
    const apt5Debt = await prisma.apartmentDebt.findFirst({
      where: { tenantId: tenant.id, apartmentId: apt5.id },
    });
    assert(Number(apt5Debt?.remainingAmount) === 1500, "partial remaining 1500");
    assert(apt5Debt?.status === "OPEN", "still open");

    const ruleMatch = await suggestStatementMatch(
      tenant.id,
      site.id,
      bank.id,
      "Yeni hareket Ali Demir ozel aidat",
    );
    assert(ruleMatch.apartmentId === apt5.id, "rule remembered");
    assert(ruleMatch.confidence === "HIGH", "rule high");

    // Overpayment blocked (avans) — leave matched without payment
    await prisma.apartmentDebt.update({
      where: { id: apt5Debt!.id },
      data: { remainingAmount: 500, status: "OPEN" },
    });
    const over = await bankStatementImportService.commit(tenant.id, site.id, {
      bankAccountId: bank.id,
      rows: [
        {
          transactionDate: "2026-09-21",
          direction: "CREDIT",
          amount: 2000,
          description: "fazla odeme B Blok Daire 5",
          referenceNo: "REF-OVER",
          matchedApartmentId: apt5.id,
          processPayment: true,
        },
      ],
    });
    assert(over.createdCount === 1, "overpayment tx created");
    assert(over.processedPayments === 0, "overpayment not processed");
    assert(over.matchedWithoutPayment === 1, "matched without payment");

    // Cancel payment restores debts
    const payment = await prisma.payment.findFirst({
      where: { tenantId: tenant.id, apartmentId: apt12.id, status: "COMPLETED" },
      select: { id: true },
    });
    assert(payment != null, "payment exists for cancel");
    await paymentService.cancel(tenant.id, site.id, payment!.id);
    const debtsRestored = await prisma.apartmentDebt.findMany({
      where: { tenantId: tenant.id, apartmentId: apt12.id },
    });
    assert(
      debtsRestored.every((d) => Number(d.remainingAmount) === 2500 && d.status === "OPEN"),
      "cancel restores debts",
    );
    const bankTx = await prisma.bankTransaction.findFirst({
      where: { tenantId: tenant.id, referenceNo: "REF-5000" },
    });
    assert(bankTx?.matchStatus === "MATCHED", "bank tx back to MATCHED");
    assert(bankTx?.paymentId == null, "payment unlinked");

    // Column template isolation
    await bankStatementImportService.createColumnTemplate(tenant.id, site.id, {
      name: "Verify Template",
      bankAccountId: bank.id,
      mapping: { date: "Tarih", description: "Açıklama", credit: "Alacak", debit: "Borç" },
    });
    const templatesOther = await bankStatementImportService.listColumnTemplates(
      otherTenant.id,
      otherSite.id,
    );
    assert(templatesOther.items.length === 0, "other tenant cannot see templates");

    ok = true;
    console.log("verify-bank-statement-import: PASS");
  } finally {
    await cleanup(tenant.id).catch(() => undefined);
    await cleanup(otherTenant.id).catch(() => undefined);
    if (!ok) console.error("verify-bank-statement-import: FAIL (cleaned up)");
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
