import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertApartmentInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import type {
  CreateVisitInput,
  ListVisitsQuery,
  UpdateVisitInput,
} from "../validators/visitor.validators";

const visitSelect = {
  id: true,
  purpose: true,
  vehiclePlate: true,
  expectedAt: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  visitor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  },
  apartment: {
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true } },
    },
  },
  hostPerson: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.VisitSelect;

function mapVisit(row: {
  id: string;
  purpose: string | null;
  vehiclePlate: string | null;
  expectedAt: Date | null;
  checkInAt: Date;
  checkOutAt: Date | null;
  status: "EXPECTED" | "INSIDE" | "COMPLETED" | "CANCELLED";
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  visitor: { id: string; firstName: string; lastName: string; phone: string | null };
  apartment: {
    id: string;
    number: string;
    building: { id: string; name: string };
  };
  hostPerson: { id: string; firstName: string; lastName: string } | null;
}) {
  return {
    id: row.id,
    purpose: row.purpose,
    vehiclePlate: row.vehiclePlate,
    expectedAt: row.expectedAt,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    visitor: {
      id: row.visitor.id,
      fullName: `${row.visitor.firstName} ${row.visitor.lastName}`.trim(),
      phone: row.visitor.phone,
    },
    apartment: {
      id: row.apartment.id,
      number: row.apartment.number,
    },
    building: row.apartment.building,
    hostPerson: row.hostPerson
      ? {
          id: row.hostPerson.id,
          fullName: `${row.hostPerson.firstName} ${row.hostPerson.lastName}`.trim(),
        }
      : null,
  };
}

