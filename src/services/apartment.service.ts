import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import {
  findActiveExemptionsForApartments,
  mapExemptionPublic,
  resolveDuesStatusForToday,
} from "./dues-exemption-helpers";
import { turkeyTodayUtcMidnight } from "../utils/turkey-date";
import type {
  CreateApartmentInput,
  ListApartmentsQuery,
  UpdateApartmentInput,
} from "../validators/apartment.validators";

const apartmentBaseSelect = {
  id: true,
  number: true,
  floor: true,
  roomType: true,
  squareMeters: true,
  hasBalcony: true,
  isActive: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  building: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

type Occupancy = "OWNER_OCCUPIED" | "TENANT_OCCUPIED" | "VACANT";

function personFullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function isRelationActiveNow(
  rel: { isActive: boolean; startDate: Date | null; endDate: Date | null },
  now: Date,
) {
  if (!rel.isActive) return false;
  if (rel.startDate && rel.startDate > now) return false;
  if (rel.endDate && rel.endDate < now) return false;
  return true;
}

function mapPersonSummary(
  person: { id: string; firstName: string; lastName: string; phone: string | null },
  includePhone: boolean,
) {
  return {
    id: person.id,
    fullName: personFullName(person.firstName, person.lastName),
    phone: includePhone ? person.phone : null,
  };
}

function enrichApartment(
  row: {
    id: string;
    number: string;
    floor: string | null;
    roomType: string | null;
    squareMeters: number | null;
    hasBalcony: boolean | null;
    isActive: boolean;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    building: { id: string; name: string };
    relations?: Array<{
      relationType: "OWNER" | "TENANT";
      isPrimary: boolean;
      isActive: boolean;
      startDate: Date | null;
      endDate: Date | null;
      person: { id: string; firstName: string; lastName: string; phone: string | null; isActive: boolean; deletedAt: Date | null };
    }>;
  },
  options: {
    includePhone: boolean;
    exemption: Awaited<ReturnType<typeof findActiveExemptionsForApartments>> extends Map<string, infer V>
      ? V | undefined
      : never;
    debt: { openAmount: Prisma.Decimal; overdueAmount: Prisma.Decimal } | undefined;
    now: Date;
  },
) {
  const relations = (row.relations ?? []).filter(
    (rel) =>
      rel.person.deletedAt == null &&
      rel.person.isActive &&
      isRelationActiveNow(rel, options.now),
  );
  const owners = relations
    .filter((rel) => rel.relationType === "OWNER")
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const tenants = relations
    .filter((rel) => rel.relationType === "TENANT")
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  let occupancy: Occupancy = "VACANT";
  let occupancyLabel = "Boş";
  // Do not infer "owner lives here" — only TENANT proves an occupant in this domain.
  if (tenants.length > 0) {
    occupancy = "TENANT_OCCUPIED";
    occupancyLabel = "Kiracı oturuyor";
  } else if (owners.length > 0) {
    occupancy = "OWNER_OCCUPIED";
    occupancyLabel = "Malik kayıtlı";
  }

  const ownerSummaries = owners.map((rel) => mapPersonSummary(rel.person, options.includePhone));
  const tenantSummaries = tenants.map((rel) => mapPersonSummary(rel.person, options.includePhone));

  const displayPool = tenants.length > 0 ? tenantSummaries : ownerSummaries;
  const displayRole = tenants.length > 0 ? ("TENANT" as const) : owners.length > 0 ? ("OWNER" as const) : null;
  const displayRoleLabel =
    displayRole === "TENANT" ? "Kiracı" : displayRole === "OWNER" ? "Malik" : null;
  const primaryDisplay = displayPool[0] ?? null;
  const residentLabel =
    !primaryDisplay
      ? "Kişi atanmamış"
      : displayPool.length > 1
        ? `${primaryDisplay.fullName} +${displayPool.length - 1}`
        : primaryDisplay.fullName;
  const occupantLine =
    !primaryDisplay
      ? "Kişi atanmamış"
      : displayPool.length > 1
        ? `${primaryDisplay.fullName} +${displayPool.length - 1}`
        : `${primaryDisplay.fullName} · ${displayRoleLabel}`;

  const primaryContactPerson =
    (tenants.find((rel) => rel.isPrimary) ?? tenants[0] ?? owners.find((rel) => rel.isPrimary) ?? owners[0])
      ?.person ?? null;

  const duesStatus = resolveDuesStatusForToday(options.exemption, turkeyTodayUtcMidnight());

  const openAmount = options.debt?.openAmount ?? new Prisma.Decimal(0);
  const overdueAmount = options.debt?.overdueAmount ?? new Prisma.Decimal(0);
  const hasOpenDebt = openAmount.greaterThan(0);
  const debtStatus = !hasOpenDebt
    ? {
        code: "NONE" as const,
        label: "Borcu yok",
        openAmount: "0.00",
        overdueAmount: "0.00",
        isOverdue: false,
      }
    : overdueAmount.greaterThan(0)
      ? {
          code: "OVERDUE" as const,
          label: "Vadesi geçmiş",
          openAmount: toMoneyString(openAmount),
          overdueAmount: toMoneyString(overdueAmount),
          isOverdue: true,
        }
      : {
          code: "OPEN" as const,
          label: `${toMoneyString(openAmount)} TL açık borç`,
          openAmount: toMoneyString(openAmount),
          overdueAmount: "0.00",
          isOverdue: false,
        };

  return {
    id: row.id,
    number: row.number,
    floor: row.floor,
    roomType: row.roomType,
    squareMeters: row.squareMeters,
    hasBalcony: row.hasBalcony,
    isActive: row.isActive,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    building: row.building,
    owners: ownerSummaries,
    tenants: tenantSummaries,
    ownerLabel:
      ownerSummaries.length === 0
        ? "Malik atanmamış"
        : ownerSummaries.length === 1
          ? ownerSummaries[0]!.fullName
          : `${ownerSummaries[0]!.fullName} +${ownerSummaries.length - 1}`,
    residentLabel,
    occupantLine,
    displayPerson: primaryDisplay
      ? {
          id: primaryDisplay.id,
          fullName: primaryDisplay.fullName,
          role: displayRole,
          roleLabel: displayRoleLabel,
        }
      : null,
    occupancy,
    occupancyLabel,
    primaryPhone: options.includePhone ? (primaryContactPerson?.phone ?? null) : null,
    duesStatus: {
      code: duesStatus.code,
      label: duesStatus.label,
      exemption: options.exemption
        ? mapExemptionPublic({
            ...options.exemption,
            isActive: true,
            createdAt: options.exemption.startDate,
            updatedAt: options.exemption.startDate,
            revokedAt: null,
          })
        : null,
    },
    debtStatus,
  };
}

export class ApartmentService {
  async list(
    tenantId: string,
    siteId: string,
    query: ListApartmentsQuery,
    options?: { includePhone?: boolean },
  ) {
    const where: Prisma.ApartmentWhereInput = {
      tenantId,
      deletedAt: null,
      building: {
        siteId,
        deletedAt: null,
      },
    };

    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.floor) where.floor = query.floor;
    if (query.roomType) where.roomType = query.roomType;
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      const phoneDigits = search.replace(/\D/g, "");
      const personOr: Prisma.PersonWhereInput[] = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
      ];
      if (phoneDigits.length >= 4) {
        personOr.push({ phone: { endsWith: phoneDigits.slice(-4) } });
      }
      where.OR = [
        { number: { contains: search, mode: "insensitive" } },
        { building: { name: { contains: search, mode: "insensitive" } } },
        {
          relations: {
            some: {
              tenantId,
              isActive: true,
              person: {
                tenantId,
                deletedAt: null,
                isActive: true,
                OR: personOr,
              },
            },
          },
        },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const now = new Date();
    const today = turkeyTodayUtcMidnight();
    const includePhone = options?.includePhone !== false;

    const [items, total] = await prisma.$transaction([
      prisma.apartment.findMany({
        where,
        select: {
          ...apartmentBaseSelect,
          relations: {
            where: {
              tenantId,
              person: { tenantId, deletedAt: null, isActive: true },
            },
            select: {
              relationType: true,
              isPrimary: true,
              isActive: true,
              startDate: true,
              endDate: true,
              person: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                  isActive: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.perPage,
      }),
      prisma.apartment.count({ where }),
    ]);

    const apartmentIds = items.map((item) => item.id);
    const [exemptions, debtGroups, overdueGroups] = await Promise.all([
      findActiveExemptionsForApartments({
        tenantId,
        siteId,
        apartmentIds,
        referenceDate: today,
      }),
      apartmentIds.length
        ? prisma.apartmentDebt.groupBy({
            by: ["apartmentId"],
            where: {
              tenantId,
              apartmentId: { in: apartmentIds },
              status: "OPEN",
              remainingAmount: { gt: 0 },
              building: { siteId, deletedAt: null },
            },
            _sum: { remainingAmount: true },
          })
        : Promise.resolve([]),
      apartmentIds.length
        ? prisma.apartmentDebt.groupBy({
            by: ["apartmentId"],
            where: {
              tenantId,
              apartmentId: { in: apartmentIds },
              status: "OPEN",
              remainingAmount: { gt: 0 },
              dueDate: { lt: today },
              building: { siteId, deletedAt: null },
            },
            _sum: { remainingAmount: true },
          })
        : Promise.resolve([]),
    ]);

    const debtMap = new Map(
      debtGroups.map((row) => [
        row.apartmentId,
        {
          openAmount: row._sum.remainingAmount ?? new Prisma.Decimal(0),
          overdueAmount: new Prisma.Decimal(0),
        },
      ]),
    );
    for (const row of overdueGroups) {
      const current = debtMap.get(row.apartmentId) ?? {
        openAmount: new Prisma.Decimal(0),
        overdueAmount: new Prisma.Decimal(0),
      };
      debtMap.set(row.apartmentId, {
        ...current,
        overdueAmount: row._sum.remainingAmount ?? new Prisma.Decimal(0),
      });
    }

    return {
      items: items.map((item) =>
        enrichApartment(item, {
          includePhone,
          exemption: exemptions.get(item.id),
          debt: debtMap.get(item.id),
          now,
        }),
      ),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(
    tenantId: string,
    siteId: string,
    id: string,
    options?: { includePhone?: boolean },
  ) {
    const now = new Date();
    const today = turkeyTodayUtcMidnight();
    const includePhone = options?.includePhone !== false;

    const apartment = await prisma.apartment.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        building: { siteId, deletedAt: null },
      },
      select: {
        ...apartmentBaseSelect,
        relations: {
          where: {
            tenantId,
            person: { tenantId, deletedAt: null },
          },
          select: {
            id: true,
            relationType: true,
            isPrimary: true,
            isActive: true,
            startDate: true,
            endDate: true,
            note: true,
            person: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                isActive: true,
                deletedAt: true,
              },
            },
          },
          orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        },
      },
    });

    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı.");
    }

    const [exemptions, debtAgg, overdueAgg] = await Promise.all([
      findActiveExemptionsForApartments({
        tenantId,
        siteId,
        apartmentIds: [apartment.id],
        referenceDate: today,
      }),
      prisma.apartmentDebt.aggregate({
        where: {
          tenantId,
          apartmentId: apartment.id,
          status: "OPEN",
          remainingAmount: { gt: 0 },
          building: { siteId, deletedAt: null },
        },
        _sum: { remainingAmount: true },
      }),
      prisma.apartmentDebt.aggregate({
        where: {
          tenantId,
          apartmentId: apartment.id,
          status: "OPEN",
          remainingAmount: { gt: 0 },
          dueDate: { lt: today },
          building: { siteId, deletedAt: null },
        },
        _sum: { remainingAmount: true },
      }),
    ]);

    const base = enrichApartment(apartment, {
      includePhone,
      exemption: exemptions.get(apartment.id),
      debt: {
        openAmount: debtAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
        overdueAmount: overdueAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
      },
      now,
    });

    const relationHistory = apartment.relations.map((rel) => ({
      id: rel.id,
      relationType: rel.relationType,
      isPrimary: rel.isPrimary,
      isActive: rel.isActive && isRelationActiveNow(rel, now),
      startDate: rel.startDate,
      endDate: rel.endDate,
      note: rel.note,
      person: {
        id: rel.person.id,
        fullName: personFullName(rel.person.firstName, rel.person.lastName),
        phone: includePhone ? rel.person.phone : null,
        email: includePhone ? rel.person.email : null,
        isActive: rel.person.isActive,
        deleted: rel.person.deletedAt != null,
      },
    }));

    return {
      ...base,
      relationHistory,
    };
  }

  async create(tenantId: string, siteId: string, input: CreateApartmentInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);
    await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    await this.assertUniqueNumber(input.buildingId, input.number);

    try {
      const created = await prisma.apartment.create({
        data: {
          tenantId,
          buildingId: input.buildingId,
          number: input.number,
          floor: input.floor ?? null,
          roomType: input.roomType ?? null,
          squareMeters: input.squareMeters,
          hasBalcony: input.hasBalcony ?? null,
          description: input.description,
        },
        select: { id: true },
      });
      return this.getById(tenantId, siteId, created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
      }
      throw error;
    }
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateApartmentInput) {
    const current = await this.getById(tenantId, siteId, id);
    const buildingId = input.buildingId ?? current.building.id;
    const number = input.number ?? current.number;

    if (input.buildingId && input.buildingId !== current.building.id) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
      await this.assertBuildingActive(tenantId, siteId, input.buildingId);
    }

    await this.assertUniqueNumber(buildingId, number, id);

    try {
      await prisma.apartment.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: {
          ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(input.floor !== undefined ? { floor: input.floor } : {}),
          ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
          ...(input.squareMeters !== undefined ? { squareMeters: input.squareMeters } : {}),
          ...(input.hasBalcony !== undefined ? { hasBalcony: input.hasBalcony } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
      }
      throw error;
    }

    return this.getById(tenantId, siteId, id);
  }

  async remove(tenantId: string, siteId: string, id: string) {
    await this.getById(tenantId, siteId, id);

    const result = await prisma.apartment.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Daire bulunamadı.");
    }
  }

  private async assertBuildingActive(tenantId: string, siteId: string, buildingId: string) {
    const building = await prisma.building.findFirst({
      where: {
        id: buildingId,
        tenantId,
        siteId,
      },
      select: { id: true, deletedAt: true, isActive: true },
    });

    if (!building || building.deletedAt != null || !building.isActive) {
      throw new HttpError(400, "Silinmiş veya aktif olmayan bir binaya daire eklenemez.");
    }
  }

  private async assertUniqueNumber(buildingId: string, number: string, excludeId?: string) {
    const existing = await prisma.apartment.findFirst({
      where: {
        buildingId,
        number,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(409, "Bu binada aynı daire numarası zaten kayıtlı.");
    }
  }
}

export const apartmentService = new ApartmentService();
