import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { computeBankImportFingerprint, suggestMatchPattern } from "../utils/bank-fingerprint";
import {
  loadStatementMatchContext,
  suggestStatementMatch,
  suggestStatementMatchFromContext,
} from "../utils/bank-statement-match";
import { assertApartmentInSite, assertBankAccountInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import { paymentService } from "./payment.service";
import { buildAutoAllocations } from "../utils/bank-auto-allocate";
import type {
  BankStatementCommitInput,
  BankStatementPreviewInput,
  CreateBankColumnTemplateInput,
  UpdateBankColumnTemplateInput,
} from "../validators/bank-statement.validators";

export type PreviewRowStatus =
  | "READY"
  | "DUPLICATE"
  | "INVALID"
  | "DEBIT_SKIP_PAYMENT"
  | "AMBIGUOUS";

function parseDateOnly(value: string): Date {
  const iso = value.slice(0, 10);
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Geçersiz tarih: ${value}`);
  }
  return date;
}

function logPreviewStage(
  requestId: string,
  stage: string,
  startedAt: number,
  extra: Record<string, string | number | boolean | null> = {},
) {
  const elapsedMs = Date.now() - startedAt;
  console.info(
    JSON.stringify({
      scope: "bank_statement_preview",
      requestId,
      stage,
      elapsedMs,
      ...extra,
    }),
  );
}

export class BankStatementImportService {
  async preview(tenantId: string, siteId: string, input: BankStatementPreviewInput) {
    const requestId = `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    logPreviewStage(requestId, "received", startedAt, {
      rowCount: input.rows.length,
      fileType: "json_rows",
    });

    await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);
    logPreviewStage(requestId, "account_validated", startedAt);

    if (input.rows.length === 0) {
      throw new HttpError(400, "Önizlenecek satır yok.");
    }
    if (input.rows.length > 5000) {
      throw new HttpError(400, "Tek seferde en fazla 5000 satır içe aktarılabilir.");
    }

    const fingerprints = input.rows.map((row) =>
      computeBankImportFingerprint({
        transactionDate: row.transactionDate,
        direction: row.direction,
        amount: row.amount,
        description: row.description,
        referenceNo: row.referenceNo,
        balanceAfter: row.balanceAfter,
      }),
    );

    const existing = await prisma.bankTransaction.findMany({
      where: {
        tenantId,
        bankAccountId: input.bankAccountId,
        importFingerprint: { in: fingerprints },
      },
      select: { importFingerprint: true, id: true, paymentId: true },
    });
    const existingSet = new Set(existing.map((item) => item.importFingerprint).filter(Boolean));
    logPreviewStage(requestId, "duplicates_loaded", startedAt, {
      existingCount: existing.length,
    });

    // Tek seferlik site bağlamı — satır başına rules/apartments/relations sorgusu YOK.
    const matchCtx = await loadStatementMatchContext(tenantId, siteId, input.bankAccountId);
    logPreviewStage(requestId, "match_context_loaded", startedAt, {
      ruleCount: matchCtx.rules.length,
      apartmentCount: matchCtx.apartments.length,
      relationCount: matchCtx.relations.length,
    });

    type DebtRow = {
      id: string;
      apartmentId: string;
      remainingAmount: Prisma.Decimal;
      dueDate: Date;
      duesDefinition: { name: string; periodYear: number; periodMonth: number } | null;
    };

    const provisionalMatches: Array<{
      index: number;
      apartmentId: string | null;
      match: ReturnType<typeof suggestStatementMatchFromContext>;
    }> = [];

    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index]!;
      if (!row.description?.trim() || !row.transactionDate || !(row.amount > 0)) continue;
      if (existingSet.has(fingerprints[index]!)) continue;
      if (row.direction !== "CREDIT") continue;
      const match = suggestStatementMatchFromContext(matchCtx, row.description);
      provisionalMatches.push({ index, apartmentId: match.apartmentId, match });
    }

    const apartmentIdsForDebts = [
      ...new Set(
        provisionalMatches
          .filter(
            (item) =>
              item.match.matchStatus === "SUGGESTED" &&
              item.apartmentId &&
              (item.match.confidence === "HIGH" || item.match.confidence === "MEDIUM"),
          )
          .map((item) => item.apartmentId!),
      ),
    ];

    const debtsByApartment = new Map<string, DebtRow[]>();
    if (apartmentIdsForDebts.length > 0) {
      const debts = await prisma.apartmentDebt.findMany({
        where: {
          tenantId,
          apartmentId: { in: apartmentIdsForDebts },
          status: "OPEN",
          building: { siteId, deletedAt: null },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          apartmentId: true,
          remainingAmount: true,
          dueDate: true,
          duesDefinition: { select: { name: true, periodYear: true, periodMonth: true } },
        },
      });
      for (const debt of debts) {
        const list = debtsByApartment.get(debt.apartmentId) ?? [];
        list.push(debt);
        debtsByApartment.set(debt.apartmentId, list);
      }
    }
    logPreviewStage(requestId, "debts_loaded", startedAt, {
      matchedApartmentCount: apartmentIdsForDebts.length,
      debtCount: [...debtsByApartment.values()].reduce((sum, list) => sum + list.length, 0),
    });

    const matchByIndex = new Map(provisionalMatches.map((item) => [item.index, item.match]));

    const rows = [];
    let creditCount = 0;
    let debitCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let autoMatchedCount = 0;
    let unmatchedCount = 0;
    let importableCreditTotal = new Prisma.Decimal(0);

    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index]!;
      const fingerprint = fingerprints[index]!;

      if (!row.description?.trim() || !row.transactionDate || !(row.amount > 0)) {
        invalidCount += 1;
        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "INVALID" as PreviewRowStatus,
          match: null,
          suggestedPattern: null,
          message: "Eksik veya geçersiz satır",
        });
        continue;
      }

      if (row.direction === "CREDIT") creditCount += 1;
      else debitCount += 1;

      if (existingSet.has(fingerprint)) {
        duplicateCount += 1;
        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "DUPLICATE" as PreviewRowStatus,
          match: null,
          suggestedPattern: null,
          message: "Mükerrer — daha önce içe aktarıldı",
        });
        continue;
      }

      if (row.direction === "DEBIT") {
        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "DEBIT_SKIP_PAYMENT" as PreviewRowStatus,
          match: null,
          suggestedPattern: null,
          message: "Giden hareket — otomatik tahsilat yapılmaz",
        });
        continue;
      }

      const match =
        matchByIndex.get(index) ??
        suggestStatementMatchFromContext(matchCtx, row.description);

      // Otomatik: tek gerçek apartmentId + HIGH/MEDIUM güven (metinsel aday / NONE sayılmaz).
      if (
        match.matchStatus === "SUGGESTED" &&
        match.apartmentId &&
        (match.confidence === "HIGH" || match.confidence === "MEDIUM")
      ) {
        autoMatchedCount += 1;
        importableCreditTotal = importableCreditTotal.add(new Prisma.Decimal(row.amount));

        const debts = debtsByApartment.get(match.apartmentId) ?? [];
        let left = new Prisma.Decimal(row.amount);
        const allocationPreview: Array<{
          apartmentDebtId: string;
          label: string;
          amount: string;
        }> = [];
        for (const debt of debts) {
          if (left.lte(0)) break;
          const take = Prisma.Decimal.min(debt.remainingAmount, left);
          if (take.lte(0)) continue;
          const label =
            debt.duesDefinition?.name ||
            `${debt.duesDefinition?.periodMonth ?? "?"}/${debt.duesDefinition?.periodYear ?? "?"}`;
          allocationPreview.push({
            apartmentDebtId: debt.id,
            label,
            amount: toMoneyString(take),
          });
          left = left.sub(take);
        }

        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "READY" as PreviewRowStatus,
          match,
          suggestedPattern: suggestMatchPattern(row.description),
          message: match.reason,
          allocationPreview,
          allocationRemainder: toMoneyString(left),
          canAutoProcess: left.eq(0) && allocationPreview.length > 0,
        });
      } else if (match.candidateCount > 1) {
        unmatchedCount += 1;
        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "AMBIGUOUS" as PreviewRowStatus,
          match,
          suggestedPattern: suggestMatchPattern(row.description),
          message: match.reason,
        });
      } else {
        unmatchedCount += 1;
        rows.push({
          rowIndex: index,
          ...row,
          fingerprint,
          previewStatus: "READY" as PreviewRowStatus,
          match: { ...match, matchStatus: "UNMATCHED" as const },
          suggestedPattern: suggestMatchPattern(row.description),
          message: match.reason,
        });
      }
    }

    logPreviewStage(requestId, "response_ready", startedAt, {
      rowCount: rows.length,
      creditCount,
      debitCount,
      autoMatchedCount,
    });

    return {
      summary: {
        totalRows: input.rows.length,
        creditCount,
        debitCount,
        invalidCount,
        duplicateCount,
        autoMatchedCount,
        unmatchedCount,
        importableCreditTotal: toMoneyString(importableCreditTotal),
      },
      rows,
    };
  }

  async commit(tenantId: string, siteId: string, input: BankStatementCommitInput) {
    await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);

    const account = await prisma.bankAccount.findFirst({
      where: {
        id: input.bankAccountId,
        tenantId,
        siteId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) throw new HttpError(404, "Banka hesabı bulunamadı.");

    type PreparedRow = {
      fingerprint: string;
      transactionDate: Date;
      valueDate: Date | null;
      direction: "CREDIT" | "DEBIT";
      amount: number;
      description: string;
      referenceNo: string | null;
      balanceAfter: number | null;
      matchedApartmentId: string | null;
      matchedPersonId: string | null;
      matchStatus: "UNMATCHED" | "SUGGESTED" | "MATCHED";
      buildingId: string | null;
      processPayment: boolean;
      createRule: boolean;
      containsText: string | null;
      ruleName: string | null;
    };

    const prepared: PreparedRow[] = [];

    for (const row of input.rows) {
      if (row.skip) continue;

      const fingerprint =
        row.fingerprint ||
        computeBankImportFingerprint({
          transactionDate: row.transactionDate,
          direction: row.direction,
          amount: row.amount,
          description: row.description,
          referenceNo: row.referenceNo,
          balanceAfter: row.balanceAfter,
        });

      let matchedApartmentId = row.matchedApartmentId ?? null;
      let matchedPersonId = row.matchedPersonId ?? null;
      let matchStatus: "UNMATCHED" | "SUGGESTED" | "MATCHED" = "UNMATCHED";
      let buildingId: string | null = null;

      // Giden hareketler aidat/daire eşleşmesine girmez.
      if (row.direction === "DEBIT") {
        matchedApartmentId = null;
        matchedPersonId = null;
        matchStatus = "UNMATCHED";
      } else if (matchedApartmentId) {
        const apartment = await assertApartmentInSite(tenantId, siteId, matchedApartmentId);
        buildingId = apartment.buildingId;
        matchStatus = "MATCHED";
      } else if (row.direction === "CREDIT") {
        const suggestion = await suggestStatementMatch(
          tenantId,
          siteId,
          input.bankAccountId,
          row.description,
        );
        if (
          suggestion.matchStatus === "SUGGESTED" &&
          suggestion.apartmentId &&
          suggestion.confidence !== "LOW"
        ) {
          matchedApartmentId = suggestion.apartmentId;
          matchedPersonId = suggestion.personId;
          buildingId = suggestion.buildingId;
          matchStatus = "SUGGESTED";
        }
      }

      if (matchedApartmentId && !buildingId) {
        const apartment = await assertApartmentInSite(tenantId, siteId, matchedApartmentId);
        buildingId = apartment.buildingId;
      }

      prepared.push({
        fingerprint,
        transactionDate: parseDateOnly(row.transactionDate),
        valueDate: row.valueDate ? parseDateOnly(row.valueDate) : null,
        direction: row.direction,
        amount: row.amount,
        description: row.description.trim(),
        referenceNo: row.referenceNo?.trim() || null,
        balanceAfter: row.balanceAfter ?? null,
        matchedApartmentId,
        matchedPersonId,
        matchStatus,
        buildingId,
        processPayment: row.direction === "CREDIT" && row.processPayment === true,
        createRule: Boolean(
          row.direction === "CREDIT" &&
            row.createRule &&
            row.containsText?.trim() &&
            matchedApartmentId,
        ),
        containsText: row.containsText?.trim() || null,
        ruleName: row.ruleName?.trim() || null,
      });
    }

    let createdCount = 0;
    let duplicateSkipped = 0;
    let processedPayments = 0;
    let matchedWithoutPayment = 0;
    const createdIds: string[] = [];

    await prisma.$transaction(
      async (tx) => {
        for (const row of prepared) {
          const existing = await tx.bankTransaction.findFirst({
            where: {
              tenantId,
              bankAccountId: input.bankAccountId,
              importFingerprint: row.fingerprint,
            },
            select: { id: true },
          });
          if (existing) {
            duplicateSkipped += 1;
            continue;
          }

          if (row.createRule && row.containsText && row.matchedApartmentId && row.buildingId) {
            await tx.bankMatchingRule.create({
              data: {
                tenantId,
                siteId,
                bankAccountId: input.bankAccountId,
                name: row.ruleName || `Kural: ${row.containsText}`,
                containsText: row.containsText,
                buildingId: row.buildingId,
                apartmentId: row.matchedApartmentId,
                personId: row.matchedPersonId,
                priority: 50,
                isActive: true,
              },
            });
          }

          const created = await tx.bankTransaction.create({
            data: {
              tenantId,
              bankAccountId: input.bankAccountId,
              importFingerprint: row.fingerprint,
              externalTransactionId: row.referenceNo,
              transactionDate: row.transactionDate,
              valueDate: row.valueDate,
              direction: row.direction,
              amount: new Prisma.Decimal(row.amount),
              description: row.description,
              referenceNo: row.referenceNo,
              balanceAfter:
                row.balanceAfter != null ? new Prisma.Decimal(row.balanceAfter) : null,
              status: "ACTIVE",
              matchStatus: row.matchStatus,
              debitClass: row.direction === "DEBIT" ? "UNCLASSIFIED" : null,
              matchedApartmentId: row.matchedApartmentId,
              matchedPersonId: row.matchedPersonId,
              matchedAt: row.matchedApartmentId ? new Date() : null,
            },
            select: { id: true },
          });

          createdCount += 1;
          createdIds.push(created.id);

          const shouldProcess =
            row.processPayment &&
            row.direction === "CREDIT" &&
            Boolean(row.matchedApartmentId) &&
            (row.matchStatus === "MATCHED" || row.matchStatus === "SUGGESTED");

          if (shouldProcess && row.matchedApartmentId) {
            const allocations = await buildAutoAllocations(
              tx,
              tenantId,
              siteId,
              row.matchedApartmentId,
              new Prisma.Decimal(row.amount),
            );

            if (!allocations) {
              matchedWithoutPayment += 1;
              continue;
            }

            const paymentId = await paymentService.createWithinTransaction(tx, tenantId, siteId, {
              apartmentId: row.matchedApartmentId,
              personId: row.matchedPersonId ?? undefined,
              amount: Number(row.amount),
              paymentDate: row.transactionDate,
              paymentMethod: "BANK_TRANSFER",
              referenceNo: row.referenceNo ?? undefined,
              description: row.description,
              allocations,
            });

            await tx.bankTransaction.update({
              where: { id: created.id },
              data: {
                paymentId,
                matchStatus: "PROCESSED",
                processedAt: new Date(),
              },
            });
            processedPayments += 1;
          } else if (row.matchedApartmentId) {
            matchedWithoutPayment += 1;
          }
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    return {
      createdCount,
      duplicateSkipped,
      processedPayments,
      matchedWithoutPayment,
      createdIds,
    };
  }

  async listColumnTemplates(tenantId: string, siteId: string, bankAccountId?: string) {
    const items = await prisma.bankColumnMappingTemplate.findMany({
      where: {
        tenantId,
        siteId,
        deletedAt: null,
        ...(bankAccountId
          ? { OR: [{ bankAccountId }, { bankAccountId: null }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        mapping: true,
        createdAt: true,
        updatedAt: true,
        bankAccount: { select: { id: true, bankName: true, accountName: true } },
      },
    });
    return { items };
  }

  async createColumnTemplate(
    tenantId: string,
    siteId: string,
    input: CreateBankColumnTemplateInput,
  ) {
    if (input.bankAccountId) {
      await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);
    }
    const created = await prisma.bankColumnMappingTemplate.create({
      data: {
        tenantId,
        siteId,
        bankAccountId: input.bankAccountId ?? null,
        name: input.name.trim(),
        mapping: input.mapping,
      },
      select: {
        id: true,
        name: true,
        mapping: true,
        createdAt: true,
        updatedAt: true,
        bankAccount: { select: { id: true, bankName: true, accountName: true } },
      },
    });
    return created;
  }

  async updateColumnTemplate(
    tenantId: string,
    siteId: string,
    id: string,
    input: UpdateBankColumnTemplateInput,
  ) {
    const current = await prisma.bankColumnMappingTemplate.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Kolon şablonu bulunamadı.");

    if (input.bankAccountId) {
      await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);
    }

    return prisma.bankColumnMappingTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.mapping !== undefined ? { mapping: input.mapping } : {}),
        ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
      },
      select: {
        id: true,
        name: true,
        mapping: true,
        createdAt: true,
        updatedAt: true,
        bankAccount: { select: { id: true, bankName: true, accountName: true } },
      },
    });
  }

  async deleteColumnTemplate(tenantId: string, siteId: string, id: string) {
    const result = await prisma.bankColumnMappingTemplate.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new HttpError(404, "Kolon şablonu bulunamadı.");
  }

  async summary(tenantId: string, siteId: string) {
    const accountWhere = { tenantId, siteId, deletedAt: null };
    const txWhere = {
      tenantId,
      bankAccount: { siteId, deletedAt: null },
      status: "ACTIVE" as const,
    };

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [accounts, pendingMatch, unmatched, unclassifiedDebit, processedThisMonth, expensesThisMonth] =
      await Promise.all([
      prisma.bankAccount.count({ where: { ...accountWhere, isActive: true } }),
      prisma.bankTransaction.count({
        where: {
          ...txWhere,
          direction: "CREDIT",
          matchStatus: { in: ["SUGGESTED", "MATCHED"] },
          paymentId: null,
        },
      }),
      prisma.bankTransaction.count({
        where: { ...txWhere, matchStatus: "UNMATCHED", direction: "CREDIT" },
      }),
      prisma.bankTransaction.count({
        where: {
          ...txWhere,
          direction: "DEBIT",
          OR: [{ debitClass: "UNCLASSIFIED" }, { debitClass: null }],
          expenseId: null,
        },
      }),
      prisma.bankTransaction.count({
        where: {
          ...txWhere,
          direction: "CREDIT",
          matchStatus: "PROCESSED",
          processedAt: { gte: monthStart },
        },
      }),
      prisma.bankTransaction.count({
        where: {
          ...txWhere,
          direction: "DEBIT",
          debitClass: "EXPENSE",
          expenseId: { not: null },
          processedAt: { gte: monthStart },
        },
      }),
    ]);

    return {
      accounts,
      pendingMatch,
      unmatched,
      unmatchedCredit: unmatched,
      unclassifiedDebit,
      processedThisMonth,
      expensesThisMonth,
    };
  }
}

export const bankStatementImportService = new BankStatementImportService();
