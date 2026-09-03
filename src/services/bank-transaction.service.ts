import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { suggestStatementMatch } from "../utils/bank-statement-match";
import {
  assertApartmentInSite,
  assertBankAccountInSite,
} from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateBankTransactionInput,
  ListBankTransactionsQuery,
  MatchBankTransactionInput,
  ProcessBankTransactionInput,
} from "../validators/bank.validators";
import { paymentService } from "./payment.service";

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
  matchedAt: true,
  processedAt: true,
  ignoredAt: true,
  importedAt: true,
  createdAt: true,
  updatedAt: true,
  paymentId: true,
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
  matchedAt: Date | null;
  processedAt: Date | null;
  ignoredAt: Date | null;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  paymentId: string | null;
  bankAccount: { id: string; bankName: string; accountName: string };
  matchedApartment: {
    id: string;
    number: string;
    building: { id: string; name: string };
  } | null;
  matchedPerson: { id: string; firstName: string; lastName: string } | null;
  payment: { id: string; amount: Prisma.Decimal; status: string } | null;
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
        matchStatus: match.matchStatus,
        matchedApartmentId: match.apartmentId,
        matchedPersonId: match.personId,
        matchedAt: match.matchStatus === "SUGGESTED" ? new Date() : null,
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
        bankAccountId: true,
        description: true,
      },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
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
      select: { id: true, matchStatus: true, status: true },
    });
    if (!current) throw new HttpError(404, "Banka hareketi bulunamadı.");
    if (current.matchStatus === "PROCESSED") {
      throw new HttpError(400, "İşlenmiş hareket yoksayılamaz.");
    }
    if (current.status === "IGNORED") {
      throw new HttpError(400, "Hareket zaten yoksayılmış.");
    }

    const row = await prisma.bankTransaction.update({
      where: { id },
      data: {
        status: "IGNORED",
        ignoredAt: new Date(),
      },
      select: txSelect,
    });

    return mapTx(row);
  }
}

export const bankTransactionService = new BankTransactionService();
