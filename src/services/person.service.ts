import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { assertApartmentInSite } from "../utils/siteScope";
import type {
  CreatePersonInput,
  CreatePersonWithRelationInput,
  ListPersonsQuery,
  UpdatePersonInput,
} from "../validators/person.validators";

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  nationalId: true,
  gender: true,
  occupation: true,
  birthDate: true,
  note: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const personListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  isActive: true,
  createdAt: true,
  relations: {
    where: { isActive: true },
    select: {
      id: true,
      relationType: true,
      isPrimary: true,
      apartment: {
        select: {
          id: true,
          number: true,
          building: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: [{ relationType: "asc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.PersonSelect;

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function mapPersonListItem(row: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  relations: Array<{
    id: string;
    relationType: "OWNER" | "TENANT";
    isPrimary: boolean;
    apartment: {
      id: string;
      number: string;
      building: { id: string; name: string };
    };
  }>;
}) {
  const owners = row.relations.filter((item) => item.relationType === "OWNER");
  const tenants = row.relations.filter((item) => item.relationType === "TENANT");

  let relationSummary = "—";
  if (owners.length > 0 && tenants.length === 0) {
    relationSummary =
      owners.length === 1
        ? `Mülk Sahibi · ${owners[0].apartment.building.name} / ${owners[0].apartment.number}`
        : `Mülk Sahibi · ${owners.length} daire`;
  } else if (tenants.length > 0 && owners.length === 0) {
    relationSummary =
      tenants.length === 1
        ? `Kiracı · ${tenants[0].apartment.building.name} / ${tenants[0].apartment.number}`
        : `Kiracı · ${tenants.length} daire`;
  } else if (owners.length > 0 && tenants.length > 0) {
    relationSummary = `Mülk Sahibi / Kiracı · ${row.relations.length} daire`;
  }

  const apartmentSummary =
    row.relations.length === 0
      ? "—"
      : row.relations.length === 1
        ? `${row.relations[0].apartment.building.name} / ${row.relations[0].apartment.number}`
        : `${row.relations.length} daire`;

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: fullName(row.firstName, row.lastName),
    phone: row.phone,
    email: row.email,
    isActive: row.isActive,
    createdAt: row.createdAt,
    relationSummary,
    apartmentSummary,
    activeRelations: row.relations.map((item) => ({
      id: item.id,
      relationType: item.relationType,
      isPrimary: item.isPrimary,
      apartment: item.apartment,
    })),
  };
}

function mapPersonDetail(row: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  gender: string | null;
  occupation: string | null;
  birthDate: Date | null;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    fullName: fullName(row.firstName, row.lastName),
  };
}

export class PersonService {
  async list(tenantId: string, query: ListPersonsQuery, siteId?: string | null) {
    const where: Prisma.PersonWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const andParts: Prisma.PersonWhereInput[] = [];

    const search = query.search?.trim();
    if (search) {
      andParts.push({
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    if (query.relationType || query.buildingId || query.apartmentId) {
      andParts.push({
        relations: {
          some: {
            isActive: true,
            ...(query.relationType ? { relationType: query.relationType } : {}),
            ...(query.apartmentId ? { apartmentId: query.apartmentId } : {}),
            apartment: {
              deletedAt: null,
              ...(query.buildingId ? { buildingId: query.buildingId } : {}),
              ...(siteId ? { building: { siteId, deletedAt: null } } : {}),
            },
          },
        },
      });
    } else if (siteId) {
      andParts.push({
        OR: [
          {
            relations: {
              some: {
                isActive: true,
                apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
              },
            },
          },
          {
            relations: { none: { isActive: true } },
          },
        ],
      });
    }

    if (andParts.length > 0) {
      where.AND = andParts;
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.person.findMany({
        where,
        select: personListSelect,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.person.count({ where }),
    ]);

    return {
      items: rows.map(mapPersonListItem),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, id: string) {
    const person = await prisma.person.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: personSelect,
    });

    if (!person) {
      throw new HttpError(404, "Kişi bulunamadı.");
    }

    return mapPersonDetail(person);
  }

  async create(tenantId: string, input: CreatePersonInput) {
    const person = await prisma.person.create({
      data: {
        tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        nationalId: input.nationalId,
        gender: input.gender,
        occupation: input.occupation,
        birthDate: input.birthDate,
        note: input.note,
        isActive: input.isActive ?? true,
      },
      select: personSelect,
    });

    return mapPersonDetail(person);
  }

  async createWithOptionalRelation(
    tenantId: string,
    siteId: string | null,
    input: CreatePersonWithRelationInput,
  ) {
    const { apartmentId, relationType, ...personInput } = input;

    if (!apartmentId) {
      return {
        person: await this.create(tenantId, personInput),
        relation: null,
      };
    }

    if (siteId) {
      await assertApartmentInSite(tenantId, siteId, apartmentId);
    } else {
      const apartment = await prisma.apartment.findFirst({
        where: { id: apartmentId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!apartment) {
        throw new HttpError(404, "Daire bulunamadı.");
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          tenantId,
          firstName: personInput.firstName,
          lastName: personInput.lastName,
          phone: personInput.phone,
          email: personInput.email,
          nationalId: personInput.nationalId,
          gender: personInput.gender,
          occupation: personInput.occupation,
          birthDate: personInput.birthDate,
          note: personInput.note,
          isActive: personInput.isActive ?? true,
        },
        select: personSelect,
      });

      const relation = await tx.apartmentPersonRelation.create({
        data: {
          tenantId,
          apartmentId,
          personId: person.id,
          relationType: relationType!,
          isActive: true,
        },
        select: {
          id: true,
          relationType: true,
          isPrimary: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { person: mapPersonDetail(person), relation };
    });

    return result;
  }

  async update(tenantId: string, id: string, input: UpdatePersonInput) {
    await this.getById(tenantId, id);

    await prisma.person.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.nationalId !== undefined ? { nationalId: input.nationalId } : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
        ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return this.getById(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.getById(tenantId, id);

    const activeRelations = await prisma.apartmentPersonRelation.count({
      where: {
        tenantId,
        personId: id,
        isActive: true,
      },
    });

    if (activeRelations > 0) {
      throw new HttpError(
        409,
        "Bu kişinin aktif daire ilişkileri bulunuyor. Önce ilişkileri sonlandırın.",
      );
    }

    const result = await prisma.person.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Kişi bulunamadı.");
    }
  }
}

export const personService = new PersonService();
