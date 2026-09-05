import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { suggestStatementMatch, type StatementMatchKind } from "../utils/bank-statement-match";
import { buildAutoAllocations } from "../utils/bank-auto-allocate";
import {
  allocateAmountAgainstProvisional,
  loadOpenDebtsForApartment,
  planApartmentBatchAllocations,
  sortBatchTransactions,
  type ApartmentBatchPlan,
  type BatchTxInput,
} from "../utils/bank-batch-allocate";
import {
  assertApartmentInSite,
  assertBankAccountInSite,
  assertBuildingInSite,
} from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  ClassifyBankDebitInput,
  CreateBankTransactionInput,
  ListBankTransactionsQuery,
  MatchBankTransactionInput,
  ProcessBankTransactionInput,
} from "../validators/bank.validators";
import { paymentService } from "./payment.service";

const BULK_SAFE_KINDS = new Set<StatementMatchKind>([
  "RULE",
  "FULL_NAME_OWNER",
  "FULL_NAME_TENANT",
  "NAME_AND_APARTMENT",
]);

function isRiskySuggestion(kind: StatementMatchKind, nameMismatch: boolean, confidence: string): boolean {
  if (nameMismatch) return true;
  if (confidence !== "HIGH") return true;
  return !BULK_SAFE_KINDS.has(kind);
}

/** Banka açıklamasından gönderen görünen adı (dağıtımı etkilemez). */
function senderLabelFromBankDescription(description: string, fallback: string | null): string {
  const parts = description
    .split("*")
    .map((p) => p.trim())
    .filter(Boolean);
  const noise =
    /eyl[uü]l|ekim|kas[iı]m|aral[iı]k|ocak|subat|şubat|mart|nisan|may[iı]s|haziran|temmuz|a[gğ]ustos|aidat|site|daire|\bno\b|\d{4}/i;
  const candidates = parts.filter(
    (p) => !noise.test(p) && !/^\d+$/.test(p) && /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(p),
  );
  const pick = candidates[0] ?? parts[0] ?? description.slice(0, 48);
  return (pick || fallback || "Gönderen").replace(/\s+/g, " ").trim();
}

const txSelect = {
  id: true,
  transactionDate: true,
  valueDate: true,
  direction: true,
  amount: true,
  description: true,
  senderName: true,
  senderIban: true,
  referenceNo: true,
  balanceAfter: true,
  status: true,
  matchStatus: true,
  debitClass: true,
  matchedAt: true,
  processedAt: true,
  ignoredAt: true,
  importedAt: true,
  createdAt: true,
  updatedAt: true,
  paymentId: true,
  expenseId: true,
  bankAccount: {
    select: { id: true, bankName: true, accountName: true },
  },
  matchedApartment: {
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true } },
    },
  },
  matchedPerson: {
    select: { id: true, firstName: true, lastName: true },
  },
  payment: {
    select: { id: true, amount: true, status: true },
  },
  expense: {
    select: { id: true, title: true, amount: true, status: true },
  },
} satisfies Prisma.BankTransactionSelect;

function mapTx(row: {
  id: string;
  transactionDate: Date;
  valueDate: Date | null;
  direction: "CREDIT" | "DEBIT";
  amount: Prisma.Decimal;
  description: string;
  senderName: string | null;
  senderIban: string | null;
  referenceNo: string | null;
  balanceAfter: Prisma.Decimal | null;
  status: "ACTIVE" | "IGNORED";
  matchStatus: "UNMATCHED" | "SUGGESTED" | "MATCHED" | "PROCESSED";
  debitClass: "UNCLASSIFIED" | "EXPENSE" | "EXCLUDED" | null;
  matchedAt: Date | null;
  processedAt: Date | null;
  ignoredAt: Date | null;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  paymentId: string | null;
  expenseId: string | null;
  bankAccount: { id: string; bankName: string; accountName: string };
  matchedApartment: {
    id: string;
    number: string;
    building: { id: string; name: string };
  } | null;
  matchedPerson: { id: string; firstName: string; lastName: string } | null;
  payment: { id: string; amount: Prisma.Decimal; status: string } | null;
  expense: { id: string; title: string; amount: Prisma.Decimal; status: string } | null;
}) {
  return {
    id: row.id,
    transactionDate: row.transactionDate,
    valueDate: row.valueDate,
    direction: row.direction,
    amount: toMoneyString(row.amount),
    description: row.description,
    senderName: row.senderName,
    senderIban: row.senderIban,
    referenceNo: row.referenceNo,
    balanceAfter: row.balanceAfter ? toMoneyString(row.balanceAfter) : null,
    status: row.status,
    matchStatus: row.matchStatus,
    debitClass: row.debitClass,
    matchedAt: row.matchedAt,
    processedAt: row.processedAt,
    ignoredAt: row.ignoredAt,
    importedAt: row.importedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bankAccount: row.bankAccount,
    matchedApartment: row.matchedApartment
      ? {
          id: row.matchedApartment.id,
          number: row.matchedApartment.number,
          building: row.matchedApartment.building,
        }
      : null,
    matchedPerson: row.matchedPerson
      ? {
          id: row.matchedPerson.id,
          fullName: `${row.matchedPerson.firstName} ${row.matchedPerson.lastName}`.trim(),
        }
      : null,
    payment: row.payment
      ? {
          id: row.payment.id,
          amount: toMoneyString(row.payment.amount),
          status: row.payment.status,
        }
      : null,
    expense: row.expense
      ? {
          id: row.expense.id,
          title: row.expense.title,
          amount: toMoneyString(row.expense.amount),
          status: row.expense.status,
        }
      : null,
  };
}