function normalizePlate(value?: string | null) {
  if (!value) return value ?? null;
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

async function assertHostOnApartment(tenantId: string, apartmentId: string, hostPersonId: string) {
  const relation = await prisma.apartmentPersonRelation.findFirst({
    where: {
      tenantId,
      apartmentId,
      personId: hostPersonId,
      isActive: true,
      person: { tenantId, deletedAt: null },
    },
    select: { id: true },
  });
  if (!relation) {
    throw new HttpError(400, "Seçilen kişi bu daireyle aktif olarak ilişkili değil.");
  }
}

export class VisitService {
  async list(tenantId: string, siteId: string, query: ListVisitsQuery) {
    const where: Prisma.VisitWhereInput = {
      tenantId,
      apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
    };

    if (query.apartmentId) where.apartmentId = query.apartmentId;
    if (query.visitorId) where.visitorId = query.visitorId;
    if (query.buildingId) {
      where.apartment = {
        deletedAt: null,
        buildingId: query.buildingId,
        building: { siteId, deletedAt: null },
      };
    }
    if (query.status) where.status = query.status;
    if (query.statusGroup === "active") where.status = "INSIDE";
    if (query.statusGroup === "history") where.status = { in: ["COMPLETED", "CANCELLED"] };
    if (query.vehiclePlate) {
      where.vehiclePlate = { contains: query.vehiclePlate, mode: "insensitive" };
    }
    if (query.dateFrom || query.dateTo) {
      where.checkInAt = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { visitor: { firstName: { contains: search, mode: "insensitive" } } },
        { visitor: { lastName: { contains: search, mode: "insensitive" } } },
        { visitor: { phone: { contains: search, mode: "insensitive" } } },
        { apartment: { number: { contains: search, mode: "insensitive" } } },
        { apartment: { building: { name: { contains: search, mode: "insensitive" } } } },
        { vehiclePlate: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total, insideCount] = await prisma.$transaction([
      prisma.visit.findMany({
        where,
        select: visitSelect,
        orderBy: [{ checkInAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.visit.count({ where }),
      prisma.visit.count({
        where: {
          tenantId,
          status: "INSIDE",
          apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
        },
      }),
    ]);

    return {
      items: rows.map(mapVisit),
      page: query.page,
      perPage: query.perPage,
      total,
      summary: { insideCount },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    const row = await prisma.visit.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: visitSelect,
    });
    if (!row) throw new HttpError(404, "Ziyaret bulunamadı.");
    return mapVisit(row);
  }

  async create(tenantId: string, siteId: string, input: CreateVisitInput) {
    const visitor = await prisma.visitor.findFirst({
      where: { id: input.visitorId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!visitor) throw new HttpError(404, "Misafir bulunamadı.");

    await assertApartmentInSite(tenantId, siteId, input.apartmentId);

    const apartment = await prisma.apartment.findFirst({
      where: {
        id: input.apartmentId,
        tenantId,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!apartment) throw new HttpError(404, "Daire bulunamadı.");

    if (input.hostPersonId) {
      await assertHostOnApartment(tenantId, input.apartmentId, input.hostPersonId);
    }

    const active = await prisma.visit.findFirst({
      where: {
        tenantId,
        visitorId: input.visitorId,
        status: "INSIDE",
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: { id: true },
    });
    if (active) {
      throw new HttpError(409, "Bu misafir için zaten aktif bir ziyaret bulunuyor.");
    }

    const row = await prisma.visit.create({
      data: {
        tenantId,
        visitorId: input.visitorId,
        apartmentId: input.apartmentId,
        hostPersonId: input.hostPersonId,
        purpose: input.purpose,
        vehiclePlate: normalizePlate(input.vehiclePlate),
        checkInAt: input.checkInAt ?? new Date(),
        note: input.note,
        status: "INSIDE",
      },
      select: visitSelect,
    });

    return mapVisit(row);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateVisitInput) {
    const current = await prisma.visit.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: {
        id: true,
        status: true,
        apartmentId: true,
        checkInAt: true,
        checkOutAt: true,
      },
    });
    if (!current) throw new HttpError(404, "Ziyaret bulunamadı.");
    if (current.status === "CANCELLED") {
      throw new HttpError(400, "İptal edilmiş ziyaret düzenlenemez.");
    }

    if (input.hostPersonId) {
      await assertHostOnApartment(tenantId, current.apartmentId, input.hostPersonId);
    }

    const nextCheckIn = input.checkInAt ?? current.checkInAt;
    const nextCheckOut =
      input.checkOutAt === undefined ? current.checkOutAt : input.checkOutAt;

    if (nextCheckOut && nextCheckOut < nextCheckIn) {
      throw new HttpError(400, "Çıkış saati giriş saatinden önce olamaz.");
    }

    const row = await prisma.visit.update({
      where: { id },
      data: {
        ...(input.hostPersonId !== undefined ? { hostPersonId: input.hostPersonId } : {}),
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.vehiclePlate !== undefined
          ? { vehiclePlate: normalizePlate(input.vehiclePlate) }
          : {}),
        ...(input.checkInAt !== undefined ? { checkInAt: input.checkInAt } : {}),
        ...(input.checkOutAt !== undefined ? { checkOutAt: input.checkOutAt } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.checkOutAt && current.status === "INSIDE"
          ? { status: "COMPLETED" as const }
          : {}),
      },
      select: visitSelect,
    });

    return mapVisit(row);
  }

  async checkOut(tenantId: string, siteId: string, id: string) {
    const current = await prisma.visit.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: { id: true, status: true, checkInAt: true },
    });
    if (!current) throw new HttpError(404, "Ziyaret bulunamadı.");
    if (current.status !== "INSIDE") {
      throw new HttpError(400, "Yalnızca içerideki ziyaretler için çıkış yapılabilir.");
    }

    const now = new Date();
    if (now < current.checkInAt) {
      throw new HttpError(400, "Çıkış saati giriş saatinden önce olamaz.");
    }

    const row = await prisma.visit.update({
      where: { id },
      data: {
        checkOutAt: now,
        status: "COMPLETED",
      },
      select: visitSelect,
    });

    return mapVisit(row);
  }

  async cancel(tenantId: string, siteId: string, id: string) {
    const current = await prisma.visit.findFirst({
      where: {
        id,
        tenantId,
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
      select: { id: true, status: true },
    });
    if (!current) throw new HttpError(404, "Ziyaret bulunamadı.");
    if (current.status === "CANCELLED") {
      throw new HttpError(400, "Ziyaret zaten iptal edilmiş.");
    }
    if (current.status === "COMPLETED") {
      throw new HttpError(400, "Tamamlanmış ziyaret iptal edilemez.");
    }

    const row = await prisma.visit.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
      select: visitSelect,
    });

    return mapVisit(row);
  }

  async insideCount(tenantId: string, siteId: string) {
    const insideCount = await prisma.visit.count({
      where: {
        tenantId,
        status: "INSIDE",
        apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
      },
    });
    return { insideCount };
  }
}

export const visitService = new VisitService();
