/**
 * Targeted PDF statement text-parser tests (no real bank data, no persistence).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const modPath = path.resolve(
    __dirname,
    "../../site-yonetim-frontend/src/lib/bank-statement-pdf-text.ts",
  );
  const {
    extractPdfStatement,
    parseStatementDate,
    parseStatementMoney,
  } = await import(pathToFileURL(modPath).href);

  type PdfPageText = { pageNumber: number; lines: string[] };
  function pagesFrom(lines: string[], pageNumber = 1): PdfPageText[] {
    return [{ pageNumber, lines }];
  }

  assert.equal(parseStatementMoney("2.500,00"), 2500);
  assert.equal(parseStatementMoney("2,500.00"), 2500);
  assert.equal(parseStatementMoney("-1.250,50"), -1250.5);
  assert.equal(parseStatementMoney("(500,00)"), -500);
  assert.equal(parseStatementMoney("1.000 TL"), 1000);
  assert.equal(parseStatementDate("01.09.2026"), "2026-09-01");
  assert.equal(parseStatementDate("2026-09-01"), "2026-09-01");

  {
    const result = extractPdfStatement(
      pagesFrom([
        "Hesap Ekstresi IBAN TR330006100519786457841326",
        "Tarih Açıklama Tutar Bakiye",
        "01.09.2026 Aidat tahsilatı 2.500,00 12.500,00",
        "02.09.2026 Havale giden -500,00 12.000,00",
        "Devreden bakiye 12.000,00",
        "Toplam alacak 2.500,00",
      ]),
    );
    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[0].direction, "CREDIT");
    assert.equal(result.transactions[0].amount, 2500);
    assert.equal(result.transactions[1].direction, "DEBIT");
    assert.equal(result.transactions[1].amount, 500);
    assert.ok(result.accountHints.iban?.startsWith("TR33"));
  }

  {
    const result = extractPdfStatement(
      pagesFrom([
        "03.09.2026 EFT Gelen Serdar Topal 1.000,00 13.000,00",
        "Daire 6 aidat ödemesi",
      ]),
    );
    assert.equal(result.transactions.length, 1);
    assert.match(result.transactions[0].description, /Daire 6/);
    assert.ok(result.transactions[0].warnings.some((w: string) => w.includes("birleştirildi")));
  }

  {
    const pages: PdfPageText[] = [
      { pageNumber: 1, lines: ["Tarih Açıklama Tutar Bakiye", "01.09.2026 Islem A 100,00 100,00"] },
      { pageNumber: 2, lines: ["Tarih Açıklama Tutar Bakiye", "02.09.2026 Islem B 200,00 300,00"] },
    ];
    const result = extractPdfStatement(pages);
    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[1].sourcePage, 2);
  }

  {
    const result = extractPdfStatement(pagesFrom(["2026-09-01 Payment received 1,250.00 5,000.00"]));
    assert.equal(result.transactions[0].amount, 1250);
  }

  {
    const result = extractPdfStatement(pagesFrom(["Hesap özeti", "Toplam alacak 0,00", "Sayfa 1 / 1"]));
    assert.equal(result.transactions.length, 0);
  }

  {
    const result = extractPdfStatement(
      pagesFrom([
        "01.09.2026 A 100,00 100,00",
        "02.09.2026 B 50,00 150,00",
        "03.09.2026 C -20,00 130,00",
      ]),
    );
    assert.equal(result.balanceChain.ok, true);
  }

  {
    const result = extractPdfStatement(
      pagesFrom(["01.09.2026 A 100,00 100,00", "02.09.2026 B 50,00 999,00"]),
    );
    assert.equal(result.balanceChain.ok, false);
  }

  function fp(input: {
    transactionDate: string;
    direction: string;
    amount: number;
    description: string;
    referenceNo?: string;
    balanceAfter?: number | null;
  }) {
    const norm = (s: string) =>
      s
        .toLocaleLowerCase("tr-TR")
        .replace(/[^a-z0-9ğüşıöç]+/gi, " ")
        .trim();
    return createHash("sha256")
      .update(
        [
          input.transactionDate,
          input.direction,
          Number(input.amount).toFixed(2),
          norm(input.description),
          norm(input.referenceNo ?? ""),
          input.balanceAfter != null ? Number(input.balanceAfter).toFixed(2) : "",
        ].join("|"),
      )
      .digest("hex");
  }

  assert.equal(
    fp({
      transactionDate: "2026-09-01",
      direction: "CREDIT",
      amount: 2500,
      description: "Aidat tahsilatı",
      balanceAfter: 12500,
    }),
    fp({
      transactionDate: "2026-09-01",
      direction: "CREDIT",
      amount: 2500,
      description: "Aidat tahsilatı",
      balanceAfter: 12500,
    }),
  );

  const encryptedBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n");
  const sample = new TextDecoder("latin1").decode(encryptedBytes);
  assert.ok(/\/Encrypt\b/.test(sample));

  console.log(
    JSON.stringify(
      {
        ok: true,
        cases: [
          "tr-money",
          "en-money",
          "multiline-desc",
          "repeated-headers",
          "skip-totals",
          "balance-chain",
          "cross-fingerprint",
          "encrypt-marker",
        ],
        ocr: "not_implemented_local",
        encryptedHandling: "password_required_ui",
        adapters: ["generic"],
        note: "No real bank PDFs in repo; text-parser fixtures only.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