async function applyMatchingRules(
  tenantId: string,
  siteId: string,
  bankAccountId: string,
  description: string,
): Promise<{ apartmentId: string | null; personId: string | null; matchStatus: "UNMATCHED" | "SUGGESTED" }> {
  const suggestion = await suggestStatementMatch(tenantId, siteId, bankAccountId, description);
  if (
    suggestion.matchStatus === "SUGGESTED" &&
    suggestion.apartmentId &&
    suggestion.confidence !== "LOW"
  ) {
    return {
      apartmentId: suggestion.apartmentId,
      personId: suggestion.personId,
      matchStatus: "SUGGESTED",
    };
  }
  return { apartmentId: null, personId: null, matchStatus: "UNMATCHED" };
}

const siteAccountWhere = (siteId: string) =>
  ({ bankAccount: { siteId, deletedAt: null } }) as const;

export class BankTransactionService {
  async list(tenantId: string, siteId: string, query: ListBankTransactionsQuery) {
    const where: Prisma.BankTransactionWhereInput = {
      tenantId,
      ...siteAccountWhere(siteId),
    };
    if (query.bankAccountId) where.bankAccountId = query.bankAccountId;
    if (query.direction) where.direction = query.direction;
    if (query.matchStatus) where.matchStatus = query.matchStatus;
    if (query.debitClass) where.debitClass = query.debitClass;
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.transactionDate = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: "insensitive" } },
        { senderName: { contains: query.search, mode: "insensitive" } },
        { referenceNo: { contains: query.search, mode: "insensitive" } },
        { senderIban: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.bankTransaction.findMany({
        where,
        select: txSelect,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return {
      items: rows.map(mapTx),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: txSelect,
    });
    if (!row) throw new HttpError(404, "Banka hareketi bulunamadı.");
    return mapTx(row);
  }

  async createManual(tenantId: string, siteId: string, input: CreateBankTransactionInput) {
    await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);

    const account = await prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, tenantId, siteId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!account) throw new HttpError(404, "Banka hesabı bulunamadı.");

    const match = await applyMatchingRules(tenantId, siteId, input.bankAccountId, input.description);
    const isDebit = input.direction === "DEBIT";

    const row = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: input.bankAccountId,
        transactionDate: input.transactionDate,
        direction: input.direction,
        amount: new Prisma.Decimal(input.amount),
        description: input.description.trim(),
        senderName: input.senderName,
        senderIban: input.senderIban?.replace(/\s+/g, "").toUpperCase(),
        referenceNo: input.referenceNo,
        status: "ACTIVE",
        matchStatus: isDebit ? "UNMATCHED" : match.matchStatus,
        debitClass: isDebit ? "UNCLASSIFIED" : null,
        matchedApartmentId: isDebit ? null : match.apartmentId,
        matchedPersonId: isDebit ? null : match.personId,
        matchedAt: !isDebit && match.matchStatus === "SUGGESTED" ? new Date() : null,
      },
      select: txSelect,
    });

    return mapTx(row);
  }

  async match(tenantId: string, siteId: string, id: string, input: MatchBankTransactionInput) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        direction: true,
        bankAccountId: true,
        description: true,
      },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.direction === "DEBIT") {
      throw new HttpError(400, "Giden hareketler daireyle eşleştirilemez. Sınıflandırma kullanın.");
    }
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Yoksayılan hareket eşleştirilemez.");
    }
    if (current.matchStatus === "PROCESSED") {
      throw new HttpError(400, "İşlenmiş hareket yeniden eşleştirilemez.");
    }

    const apartment = await assertApartmentInSite(tenantId, siteId, input.apartmentId);

    if (input.personId) {
      const person = await prisma.person.findFirst({
        where: { id: input.personId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!person) throw new HttpError(404, "Kişi bulunamadı.");
    }

    const row = await prisma.$transaction(async (tx) => {
      if (input.createRule && input.containsText?.trim()) {
        await tx.bankMatchingRule.create({
          data: {
            tenantId,
            siteId,
            bankAccountId: current.bankAccountId,
            name: input.ruleName?.trim() || `Kural: ${input.containsText.trim()}`,
            containsText: input.containsText.trim(),
            buildingId: apartment.buildingId,
            apartmentId: apartment.id,
            personId: input.personId,
            priority: 50,
            isActive: true,
          },
        });
      }

      return tx.bankTransaction.update({
        where: { id },
        data: {
          matchedApartmentId: apartment.id,
          matchedPersonId: input.personId ?? null,
          matchStatus: "MATCHED",
          matchedAt: new Date(),
        },
        select: txSelect,
      });
    });

    return mapTx(row);
  }

  async process(tenantId: string, siteId: string, id: string, input: ProcessBankTransactionInput) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        direction: true,
        amount: true,
        description: true,
        referenceNo: true,
        transactionDate: true,
        matchedApartmentId: true,
        matchedPersonId: true,
        paymentId: true,
      },
    });

    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.direction !== "CREDIT") {
      throw new HttpError(400, "Yalnızca gelen (CREDIT) hareketler tahsilata dönüştürülebilir.");
    }
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Yoksayılan hareket işlenemez.");
    }
    if (current.matchStatus === "PROCESSED" || current.paymentId) {
      throw new HttpError(400, "Bu banka hareketi zaten işlenmiş.");
    }
    if (!current.matchedApartmentId) {
      throw new HttpError(400, "Önce daire eşleştirmesi yapın.");
    }

    await assertApartmentInSite(tenantId, siteId, current.matchedApartmentId);

    const allocationTotal = input.allocations.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.amount)),
      new Prisma.Decimal(0),
    );

    if (allocationTotal.lte(0)) {
      throw new HttpError(400, "Dağıtım tutarı zorunludur.");
    }
    if (allocationTotal.gt(current.amount)) {
      throw new HttpError(400, "Dağıtım tutarı banka hareketi tutarını aşamaz.");
    }
    if (allocationTotal.lt(current.amount)) {
      throw new HttpError(
        400,
        "Banka hareketi tutarı seçilen borçların toplamını aşıyor. Kalan tutar için avans sistemi henüz kullanılabilir değil.",
      );
    }

    const personId = input.personId ?? current.matchedPersonId ?? undefined;

    await prisma.$transaction(async (tx) => {
      const paymentId = await paymentService.createWithinTransaction(tx, tenantId, siteId, {
        apartmentId: current.matchedApartmentId!,
        personId,
        amount: Number(current.amount.toFixed(2)),
        paymentDate: current.transactionDate,
        paymentMethod: "BANK_TRANSFER",
        referenceNo: current.referenceNo ?? undefined,
        description: current.description,
        allocations: input.allocations,
      });

      await tx.bankTransaction.update({
        where: { id },
        data: {
          paymentId,
          matchStatus: "PROCESSED",
          processedAt: new Date(),
          matchedPersonId: personId ?? current.matchedPersonId,
        },
      });
    });

    return this.getById(tenantId, siteId, id);
  }

  /** Kullanıcı otomatik öneriyi onaylar → MATCHED (henüz Payment yok). */
  async confirmSuggestion(tenantId: string, siteId: string, id: string) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        matchedApartmentId: true,
        paymentId: true,
      },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Yoksayılan hareket onaylanamaz.");
    }
    if (current.paymentId || current.matchStatus === "PROCESSED") {
      throw new HttpError(400, "Bu hareket zaten tahsilata aktarılmış.");
    }
    if (!current.matchedApartmentId) {
      throw new HttpError(400, "Onaylanacak daire eşleşmesi yok.");
    }
    if (current.matchStatus !== "SUGGESTED" && current.matchStatus !== "MATCHED") {
      throw new HttpError(400, "Yalnız önerilen veya onaylı eşleşmeler onaylanabilir.");
    }

    const row = await prisma.bankTransaction.update({
      where: { id },
      data: {
        matchStatus: "MATCHED",
        matchedAt: new Date(),
      },
      select: txSelect,
    });
    return mapTx(row);
  }

  /** Açık borçlara otomatik dağıtarak tek hareketi tahsilata aktarır. */
  async processAuto(tenantId: string, siteId: string, id: string, personId?: string | null) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        direction: true,
        amount: true,
        description: true,
        referenceNo: true,
        transactionDate: true,
        matchedApartmentId: true,
        matchedPersonId: true,
        paymentId: true,
      },
    });

    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.direction !== "CREDIT") {
      throw new HttpError(400, "Yalnızca gelen (CREDIT) hareketler tahsilata dönüştürülebilir.");
    }
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Yoksayılan hareket işlenemez.");
    }
    if (current.matchStatus === "PROCESSED" || current.paymentId) {
      throw new HttpError(409, "Bu banka hareketi zaten tahsilata aktarılmış.", "PAYMENT_ALREADY_EXISTS");
    }
    if (!current.matchedApartmentId) {
      throw new HttpError(400, "Önce daire eşleştirmesi yapın.");
    }
    if (current.matchStatus !== "MATCHED" && current.matchStatus !== "SUGGESTED") {
      throw new HttpError(400, "Tahsilata aktarmak için eşleşme gerekli.");
    }

    await assertApartmentInSite(tenantId, siteId, current.matchedApartmentId);
    const resolvedPersonId = personId ?? current.matchedPersonId ?? undefined;

    await prisma.$transaction(async (tx) => {
      const locked = await tx.bankTransaction.findFirst({
        where: { id, tenantId, paymentId: null },
        select: { id: true, paymentId: true, matchStatus: true },
      });
      if (!locked || locked.paymentId || locked.matchStatus === "PROCESSED") {
        throw new HttpError(409, "Bu banka hareketi zaten tahsilata aktarılmış.", "PAYMENT_ALREADY_EXISTS");
      }

      const allocations = await buildAutoAllocations(
        tx,
        tenantId,
        siteId,
        current.matchedApartmentId!,
        current.amount,
      );
      if (!allocations) {
        throw new HttpError(
          400,
          "Gelen tutar açık borçlara tam dağıtılamıyor. Avans/devreden bakiye henüz desteklenmiyor.",
        );
      }

      const paymentId = await paymentService.createWithinTransaction(tx, tenantId, siteId, {
        apartmentId: current.matchedApartmentId!,
        personId: resolvedPersonId,
        amount: Number(current.amount.toFixed(2)),
        paymentDate: current.transactionDate,
        paymentMethod: "BANK_TRANSFER",
        referenceNo: current.referenceNo ?? undefined,
        description: current.description,
        allocations,
      });

      const updated = await tx.bankTransaction.updateMany({
        where: { id, paymentId: null, matchStatus: { in: ["MATCHED", "SUGGESTED"] } },
        data: {
          paymentId,
          matchStatus: "PROCESSED",
          processedAt: new Date(),
          matchedPersonId: resolvedPersonId ?? current.matchedPersonId,
        },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "Bu banka hareketi zaten tahsilata aktarılmış.", "PAYMENT_ALREADY_EXISTS");
      }
    });

    return this.getById(tenantId, siteId, id);
  }

  async previewProcessBatch(tenantId: string, siteId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const rows = await prisma.bankTransaction.findMany({
      where: {
        tenantId,
        id: { in: uniqueIds },
        ...siteAccountWhere(siteId),
      },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        direction: true,
        amount: true,
        description: true,
        referenceNo: true,
        transactionDate: true,
        paymentId: true,
        matchedApartmentId: true,
        matchedPersonId: true,
        bankAccountId: true,
        matchedApartment: {
          select: {
            id: true,
            number: true,
            building: { select: { id: true, name: true } },
            relations: {
              where: { isActive: true, endDate: null },
              select: {
                relationType: true,
                person: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
        matchedPerson: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const byId = new Map(rows.map((r) => [r.id, r]));

    // Risk / meta per tx
    type Meta = {
      matchKind: StatementMatchKind | null;
      nameMismatch: boolean;
      confidence: string;
      risky: boolean;
    };
    const metaById = new Map<string, Meta>();
    for (const row of rows) {
      let matchKind: StatementMatchKind | null = null;
      let nameMismatch = false;
      let confidence = "NONE";
      if (row.matchedApartmentId && row.direction === "CREDIT") {
        const suggestion = await suggestStatementMatch(
          tenantId,
          siteId,
          row.bankAccountId,
          row.description,
        );
        matchKind = suggestion.matchKind;
        nameMismatch = suggestion.nameMismatch;
        confidence = suggestion.confidence;
      }
      const userConfirmed = row.matchStatus === "MATCHED";
      const risky =
        !userConfirmed && isRiskySuggestion(matchKind ?? "NONE", nameMismatch, confidence);
      metaById.set(row.id, { matchKind, nameMismatch, confidence, risky });
    }

    // Group eligible-looking CREDIT txs by apartment for sequential planning
    const groupInputs = new Map<string, BatchTxInput[]>();
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row?.matchedApartmentId) continue;
      if (row.direction !== "CREDIT" || row.status !== "ACTIVE" || row.paymentId) continue;
      if (row.matchStatus !== "SUGGESTED" && row.matchStatus !== "MATCHED") continue;
      const list = groupInputs.get(row.matchedApartmentId) ?? [];
      list.push({
        id: row.id,
        amount: row.amount,
        transactionDate: row.transactionDate,
        description: row.description,
        referenceNo: row.referenceNo,
        apartmentId: row.matchedApartmentId,
      });
      groupInputs.set(row.matchedApartmentId, list);
    }

    const apartmentPlans = new Map<string, ApartmentBatchPlan>();
    for (const [apartmentId, txs] of groupInputs) {
      const debts = await loadOpenDebtsForApartment(prisma, tenantId, siteId, apartmentId);
      apartmentPlans.set(apartmentId, planApartmentBatchAllocations(debts, txs));
    }

    const items = [];
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        items.push({
          id,
          eligible: false,
          bulkSafe: false,
          risky: true,
          warning: "Hareket bulunamadı.",
          amount: null,
          senderHint: null,
          apartment: null,
          registeredPerson: null,
          matchedPerson: null,
          openDebtTotal: null,
          allocations: [],
          matchKind: null,
          nameMismatch: false,
          apartmentGroupStatus: null as string | null,
        });
        continue;
      }

      const meta = metaById.get(id)!;
      const senderHint = senderLabelFromBankDescription(row.description, row.matchedPerson
        ? `${row.matchedPerson.firstName} ${row.matchedPerson.lastName}`.trim()
        : null);
      const matchedPerson = row.matchedPerson
        ? `${row.matchedPerson.firstName} ${row.matchedPerson.lastName}`.trim()
        : null;
      const registered =
        row.matchedApartment?.relations
          .map(
            (r) =>
              `${r.relationType === "OWNER" ? "Malik" : "Kiracı"}: ${r.person.firstName} ${r.person.lastName}`.trim(),
          )
          .join(" · ") ?? null;

      let warning: string | null = null;
      let allocations: ApartmentBatchPlan["transactionPlans"][0]["allocations"] = [];
      let openDebtTotal: string | null = null;
      let allocatable = false;
      let apartmentGroupStatus: string | null = null;

      if (row.paymentId) {
        warning = "Bu hareket zaten tahsilata aktarılmış.";
      } else if (row.direction !== "CREDIT") {
        warning = "Yalnız gelen hareketler tahsilata aktarılır.";
      } else if (!row.matchedApartmentId) {
        warning = "Daire eşleşmesi yok.";
      } else if (row.status !== "ACTIVE") {
        warning = "Hareket aktif değil.";
      } else if (row.matchStatus !== "SUGGESTED" && row.matchStatus !== "MATCHED") {
        warning = "Eşleşme onaylanabilir durumda değil.";
      } else {
        const plan = apartmentPlans.get(row.matchedApartmentId)!;
        const txPlan = plan.transactionPlans.find((p) => p.transactionId === id)!;
        allocations = txPlan.allocations;
        openDebtTotal = plan.openDebtTotal;
        allocatable = txPlan.allocatable;
        apartmentGroupStatus = plan.status;
        warning = plan.warning ?? txPlan.warning;
      }

      const eligible =
        allocatable &&
        !row.paymentId &&
        row.status === "ACTIVE" &&
        row.direction === "CREDIT" &&
        Boolean(row.matchedApartmentId) &&
        (row.matchStatus === "SUGGESTED" || row.matchStatus === "MATCHED");

      // Dağıtım hazırlığı: eşleşme riski ayrı; farklı gönderen / ay adı risk sayılmaz.
      const bulkSafe =
        eligible &&
        apartmentGroupStatus !== "OVERPAYMENT" &&
        apartmentGroupStatus !== "MANUAL_REVIEW" &&
        apartmentGroupStatus !== "NO_OPEN_DEBT";

      const financeIssues: Array<{
        code: string;
        severity: "INFO" | "WARNING" | "BLOCK";
        title: string;
        message: string;
      }> = [];
      if (row.paymentId) {
        financeIssues.push({
          code: "BANK_TX_ALREADY_PROCESSED",
          severity: "BLOCK",
          title: "Hareket işlenmiş",
          message: "Bu banka hareketi daha önce tahsilata aktarıldı.",
        });
      } else if (row.direction !== "CREDIT") {
        financeIssues.push({
          code: "BANK_TX_NOT_CREDIT",
          severity: "BLOCK",
          title: "Giden hareket",
          message: "Giden banka hareketi tahsilat olarak kaydedilemez.",
        });
      } else if (!row.matchedApartmentId) {
        financeIssues.push({
          code: "BANK_TX_NO_APARTMENT",
          severity: "BLOCK",
          title: "Daire eşleşmesi yok",
          message: "Eşleşen daire seçilmeden tahsilat oluşturulamaz.",
        });
      } else if (row.status !== "ACTIVE") {
        financeIssues.push({
          code: "BANK_TX_INACTIVE",
          severity: "BLOCK",
          title: "Hareket aktif değil",
          message: "İptal veya hariç tutulan hareket doğrudan tahsilata çevrilemez.",
        });
      } else if (apartmentGroupStatus === "NO_OPEN_DEBT") {
        financeIssues.push({
          code: "NO_OPEN_DEBT",
          severity: "BLOCK",
          title: "Açık borç yok",
          message: "Eşleşen dairenin açık borcu bulunmuyor.",
        });
      } else if (apartmentGroupStatus === "OVERPAYMENT") {
        financeIssues.push({
          code: "OVERPAYMENT_NO_CREDIT",
          severity: "BLOCK",
          title: "Tutar açık borcu aşıyor",
          message: "Banka hareketi tutarı açık borç toplamını aşıyor.",
        });
      } else if (eligible && allocations.length > 1) {
        financeIssues.push({
          code: "MULTI_PERIOD_ALLOCATION",
          severity: "INFO",
          title: "Birden fazla borca dağıtım",
          message: `Ödeme ${allocations.length} açık borca dağıtılacaktır.`,
        });
      }

      items.push({
        id: row.id,
        eligible: Boolean(eligible),
        bulkSafe: Boolean(bulkSafe),
        risky: Boolean(eligible && meta.risky),
        warning,
        financeIssues,
        amount: toMoneyString(row.amount),
        senderHint,
        description: row.description,
        transactionDate: row.transactionDate,
        apartment: row.matchedApartment
          ? {
              id: row.matchedApartment.id,
              number: row.matchedApartment.number,
              building: row.matchedApartment.building,
            }
          : null,
        registeredPerson: registered,
        matchedPerson,
        openDebtTotal,
        allocations,
        matchKind: meta.matchKind,
        nameMismatch: meta.nameMismatch,
        matchStatus: row.matchStatus,
        apartmentGroupStatus,
      });
    }

    const apartmentGroups = [...apartmentPlans.entries()].map(([apartmentId, plan]) => {
      const txIds = plan.transactionPlans.map((p) => p.transactionId);
      const groupRows = txIds.map((id) => byId.get(id)!).filter(Boolean);
      const sample = groupRows[0];
      const senderLabels = [
        ...new Set(
          groupRows.map((r) =>
            senderLabelFromBankDescription(
              r.description,
              r.matchedPerson
                ? `${r.matchedPerson.firstName} ${r.matchedPerson.lastName}`.trim()
                : null,
            ),
          ),
        ),
      ];
      const ownerLabel =
        sample?.matchedApartment?.relations
          .filter((r) => r.relationType === "OWNER")
          .map((r) => `${r.person.firstName} ${r.person.lastName}`.trim())
          .join(", ") || null;

      return {
        apartmentId,
        apartment: sample?.matchedApartment
          ? {
              id: sample.matchedApartment.id,
              number: sample.matchedApartment.number,
              building: sample.matchedApartment.building,
            }
          : null,
        registeredPerson:
          sample?.matchedApartment?.relations
            .map(
              (r) =>
                `${r.relationType === "OWNER" ? "Malik" : "Kiracı"}: ${r.person.firstName} ${r.person.lastName}`.trim(),
            )
            .join(" · ") ?? null,
        ownerLabel,
        senderLabels,
        transactionIds: txIds,
        transactionCount: plan.transactionPlans.length,
        totalIncoming: plan.totalIncoming,
        openDebtTotal: plan.openDebtTotal,
        allocatableTotal: plan.allocatableTotal,
        remainderTotal: plan.remainderTotal,
        debtsCovered: plan.debtsCovered,
        unifiedAllocations: plan.unifiedAllocations,
        status: plan.status,
        warning: plan.warning,
        summaryLine:
          plan.status === "READY"
            ? `Daire ${sample?.matchedApartment?.number ?? "?"} toplam ${plan.totalIncoming} TL ödemesi en eski ${plan.debtsCovered} açık borca dağıtılacaktır.`
            : plan.warning,
        transactionPlans: plan.transactionPlans,
      };
    });

    const eligibleItems = items.filter((i) => i.eligible);
    const bulkSafeItems = items.filter((i) => i.bulkSafe);
    const totalAmount = eligibleItems.reduce((s, i) => s + Number(i.amount ?? 0), 0);
    const bulkSafeAmount = bulkSafeItems.reduce((s, i) => s + Number(i.amount ?? 0), 0);
    const multiPaymentApartments = apartmentGroups.filter((g) => g.transactionCount > 1);

    return {
      items,
      apartmentGroups,
      summary: {
        total: items.length,
        eligible: eligibleItems.length,
        bulkSafe: bulkSafeItems.length,
        risky: items.filter((i) => i.eligible && i.risky).length,
        blocked: items.filter((i) => !i.eligible).length,
        totalAmount: totalAmount.toFixed(2),
        bulkSafeAmount: bulkSafeAmount.toFixed(2),
        multiPaymentApartmentCount: multiPaymentApartments.length,
      },
    };
  }

  /**
   * Daire grupları atomik işlenir. Tutarlar en eski açık borçtan FIFO dağıtılır.
   * Her BankTransaction ayrı Payment olur; allocation sırası geçici kalanlarla korunur.
   */
  async processBatch(
    tenantId: string,
    siteId: string,
    ids: string[],
    options: {
      includeRisky?: boolean;
      resolvePeriodConflicts?: "SKIP" | "SEQUENTIAL";
      allocationOverrides?: Array<{
        transactionId: string;
        allocations: Array<{ apartmentDebtId: string; amount: number }>;
      }>;
    } = {},
  ) {
    const includeRisky = options.includeRisky === true;
    const overrideByTx = new Map(
      (options.allocationOverrides ?? []).map((o) => [o.transactionId, o.allocations]),
    );
    const preview = await this.previewProcessBatch(tenantId, siteId, ids);
    const results: Array<{
      id: string;
      status: "processed" | "skipped" | "failed";
      message: string;
      paymentId?: string;
    }> = [];
    const resultById = new Map<string, (typeof results)[0]>();

    const selected = new Set(
      preview.items
        .filter((item) => {
          if (!item.eligible) return false;
          if (overrideByTx.has(item.id)) return true;
          return item.bulkSafe || includeRisky;
        })
        .map((i) => i.id),
    );

    for (const item of preview.items) {
      if (selected.has(item.id)) continue;
      if (!item.eligible) {
        resultById.set(item.id, {
          id: item.id,
          status: "skipped",
          message: item.warning ?? "İşleme uygun değil.",
        });
      } else {
        resultById.set(item.id, {
          id: item.id,
          status: "skipped",
          message: item.warning ?? "Toplu onaya dahil edilmedi.",
        });
      }
    }

    // Process by apartment group for selected ids
    const groups = preview.apartmentGroups ?? [];
    for (const group of groups) {
      const groupIds = group.transactionIds.filter((id) => selected.has(id));
      if (groupIds.length === 0) continue;

      try {
        await prisma.$transaction(
          async (tx) => {
            // Fiziksel tablo adı Prisma @@map ile yönetilir (apartment_debts).
            // Ham "ApartmentDebt" SQL kullanılmaz — 42P01 önlenir.
            const debts = await loadOpenDebtsForApartment(tx, tenantId, siteId, group.apartmentId);
            const provisional = new Map(
              debts.map((d) => [d.id, new Prisma.Decimal(d.remainingAmount)]),
            );

            const bankRows = await tx.bankTransaction.findMany({
              where: {
                id: { in: groupIds },
                tenantId,
                ...siteAccountWhere(siteId),
              },
              select: {
                id: true,
                status: true,
                matchStatus: true,
                direction: true,
                amount: true,
                description: true,
                referenceNo: true,
                transactionDate: true,
                matchedApartmentId: true,
                matchedPersonId: true,
                paymentId: true,
              },
            });

            const ordered = sortBatchTransactions(
              bankRows.map((r) => ({
                id: r.id,
                amount: r.amount,
                transactionDate: r.transactionDate,
                description: r.description,
                referenceNo: r.referenceNo,
                apartmentId: r.matchedApartmentId!,
              })),
            );

            for (const planned of ordered) {
              const current = bankRows.find((r) => r.id === planned.id)!;
              if (current.direction !== "CREDIT") {
                throw new HttpError(400, "Yalnız gelen hareketler tahsilata dönüştürülebilir.");
              }
              if (current.paymentId || current.matchStatus === "PROCESSED") {
                throw new HttpError(
                  409,
                  "Bu banka hareketi zaten tahsilata aktarılmış.",
                  "PAYMENT_ALREADY_EXISTS",
                );
              }
              if (!current.matchedApartmentId || current.matchedApartmentId !== group.apartmentId) {
                throw new HttpError(400, "Daire eşleşmesi geçersiz.");
              }

              const override = overrideByTx.get(current.id);
              let allocations: Array<{ apartmentDebtId: string; amount: number }> | null = null;
              if (override) {
                const sum = override.reduce((s, a) => s + a.amount, 0);
                if (Math.abs(sum - Number(current.amount.toFixed(2))) > 0.001) {
                  throw new HttpError(400, "Manuel dağıtım tutarı hareket tutarına eşit olmalıdır.");
                }
                // Apply against provisional remainings
                for (const a of override) {
                  if (a.amount < 0) throw new HttpError(400, "Allocation negatif olamaz.");
                  const rem = provisional.get(a.apartmentDebtId) ?? new Prisma.Decimal(0);
                  const take = new Prisma.Decimal(a.amount);
                  if (take.gt(rem.add(new Prisma.Decimal("0.001")))) {
                    const debt = debts.find((d) => d.id === a.apartmentDebtId);
                    const aptNo = group.apartment?.number ?? "";
                    throw new HttpError(
                      409,
                      `Daire ${aptNo}'in ${debt?.title ?? "ilgili dönem"} borcuna birden fazla ödeme dağıtılmaya çalışılıyor. Dağıtımı yeniden kontrol edin.`,
                      "DEBT_ALLOCATION_OVERFLOW",
                    );
                  }
                  provisional.set(a.apartmentDebtId, rem.sub(take));
                }
                allocations = override;
              } else {
                allocations = allocateAmountAgainstProvisional(
                  debts,
                  provisional,
                  current.amount,
                  current.description,
                  current.transactionDate,
                );
              }
              if (!allocations) {
                const aptLabel = group.apartment
                  ? `${group.apartment.building.name} · Daire ${group.apartment.number}`
                  : "Daire";
                throw new HttpError(
                  400,
                  `${aptLabel} için gelen tutar açık borçlara tam dağıtılamıyor. Dağıtımı yeniden kontrol edin.`,
                );
              }

              for (const alloc of allocations) {
                const rem = provisional.get(alloc.apartmentDebtId);
                // provisional already reduced; remainingAfter + amount = remainingBefore
                const debt = debts.find((d) => d.id === alloc.apartmentDebtId);
                if (!debt) {
                  throw new HttpError(400, "Borç kaydı bulunamadı.");
                }
                if (rem == null || rem.lt(0)) {
                  const aptNo = group.apartment?.number ?? "";
                  throw new HttpError(
                    409,
                    `Daire ${aptNo}'in ${debt.title} borcuna birden fazla ödeme dağıtılmaya çalışılıyor. Dağıtımı yeniden kontrol edin.`,
                    "DEBT_ALLOCATION_OVERFLOW",
                  );
                }
              }

              if (current.matchStatus === "SUGGESTED") {
                await tx.bankTransaction.update({
                  where: { id: current.id },
                  data: { matchStatus: "MATCHED", matchedAt: new Date() },
                });
              }

              const paymentId = await paymentService.createWithinTransaction(tx, tenantId, siteId, {
                apartmentId: current.matchedApartmentId,
                personId: current.matchedPersonId ?? undefined,
                amount: Number(current.amount.toFixed(2)),
                paymentDate: current.transactionDate,
                paymentMethod: "BANK_TRANSFER",
                referenceNo: current.referenceNo ?? undefined,
                description: current.description,
                allocations,
              });

              const updated = await tx.bankTransaction.updateMany({
                where: {
                  id: current.id,
                  paymentId: null,
                  matchStatus: { in: ["MATCHED", "SUGGESTED"] },
                },
                data: {
                  paymentId,
                  matchStatus: "PROCESSED",
                  processedAt: new Date(),
                },
              });
              if (updated.count !== 1) {
                throw new HttpError(
                  409,
                  "Bu banka hareketi zaten tahsilata aktarılmış.",
                  "PAYMENT_ALREADY_EXISTS",
                );
              }

              resultById.set(current.id, {
                id: current.id,
                status: "processed",
                message: "Tahsilata aktarıldı.",
                paymentId,
              });
            }
          },
          { timeout: 120_000, maxWait: 20_000 },
        );
      } catch (err) {
        const prismaCode =
          err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
        const pgCode =
          err instanceof Prisma.PrismaClientKnownRequestError
            ? String((err.meta as { code?: string } | undefined)?.code ?? "")
            : "";
        const rawMessage = err instanceof Error ? err.message : String(err);
        const isInfrastructure =
          !(err instanceof HttpError) &&
          (prismaCode === "P2010" ||
            pgCode === "42P01" ||
            /relation .* does not exist/i.test(rawMessage) ||
            /Raw query failed/i.test(rawMessage) ||
            err instanceof Prisma.PrismaClientUnknownRequestError ||
            err instanceof Prisma.PrismaClientRustPanicError);

        if (isInfrastructure) {
          console.error("[processBatch] database operation failed", {
            apartmentId: group.apartmentId,
            prismaCode,
            pgCode: pgCode || undefined,
          });
          throw new HttpError(
            500,
            "Tahsilatlar kaydedilemedi. Veritabanı işlemi tamamlanamadı.",
            "DB_OPERATION_FAILED",
          );
        }

        const message =
          err instanceof HttpError
            ? err.message
            : "Tahsilatlar kaydedilemedi. Veritabanı işlemi tamamlanamadı.";
        for (const id of groupIds) {
          resultById.set(id, { id, status: "failed", message });
        }
      }
    }

    for (const id of [...new Set(ids)]) {
      results.push(
        resultById.get(id) ?? {
          id,
          status: "skipped",
          message: "İşlenmedi.",
        },
      );
    }

    const processed = results.filter((r) => r.status === "processed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return {
      results,
      summary: { processed, skipped, failed },
      apartmentGroups: preview.apartmentGroups,
    };
  }

  /**
   * Eşleştirmeyi geri alır. PROCESSED + payment varsa önce tahsilat iptali gerekir.
   * Payment iptalinden sonra MATCHED kalan hareketi UNMATCHED'e çeker.
   */
  async unmatch(tenantId: string, siteId: string, id: string) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        status: true,
        matchStatus: true,
        paymentId: true,
      },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Yoksayılan hareketin eşleştirmesi geri alınamaz.");
    }
    if (current.matchStatus === "PROCESSED" || current.paymentId) {
      throw new HttpError(
        400,
        "Önce bağlı tahsilatı iptal edin; ardından eşleştirmeyi geri alabilirsiniz.",
      );
    }

    const row = await prisma.bankTransaction.update({
      where: { id },
      data: {
        matchedApartmentId: null,
        matchedPersonId: null,
        matchStatus: "UNMATCHED",
        matchedAt: null,
      },
      select: txSelect,
    });

    return mapTx(row);
  }

  async ignore(tenantId: string, siteId: string, id: string) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: { id: true, matchStatus: true, status: true, direction: true, paymentId: true, expenseId: true },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.matchStatus === "PROCESSED" || current.paymentId) {
      throw new HttpError(400, "Tahsilata aktarılmış hareket hariç tutulamaz. Önce tahsilatı iptal edin.");
    }
    if (current.expenseId) {
      throw new HttpError(400, "Gider bağlanmış hareket hariç tutulamaz. Önce gider kaydını iptal edin.");
    }
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Hareket zaten hariç tutulmuş.");
    }

    const row = await prisma.bankTransaction.update({
      where: { id },
      data: {
        status: "IGNORED",
        ignoredAt: new Date(),
        ...(current.direction === "DEBIT" ? { debitClass: "EXCLUDED" as const } : {}),
      },
      select: txSelect,
    });

    return mapTx(row);
  }

  /**
   * Giden hareket sınıflandırması.
   * Kasa/avans/banka transferi domain'de yok — desteklenmez.
   */
  async classifyDebit(
    tenantId: string,
    siteId: string,
    id: string,
    input: ClassifyBankDebitInput,
  ) {
    const current = await prisma.bankTransaction.findFirst({
      where: { id, tenantId, ...siteAccountWhere(siteId) },
      select: {
        id: true,
        direction: true,
        status: true,
        amount: true,
        description: true,
        transactionDate: true,
        referenceNo: true,
        debitClass: true,
        expenseId: true,
        paymentId: true,
        matchStatus: true,
      },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.direction !== "DEBIT") {
      throw new HttpError(400, "Yalnız giden hareketler sınıflandırılabilir.");
    }
    if (current.paymentId || current.matchStatus === "PROCESSED") {
      throw new HttpError(400, "Bu kayıt tahsilatla bağlı; giden sınıflandırma uygulanamaz.");
    }

    if (input.action === "EXCLUDE") {
      if (current.expenseId) {
        throw new HttpError(400, "Gider bağlıyken hariç tutulamıyor. Önce gider kaydını iptal edin.");
      }
      const row = await prisma.bankTransaction.update({
        where: { id },
        data: {
          debitClass: "EXCLUDED",
          status: "ACTIVE",
          ignoredAt: null,
        },
        select: txSelect,
      });
      return mapTx(row);
    }

    if (input.action === "RESET") {
      if (current.expenseId) {
        throw new HttpError(400, "Gider bağlıyken sınıflandırma sıfırlanamaz. Önce gider kaydını iptal edin.");
      }
      const row = await prisma.bankTransaction.update({
        where: { id },
        data: {
          debitClass: "UNCLASSIFIED",
          status: "ACTIVE",
          ignoredAt: null,
        },
        select: txSelect,
      });
      return mapTx(row);
    }

    // CREATE_EXPENSE
    if (current.expenseId || current.debitClass === "EXPENSE") {
      throw new HttpError(409, "Bu banka hareketi zaten bir gidere bağlanmış.", "EXPENSE_ALREADY_LINKED");
    }

    const expenseType = await prisma.expenseType.findFirst({
      where: {
        id: input.expenseTypeId,
        tenantId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!expenseType) throw new HttpError(400, "Aktif bir gider türü seçin.");

    if (input.buildingId) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
    }
    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: input.supplierId, tenantId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!supplier) throw new HttpError(400, "Aktif bir tedarikçi seçin.");
    }

    await prisma.$transaction(async (tx) => {
      const locked = await tx.bankTransaction.findFirst({
        where: { id, tenantId, expenseId: null, direction: "DEBIT" },
        select: { id: true, expenseId: true },
      });
      if (!locked || locked.expenseId) {
        throw new HttpError(409, "Bu banka hareketi zaten bir gidere bağlanmış.", "EXPENSE_ALREADY_LINKED");
      }

      const expense = await tx.expense.create({
        data: {
          tenantId,
          siteId,
          title: input.title.trim(),
          expenseTypeId: input.expenseTypeId,
          amount: current.amount,
          expenseDate: input.expenseDate,
          paymentMethod: input.paymentMethod ?? "BANK_TRANSFER",
          buildingId: input.buildingId,
          supplierId: input.supplierId,
          referenceNo: input.referenceNo ?? current.referenceNo,
          description: input.description ?? current.description,
          status: "COMPLETED",
        },
        select: { id: true },
      });

      const updated = await tx.bankTransaction.updateMany({
        where: { id, expenseId: null, direction: "DEBIT" },
        data: {
          expenseId: expense.id,
          debitClass: "EXPENSE",
          status: "ACTIVE",
          ignoredAt: null,
          processedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "Bu banka hareketi zaten bir gidere bağlanmış.", "EXPENSE_ALREADY_LINKED");
      }
    });

    return this.getById(tenantId, siteId, id);
  }
}

export const bankTransactionService = new BankTransactionService();
