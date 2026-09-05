import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportType } from "../validators/reports.validators";

type ExportMeta = {
  reportTitle: string;
  siteName: string;
  generatedAt: Date;
  dateFrom?: string | null;
  dateTo?: string | null;
  filterLines?: string[];
};

function fontPaths() {
  const root = path.resolve(__dirname, "..", "..", "assets", "fonts");
  return {
    regular: path.join(root, "DejaVuSans.ttf"),
    bold: path.join(root, "DejaVuSans-Bold.ttf"),
  };
}

function formatMoneyTr(value: number): string {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₺`;
}

function formatDateTr(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function formatDateTimeTr(value: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function safeFileSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "rapor";
}

export function buildExportFilename(
  reportType: ReportType,
  siteName: string,
  format: "pdf" | "xlsx",
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safeFileSlug(reportType)}_${safeFileSlug(siteName)}_${stamp}.${format}`;
}

type TableColumn = { key: string; header: string; width?: number; money?: boolean; date?: boolean };

async function buildPdfBuffer(input: {
  meta: ExportMeta;
  summaryLines?: string[];
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
  landscape?: boolean;
}): Promise<Buffer> {
  const fonts = fontPaths();
  if (!fs.existsSync(fonts.regular) || !fs.existsSync(fonts.bold)) {
    throw new Error("PDF_FONT_MISSING");
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: input.landscape ? "landscape" : "portrait",
    margin: 36,
    bufferPages: true,
    info: {
      Title: input.meta.reportTitle,
      Author: "Site Yönetimi",
    },
  });

  doc.registerFont("TR", fonts.regular);
  doc.registerFont("TR-Bold", fonts.bold);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font("TR-Bold").fontSize(14).text(input.meta.reportTitle, { align: "left" });
  doc.moveDown(0.3);
  doc.font("TR").fontSize(9);
  doc.text(`Site: ${input.meta.siteName}`);
  doc.text(
    `Tarih aralığı: ${formatDateTr(input.meta.dateFrom)} – ${formatDateTr(input.meta.dateTo)}`,
  );
  doc.text(`Oluşturulma: ${formatDateTimeTr(input.meta.generatedAt)}`);
  if (input.meta.filterLines?.length) {
    doc.text(`Filtreler: ${input.meta.filterLines.join(" · ")}`);
  }
  doc.moveDown(0.4);

  if (input.summaryLines?.length) {
    doc.font("TR-Bold").fontSize(10).text("Özet");
    doc.font("TR").fontSize(9);
    for (const line of input.summaryLines) doc.text(line);
    doc.moveDown(0.5);
  }

  const colCount = input.columns.length;
  const colWidth = pageWidth / Math.max(1, colCount);
  const headerHeight = 18;

  function drawTableHeader() {
    const y = doc.y;
    doc.font("TR-Bold").fontSize(8);
    input.columns.forEach((col, index) => {
      doc.text(col.header, doc.page.margins.left + index * colWidth, y, {
        width: colWidth - 4,
        ellipsis: true,
      });
    });
    doc
      .moveTo(doc.page.margins.left, y + headerHeight - 4)
      .lineTo(doc.page.margins.left + pageWidth, y + headerHeight - 4)
      .strokeColor("#cbd5e1")
      .stroke();
    doc.y = y + headerHeight;
  }

  drawTableHeader();
  doc.font("TR").fontSize(8);

  for (const row of input.rows) {
    const cells = input.columns.map((col) => {
      const raw = row[col.key];
      if (raw == null || raw === "") return "—";
      if (col.money && typeof raw === "number") return formatMoneyTr(raw);
      if (col.date) return formatDateTr(String(raw));
      return String(raw);
    });

    const heights = cells.map((text) =>
      doc.heightOfString(text, { width: colWidth - 4 }),
    );
    const rowHeight = Math.max(14, ...heights) + 4;
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 24) {
      doc.addPage();
      drawTableHeader();
      doc.font("TR").fontSize(8);
    }

    const y = doc.y;
    cells.forEach((text, index) => {
      doc.text(text, doc.page.margins.left + index * colWidth, y, {
        width: colWidth - 4,
      });
    });
    doc.y = y + rowHeight;
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .font("TR")
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        `Sayfa ${i - range.start + 1} / ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 28,
        { width: pageWidth, align: "center" },
      );
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  return Buffer.concat(chunks);
}

async function buildXlsxBuffer(input: {
  sheets: Array<{
    name: string;
    title: string;
    metaLines: string[];
    summaryLines?: string[];
    columns: TableColumn[];
    rows: Array<Record<string, string | number | null | undefined>>;
  }>;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Site Yönetimi";
  workbook.created = new Date();

  for (const sheet of input.sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    let rowIndex = 1;
    ws.getRow(rowIndex).getCell(1).value = sheet.title;
    ws.getRow(rowIndex).font = { bold: true, size: 14 };
    rowIndex += 1;
    for (const line of sheet.metaLines) {
      ws.getRow(rowIndex).getCell(1).value = line;
      rowIndex += 1;
    }
    if (sheet.summaryLines?.length) {
      rowIndex += 1;
      ws.getRow(rowIndex).getCell(1).value = "Özet";
      ws.getRow(rowIndex).font = { bold: true };
      rowIndex += 1;
      for (const line of sheet.summaryLines) {
        ws.getRow(rowIndex).getCell(1).value = line;
        rowIndex += 1;
      }
    }
    rowIndex += 1;
    const headerRowIndex = rowIndex;
    const headerRow = ws.getRow(headerRowIndex);
    sheet.columns.forEach((col, index) => {
      headerRow.getCell(index + 1).value = col.header;
      headerRow.getCell(index + 1).font = { bold: true };
      headerRow.getCell(index + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
    });
    headerRow.commit();
    rowIndex += 1;

    for (const data of sheet.rows) {
      const row = ws.getRow(rowIndex);
      sheet.columns.forEach((col, index) => {
        const cell = row.getCell(index + 1);
        const raw = data[col.key];
        if (raw == null || raw === "") {
          cell.value = null;
          return;
        }
        if (col.money && typeof raw === "number") {
          cell.value = raw;
          cell.numFmt = '#,##0.00 "₺"';
          return;
        }
        if (col.date) {
          const d = new Date(String(raw));
          if (!Number.isNaN(d.getTime())) {
            cell.value = d;
            cell.numFmt = "dd.mm.yyyy";
            return;
          }
        }
        cell.value = String(raw);
        cell.alignment = { wrapText: true, vertical: "top" };
      });
      row.commit();
      rowIndex += 1;
    }

    sheet.columns.forEach((col, index) => {
      const width = Math.min(40, Math.max(12, col.width ?? col.header.length + 4));
      ws.getColumn(index + 1).width = width;
    });

    ws.views = [{ state: "frozen", ySplit: headerRowIndex }];
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: sheet.columns.length },
    };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function dateRangeLine(meta: ExportMeta) {
  return `Tarih aralığı: ${formatDateTr(meta.dateFrom)} – ${formatDateTr(meta.dateTo)}`;
}

export async function exportFinancialSummary(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["financialSummary"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Mali Durum Özeti",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
  };
  const summaryLines = [
    `Tahakkuk: ${data.summary.accrualTotal}`,
    `Tahsilat: ${data.summary.collectionTotal}`,
    `Gider: ${data.summary.expenseTotal}`,
    `Açık borç: ${data.summary.openDebtTotal}`,
    `Tahsilat oranı: ${data.summary.collectionRate == null ? "—" : `%${data.summary.collectionRate}`}`,
    `Tahsilat − Gider: ${data.summary.collectionVsExpense}`,
  ];

  if (format === "pdf") {
    return buildPdfBuffer({
      meta,
      summaryLines,
      columns: [
        { key: "periodLabel", header: "Dönem" },
        { key: "accrualNum", header: "Tahakkuk", money: true },
        { key: "collectionNum", header: "Tahsilat", money: true },
        { key: "expenseNum", header: "Gider", money: true },
      ],
      rows: data.monthly,
    });
  }

  return buildXlsxBuffer({
    sheets: [
      {
        name: "Özet",
        title: meta.reportTitle,
        metaLines: [`Site: ${meta.siteName}`, dateRangeLine(meta), `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`],
        summaryLines,
        columns: [
          { key: "label", header: "Kalem" },
          { key: "value", header: "Değer" },
        ],
        rows: [
          { label: "Tahakkuk", value: data.summary.accrualTotalNum },
          { label: "Tahsilat", value: data.summary.collectionTotalNum },
          { label: "Gider", value: data.summary.expenseTotalNum },
          { label: "Açık borç", value: data.summary.openDebtTotalNum },
          {
            label: "Tahsilat oranı (%)",
            value: data.summary.collectionRate,
          },
          { label: "Tahsilat − Gider", value: data.summary.collectionVsExpenseNum },
          ...data.paymentMethods.map((m) => ({
            label: `Ödeme yöntemi: ${m.methodLabel}`,
            value: m.amountNum,
          })),
        ],
      },
      {
        name: "Aylık Hareketler",
        title: "Aylık tahakkuk / tahsilat / gider",
        metaLines: [`Site: ${meta.siteName}`, dateRangeLine(meta)],
        columns: [
          { key: "periodLabel", header: "Dönem", width: 18 },
          { key: "accrualNum", header: "Tahakkuk", money: true },
          { key: "collectionNum", header: "Tahsilat", money: true },
          { key: "expenseNum", header: "Gider", money: true },
        ],
        rows: data.monthly,
      },
    ],
  });
}

export async function exportApartmentDebts(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["apartmentDebts"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Daire Borç Durumu",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
    filterLines: [`Borç filtresi: ${data.filters.debtFilter}`],
  };
  const summaryLines = [
    `Borçlu daire: ${data.summary.indebtedApartmentCount}`,
    `Toplam açık borç: ${data.summary.openDebtTotal}`,
    `Gecikmiş borç: ${data.summary.overdueTotal}`,
    `Tahsil edilmiş: ${data.summary.collectedTotal}`,
  ];
  const columns: TableColumn[] = [
    { key: "apartmentLabel", header: "Daire", width: 22 },
    { key: "ownerName", header: "Malik", width: 18 },
    { key: "tenantName", header: "Kiracı / sakin", width: 18 },
    { key: "totalDebtNum", header: "Toplam borç", money: true },
    { key: "paidNum", header: "Ödenen", money: true },
    { key: "remainingNum", header: "Kalan", money: true },
    { key: "oldestOpenDueDate", header: "En eski açık", date: true },
    { key: "overdueNum", header: "Gecikmiş", money: true },
    { key: "statusLabel", header: "Durum", width: 12 },
  ];
  const rows = data.items.map((item) => ({
    ...item,
    ownerName: item.ownerName ?? "—",
    tenantName: item.tenantName ?? item.displayPerson,
  }));

  if (format === "pdf") {
    return buildPdfBuffer({ meta, summaryLines, columns, rows, landscape: true });
  }
  return buildXlsxBuffer({
    sheets: [
      {
        name: "Daire Borçları",
        title: meta.reportTitle,
        metaLines: [
          `Site: ${meta.siteName}`,
          dateRangeLine(meta),
          `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`,
          ...(meta.filterLines ?? []),
        ],
        summaryLines,
        columns,
        rows,
      },
    ],
  });
}

export async function exportPayments(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["payments"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Tahsilat Raporu",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
  };
  const summaryLines = [
    `Toplam tahsilat: ${data.summary.totalAmount}`,
    `Kayıt: ${data.summary.count}`,
    `İptal: ${data.summary.cancelledCount}`,
  ];
  const columns: TableColumn[] = [
    { key: "paymentDate", header: "Ödeme tarihi", date: true },
    { key: "apartmentLabel", header: "Bina / daire", width: 20 },
    { key: "personName", header: "Malik / sakin", width: 18 },
    { key: "amountNum", header: "Tutar", money: true },
    { key: "paymentMethodLabel", header: "Yöntem", width: 14 },
    { key: "description", header: "Açıklama", width: 24 },
    { key: "source", header: "Kaynak", width: 14 },
    { key: "allocationsText", header: "Dağıtım", width: 28 },
    { key: "statusLabel", header: "Durum", width: 12 },
  ];
  const rows = data.items.map((item) => ({
    paymentDate: item.paymentDate,
    apartmentLabel: item.apartmentLabel,
    personName: item.personName,
    amountNum: item.amountNum,
    paymentMethodLabel: item.paymentMethodLabel,
    description: item.description,
    source: item.source,
    allocationsText: item.allocations.map((a) => `${a.debtTitle}: ${a.amount}`).join("; "),
    statusLabel: item.statusLabel,
  }));

  if (format === "pdf") {
    return buildPdfBuffer({ meta, summaryLines, columns, rows, landscape: true });
  }
  return buildXlsxBuffer({
    sheets: [
      {
        name: "Tahsilatlar",
        title: meta.reportTitle,
        metaLines: [`Site: ${meta.siteName}`, dateRangeLine(meta), `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`],
        summaryLines,
        columns,
        rows,
      },
    ],
  });
}

export async function exportExpenses(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["expenses"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Gider Raporu",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
  };
  const summaryLines = [
    `Toplam gider: ${data.summary.totalAmount}`,
    `En yüksek tür: ${data.summary.topExpenseType}`,
    `Kayıt: ${data.summary.count}`,
    `Aylık ortalama: ${data.summary.monthlyAverage}`,
  ];
  const columns: TableColumn[] = [
    { key: "expenseDate", header: "Gider tarihi", date: true },
    { key: "expenseTypeName", header: "Gider türü", width: 16 },
    { key: "title", header: "Açıklama", width: 24 },
    { key: "supplierName", header: "Tedarikçi", width: 16 },
    { key: "amountNum", header: "Tutar", money: true },
    { key: "paymentMethodLabel", header: "Yöntem", width: 14 },
    { key: "bankInfo", header: "Banka/kasa", width: 20 },
    { key: "referenceNo", header: "Belge no", width: 14 },
    { key: "statusLabel", header: "Durum", width: 12 },
  ];
  if (format === "pdf") {
    return buildPdfBuffer({ meta, summaryLines, columns, rows: data.items, landscape: true });
  }
  return buildXlsxBuffer({
    sheets: [
      {
        name: "Giderler",
        title: meta.reportTitle,
        metaLines: [`Site: ${meta.siteName}`, dateRangeLine(meta), `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`],
        summaryLines,
        columns,
        rows: data.items,
      },
    ],
  });
}

export async function exportBankTransactions(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["bankTransactions"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Banka Hareketleri",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
  };
  const summaryLines = [
    `Gelen: ${data.summary.incomingTotal}`,
    `Giden: ${data.summary.outgoingTotal}`,
    `Kayıt: ${data.summary.count}`,
  ];
  const columns: TableColumn[] = [
    { key: "transactionDate", header: "İşlem tarihi", date: true },
    { key: "bankAccountLabel", header: "Banka hesabı", width: 22 },
    { key: "description", header: "Açıklama", width: 28 },
    { key: "incomingNum", header: "Gelen", money: true },
    { key: "outgoingNum", header: "Giden", money: true },
    { key: "apartmentLabel", header: "Daire", width: 18 },
    { key: "personName", header: "Malik / sakin", width: 16 },
    { key: "confidence", header: "Güven", width: 10 },
    { key: "matchStatusLabel", header: "Durum", width: 12 },
    { key: "linkLabel", header: "Bağlantı", width: 12 },
  ];
  if (format === "pdf") {
    return buildPdfBuffer({
      meta,
      summaryLines,
      columns,
      rows: data.items.map((item) => ({
        transactionDate: item.transactionDate,
        bankAccountLabel: item.bankAccountLabel,
        description: item.description,
        incomingNum: item.incomingNum || null,
        outgoingNum: item.outgoingNum || null,
        apartmentLabel: item.apartmentLabel,
        personName: item.personName,
        confidence: item.confidence,
        matchStatusLabel: item.matchStatusLabel,
        linkLabel: item.linkLabel,
      })),
      landscape: true,
    });
  }
  return buildXlsxBuffer({
    sheets: [
      {
        name: "Banka Hareketleri",
        title: meta.reportTitle,
        metaLines: [`Site: ${meta.siteName}`, dateRangeLine(meta), `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`],
        summaryLines,
        columns,
        rows: data.items.map((item) => ({
          transactionDate: item.transactionDate,
          bankAccountLabel: item.bankAccountLabel,
          description: item.description,
          incomingNum: item.incomingNum || null,
          outgoingNum: item.outgoingNum || null,
          apartmentLabel: item.apartmentLabel,
          personName: item.personName,
          confidence: item.confidence,
          matchStatusLabel: item.matchStatusLabel,
          linkLabel: item.linkLabel,
        })),
      },
    ],
  });
}

export async function exportApartmentStatement(
  data: Awaited<ReturnType<import("./reports.service").ReportsService["apartmentStatement"]>>,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  const meta: ExportMeta = {
    reportTitle: "Daire Hesap Ekstresi",
    siteName: data.site.name,
    generatedAt: new Date(data.generatedAt),
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
    filterLines: [
      data.apartment.label,
      `Malik: ${data.apartment.ownerName ?? "—"}`,
      `Sakin: ${data.apartment.tenantName ?? data.apartment.displayPerson}`,
    ],
  };
  const summaryLines = [
    `Önceki dönem devri: ${data.summary.openingBalance}`,
    `Dönem borç: ${data.summary.periodDebit}`,
    `Dönem tahsilat: ${data.summary.periodCredit}`,
    `Kapanış bakiyesi: ${data.summary.closingBalance}`,
  ];
  const columns: TableColumn[] = [
    { key: "date", header: "Tarih", date: true },
    { key: "typeLabel", header: "İşlem türü", width: 16 },
    { key: "description", header: "Açıklama", width: 36 },
    { key: "debitNum", header: "Borç", money: true },
    { key: "creditNum", header: "Tahsilat", money: true },
    { key: "balanceNum", header: "Bakiye", money: true },
  ];

  if (format === "pdf") {
    return buildPdfBuffer({ meta, summaryLines, columns, rows: data.items, landscape: true });
  }
  return buildXlsxBuffer({
    sheets: [
      {
        name: "Hesap Özeti",
        title: meta.reportTitle,
        metaLines: [
          `Site: ${meta.siteName}`,
          data.apartment.label,
          dateRangeLine(meta),
          `Oluşturulma: ${formatDateTimeTr(meta.generatedAt)}`,
        ],
        summaryLines,
        columns: [
          { key: "label", header: "Kalem" },
          { key: "value", header: "Tutar", money: true },
        ],
        rows: [
          { label: "Önceki dönem devri", value: data.summary.openingBalanceNum },
          { label: "Dönem borç", value: data.items.reduce((s, i) => s + i.debitNum, 0) },
          { label: "Dönem tahsilat", value: data.items.reduce((s, i) => s + i.creditNum, 0) },
          { label: "Kapanış bakiyesi", value: data.summary.closingBalanceNum },
        ],
      },
      {
        name: "Hareketler",
        title: "Hareket dökümü",
        metaLines: [`Site: ${meta.siteName}`, data.apartment.label, dateRangeLine(meta)],
        columns,
        rows: data.items,
      },
    ],
  });
}
