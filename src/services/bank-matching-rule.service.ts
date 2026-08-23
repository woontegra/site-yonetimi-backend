import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  assertApartmentInSite,
  assertBankAccountInSite,
  assertBuildingInSite,
} from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import type {
  CreateBankMatchingRuleInput,
  ListBankMatchingRulesQuery,
  UpdateBankMatchingRuleInput,
} from "../validators/bank.validators";

function mapRule(row: {
  id: string;
  name: string;
  containsText: string;
  isActive: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  bankAccount: { id: string; bankName: string; accountName: string } | null;
  building: { id: string; name: string } | null;
  apartment: { id: string; number: string } | null;
  person: { id: string; firstName: string; lastName: string } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    containsText: row.containsText,
    isActive: row.isActive,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bankAccount: row.bankAccount,
    building: row.building,
    apartment: row.apartment,
    person: row.person
      ? {
          id: row.person.id,
          fullName: `${row.person.firstName} ${row.person.lastName}`.trim(),
        }
      : null,
  };
}

const ruleInclude = {
  bankAccount: { select: { id: true, bankName: true, accountName: true } },
  building: { select: { id: true, name: true } },
  apartment: { select: { id: true, number: true } },
  person: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.BankMatchingRuleInclude;

async function assertRuleTargets(
  tenantId: string,
  siteId: string,
  input: {
    bankAccountId?: string | null;
    buildingId?: string | null;
    apartmentId?: string | null;
    personId?: string | null;
  },
) {
  if (input.bankAccountId) {
    await assertBankAccountInSite(tenantId, siteId, input.bankAccountId);
  }

  if (input.buildingId) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
  }

  if (input.apartmentId) {
    const apartment = await assertApartmentInSite(tenantId, siteId, input.apartmentId);
    if (input.buildingId && apartment.buildingId !== input.buildingId) {
      throw new HttpError(400, "Daire seçilen binaya ait değil.");
    }
  }

  if (input.personId) {
    const person = await prisma.person.findFirst({
      where: { id: input.personId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!person) throw new HttpError(404, "Kişi bulunamadı.");
  }
}

export class BankMatchingRuleService {
  async list(tenantId: string, siteId: string, query: ListBankMatchingRulesQuery) {
    const where: Prisma.BankMatchingRuleWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };
    if (query.bankAccountId) {
      where.OR = [{ bankAccountId: query.bankAccountId }, { bankAccountId: null }];
    }
    if (query.activeOnly) where.isActive = true;

    const rows = await prisma.bankMatchingRule.findMany({
      where,
      include: ruleInclude,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    });

    return { items: rows.map(mapRule) };
  }

  async create(tenantId: string, siteId: string, input: CreateBankMatchingRuleInput) {
    await assertRuleTargets(tenantId, siteId, input);

    const row = await prisma.bankMatchingRule.create({
      data: {
        tenantId,
        siteId,
        bankAccountId: input.bankAccountId,
        name: input.name.trim(),
        containsText: input.containsText.trim(),
        buildingId: input.buildingId,
        apartmentId: input.apartmentId,
        personId: input.personId,
        priority: input.priority ?? 100,
        isActive: true,
      },
      include: ruleInclude,
    });

    return mapRule(row);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateBankMatchingRuleInput) {
    const current = await prisma.bankMatchingRule.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: { id: true, bankAccountId: true, buildingId: true },
    });
    if (!current) throw new HttpError(404, "Eşleştirme kuralı bulunamadı.");

    await assertRuleTargets(tenantId, siteId, {
      bankAccountId: current.bankAccountId,
      buildingId: input.buildingId === undefined ? current.buildingId : input.buildingId,
      apartmentId: input.apartmentId,
      personId: input.personId,
    });

    const row = await prisma.bankMatchingRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.containsText !== undefined ? { containsText: input.containsText.trim() } : {}),
        ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
        ...(input.apartmentId !== undefined ? { apartmentId: input.apartmentId } : {}),
        ...(input.personId !== undefined ? { personId: input.personId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: ruleInclude,
    });

    return mapRule(row);
  }

  async softDelete(tenantId: string, siteId: string, id: string) {
    const current = await prisma.bankMatchingRule.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Eşleştirme kuralı bulunamadı.");

    await prisma.bankMatchingRule.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    return { ok: true };
  }
}

export const bankMatchingRuleService = new BankMatchingRuleService();
