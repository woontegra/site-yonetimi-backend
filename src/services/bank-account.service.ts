import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { maskIban } from "../utils/bank-text";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import type {
  CreateBankAccountInput,
  ListBankAccountsQuery,
  UpdateBankAccountInput,
} from "../validators/bank.validators";

async function computeBookBalance(tenantId: string, accountId: string, openingBalance: Prisma.Decimal) {
  const txs = await prisma.bankTransaction.findMany({
    where: {
      tenantId,
      bankAccountId: accountId,
      status: "ACTIVE",
    },
    select: { direction: true, amount: true },
  });

  let balance = new Prisma.Decimal(openingBalance);
  for (const tx of txs) {
    balance = tx.direction === "CREDIT" ? balance.add(tx.amount) : balance.sub(tx.amount);
  }
  return balance;
}

function mapAccount(
  row: {
    id: string;
    bankName: string;
    accountName: string;
    iban: string | null;
    accountNumber: string | null;
    branchName: string | null;
    currency: string;
    openingBalance: Prisma.Decimal;
    currentBalance: Prisma.Decimal | null;
    isActive: boolean;
    connectionType: "MANUAL" | "API";
    lastSyncAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  bookBalance: Prisma.Decimal,
  fullIban = false,
) {
  return {
    id: row.id,
    bankName: row.bankName,
    accountName: row.accountName,
    iban: fullIban ? row.iban : maskIban(row.iban),
    ibanFull: fullIban ? row.iban : undefined,
    accountNumber: row.accountNumber,
    branchName: row.branchName,
    currency: row.currency,
    openingBalance: toMoneyString(row.openingBalance),
    bookBalance: toMoneyString(bookBalance),
    isActive: row.isActive,
    connectionType: row.connectionType,
    connectionLabel: row.connectionType === "MANUAL" ? "Manuel" : "API",
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class BankAccountService {
  async list(tenantId: string, siteId: string, query: ListBankAccountsQuery) {
    const where: Prisma.BankAccountWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };
    if (query.activeOnly) where.isActive = true;
    if (query.search) {
      where.OR = [
        { bankName: { contains: query.search, mode: "insensitive" } },
        { accountName: { contains: query.search, mode: "insensitive" } },
        { iban: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.bankAccount.findMany({
        where,
        orderBy: [{ bankName: "asc" }, { accountName: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.bankAccount.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (row) => {
        const bookBalance = await computeBookBalance(tenantId, row.id, row.openingBalance);
        return mapAccount(row, bookBalance, false);
      }),
    );

    return { items, page: query.page, perPage: query.perPage, total };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.bankAccount.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
    });
    if (!row) throw new HttpError(404, "Banka hesabı bulunamadı.");
    const bookBalance = await computeBookBalance(tenantId, row.id, row.openingBalance);
    return mapAccount(row, bookBalance, true);
  }

  async create(tenantId: string, siteId: string, input: CreateBankAccountInput) {
    const opening = new Prisma.Decimal(input.openingBalance ?? 0);
    const row = await prisma.bankAccount.create({
      data: {
        tenantId,
        siteId,
        bankName: input.bankName.trim(),
        accountName: input.accountName.trim(),
        iban: input.iban?.replace(/\s+/g, "").toUpperCase(),
        accountNumber: input.accountNumber,
        branchName: input.branchName,
        openingBalance: opening,
        connectionType: "MANUAL",
        currency: "TRY",
        isActive: true,
      },
    });
    return mapAccount(row, opening, true);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateBankAccountInput) {
    const current = await prisma.bankAccount.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: { id: true, openingBalance: true },
    });
    if (!current) throw new HttpError(404, "Banka hesabı bulunamadı.");

    const row = await prisma.bankAccount.update({
      where: { id },
      data: {
        ...(input.bankName !== undefined ? { bankName: input.bankName.trim() } : {}),
        ...(input.accountName !== undefined ? { accountName: input.accountName.trim() } : {}),
        ...(input.iban !== undefined
          ? { iban: input.iban ? input.iban.replace(/\s+/g, "").toUpperCase() : null }
          : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
        ...(input.branchName !== undefined ? { branchName: input.branchName } : {}),
        ...(input.openingBalance !== undefined
          ? { openingBalance: new Prisma.Decimal(input.openingBalance) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    const bookBalance = await computeBookBalance(tenantId, row.id, row.openingBalance);
    return mapAccount(row, bookBalance, true);
  }

  async softDelete(tenantId: string, siteId: string, id: string) {
    const current = await prisma.bankAccount.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Banka hesabı bulunamadı.");

    await prisma.bankAccount.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return { ok: true };
  }
}

export const bankAccountService = new BankAccountService();
