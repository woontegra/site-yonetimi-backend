import type { ApartmentRelationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import type {
  CreateRelationInput,
  EndRelationInput,
  ListRelationsQuery,
  UpdateRelationInput,
} from "../validators/relation.validators";

const relationSelect = {
  id: true,
  relationType: true,
  startDate: true,
  endDate: true,
  isPrimary: true,
  isActive: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  person: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      isActive: true,
    },
  },
  apartment: {
    select: {
      id: true,
      number: true,
      building: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

function mapRelation(row: {
  id: string;
  relationType: ApartmentRelationType;
  startDate: Date | null;
  endDate: Date | null;
  isPrimary: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    isActive: boolean;
  };
  apartment: {
    id: string;
    number: string;
    building: { id: string; name: string };
  };
}) {
  return {
    id: row.id,
    relationType: row.relationType,
    startDate: row.startDate,
    endDate: row.endDate,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    person: {
      id: row.person.id,
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      fullName: `${row.person.firstName} ${row.person.lastName}`.trim(),
      phone: row.person.phone,
      email: row.person.email,
      isActive: row.person.isActive,
    },
    apartment: row.apartment,
  };
}

export class RelationService {
  async list(tenantId: string, query: ListRelationsQuery) {
    const where: Prisma.ApartmentPersonRelationWhereInput = {
      tenantId,
      person: { tenantId, deletedAt: null },
      apartment: { tenantId, deletedAt: null },
    };

    if (query.apartmentId) where.apartmentId = query.apartmentId;
    if (query.personId) where.personId = query.personId;
    if (query.relationType) where.relationType = query.relationType;
    if (query.active !== undefined) where.isActive = query.active;

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.apartmentPersonRelation.findMany({
        where,
        select: relationSelect,
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.apartmentPersonRelation.count({ where }),
    ]);

    return {
      items: rows.map(mapRelation),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, id: string) {
    const relation = await prisma.apartmentPersonRelation.findFirst({
      where: {
        id,
        tenantId,
        person: { tenantId, deletedAt: null },
        apartment: { tenantId, deletedAt: null },
      },
      select: relationSelect,
    });

    if (!relation) {
      throw new HttpError(404, "İlişki bulunamadı.");
    }

    return mapRelation(relation);
  }

  async create(tenantId: string, input: CreateRelationInput) {
    const person = await this.assertPerson(tenantId, input.personId);
    await this.assertApartment(tenantId, input.apartmentId);

    if (!person.isActive) {
      throw new HttpError(400, "Pasif kişi yeni daire ilişkisine bağlanamaz.");
    }

    const isPrimary = input.isPrimary ?? false;

    const created = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.apartmentPersonRelation.updateMany({
          where: {
            tenantId,
            apartmentId: input.apartmentId,
            relationType: input.relationType,
            isActive: true,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      return tx.apartmentPersonRelation.create({
        data: {
          tenantId,
          apartmentId: input.apartmentId,
          personId: input.personId,
          relationType: input.relationType,
          startDate: input.startDate,
          endDate: input.endDate,
          isPrimary,
          note: input.note,
          isActive: true,
        },
        select: relationSelect,
      });
    });

    return mapRelation(created);
  }

  async update(tenantId: string, id: string, input: UpdateRelationInput) {
    const current = await this.getById(tenantId, id);

    if (input.isActive === false) {
      return this.end(tenantId, id, { endDate: input.endDate ?? new Date() });
    }

    const relationType = input.relationType ?? current.relationType;
    const isPrimary = input.isPrimary ?? current.isPrimary;

    const updated = await prisma.$transaction(async (tx) => {
      if (isPrimary && current.isActive) {
        await tx.apartmentPersonRelation.updateMany({
          where: {
            tenantId,
            apartmentId: current.apartment.id,
            relationType,
            isActive: true,
            isPrimary: true,
            id: { not: id },
          },
          data: { isPrimary: false },
        });
      }

      await tx.apartmentPersonRelation.updateMany({
        where: { id, tenantId },
        data: {
          ...(input.relationType !== undefined ? { relationType: input.relationType } : {}),
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      });

      return tx.apartmentPersonRelation.findFirst({
        where: { id, tenantId },
        select: relationSelect,
      });
    });

    if (!updated) {
      throw new HttpError(404, "İlişki bulunamadı.");
    }

    return mapRelation(updated);
  }

  async end(tenantId: string, id: string, input: EndRelationInput = {}) {
    await this.getById(tenantId, id);

    const endDate = input.endDate ?? new Date();

    await prisma.apartmentPersonRelation.updateMany({
      where: { id, tenantId, isActive: true },
      data: {
        isActive: false,
        endDate,
        isPrimary: false,
      },
    });

    return this.getById(tenantId, id);
  }

  private async assertPerson(tenantId: string, personId: string) {
    const person = await prisma.person.findFirst({
      where: { id: personId, tenantId, deletedAt: null },
      select: { id: true, isActive: true },
    });

    if (!person) {
      throw new HttpError(404, "Kişi bulunamadı.");
    }

    return person;
  }

  private async assertApartment(tenantId: string, apartmentId: string) {
    const apartment = await prisma.apartment.findFirst({
      where: { id: apartmentId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (!apartment) {
      throw new HttpError(404, "Daire bulunamadı.");
    }

    return apartment;
  }
}

export const relationService = new RelationService();
