import {
  Prisma,
  type FeedbackPriority,
  type FeedbackStatus,
  type FeedbackType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import {
  assertApartmentInSite,
  assertBuildingInSite,
  assertSiteInTenant,
} from "../utils/siteScope";
import { feedbackCategoryService } from "./feedback-category.service";
import type {
  ChangeFeedbackStatusInput,
  CreateFeedbackRecordInput,
  ListFeedbackRecordsQuery,
  UpdateFeedbackRecordInput,
} from "../validators/feedback.validators";

const recordInclude = {
  site: { select: { id: true, name: true } },
  building: { select: { id: true, name: true, code: true } },
  apartment: {
    select: {
      id: true,
      number: true,
      floor: true,
      building: { select: { id: true, name: true } },
    },
  },
  person: { select: { id: true, firstName: true, lastName: true } },
  employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
  category: { select: { id: true, name: true, isActive: true } },
} as const;

type RecordRow = Prisma.FeedbackRecordGetPayload<{ include: typeof recordInclude }>;

function locationLabel(row: RecordRow): string {
  if (row.apartment && row.building) {
    return `${row.building.name} · Daire ${row.apartment.number}`;
  }
  if (row.building) return row.building.name;
  return "Site Geneli";
}

function personName(person: { firstName: string; lastName: string } | null): string | null {
  if (!person) return null;
  return `${person.firstName} ${person.lastName}`.trim();
}

function employeeLabel(
  employee: { firstName: string; lastName: string; jobTitle: string } | null,
): string | null {
  if (!employee) return null;
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  return employee.jobTitle ? `${name} · ${employee.jobTitle}` : name;
}

function mapRecord(row: RecordRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    buildingId: row.buildingId,
    apartmentId: row.apartmentId,
    personId: row.personId,
    employeeId: row.employeeId,
    categoryId: row.categoryId,
    type: row.type,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    locationLabel: locationLabel(row),
    site: row.site,
    building: row.building,
    apartment: row.apartment
      ? {
          id: row.apartment.id,
          number: row.apartment.number,
          floor: row.apartment.floor,
          building: row.apartment.building,
        }
      : null,
    person: row.person
      ? {
          id: row.person.id,
          firstName: row.person.firstName,
          lastName: row.person.lastName,
          fullName: personName(row.person),
        }
      : null,
    employee: row.employee
      ? {
          id: row.employee.id,
          firstName: row.employee.firstName,
          lastName: row.employee.lastName,
          jobTitle: row.employee.jobTitle,
          label: employeeLabel(row.employee),
        }
      : null,
    category: row.category,
  };
}

async function assertPersonInTenant(tenantId: string, personId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!person) throw new HttpError(400, "Seçilen kişi bu hesaba ait değil.");
}

async function assertPersonLinkedToApartment(
  tenantId: string,
  personId: string,
  apartmentId: string | null | undefined,
) {
  if (!apartmentId) return;
  const relation = await prisma.apartmentPersonRelation.findFirst({
    where: {
      tenantId,
      personId,
      apartmentId,
      isActive: true,
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!relation) {
    throw new HttpError(400, "Seçilen kişi bu daire ile ilişkili değil.");
  }
}

async function assertEmployeeAssignableToSite(
  tenantId: string,
  siteId: string,
  employeeId: string,
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!employee) throw new HttpError(400, "Seçilen çalışan kullanılamaz.");

  const assignment = await prisma.employeeAssignment.findFirst({
    where: { tenantId, siteId, employeeId, isActive: true },
    select: { id: true },
  });
  if (!assignment) {
    throw new HttpError(400, "Seçilen çalışanın bu sitede aktif ataması yok.");
  }
}

async function resolveScope(
  tenantId: string,
  siteId: string,
  buildingId: string | null | undefined,
  apartmentId: string | null | undefined,
): Promise<{ buildingId: string | null; apartmentId: string | null }> {
  let nextBuildingId = buildingId ?? null;
  let nextApartmentId = apartmentId ?? null;

  if (nextApartmentId) {
    const apartment = await assertApartmentInSite(tenantId, siteId, nextApartmentId);
    if (nextBuildingId && nextBuildingId !== apartment.buildingId) {
      throw new HttpError(400, "Seçilen daire bu binaya ait değil.");
    }
    nextBuildingId = apartment.buildingId;
  } else if (nextBuildingId) {
    await assertBuildingInSite(tenantId, siteId, nextBuildingId);
  }

  return { buildingId: nextBuildingId, apartmentId: nextApartmentId };
}

async function validateLinks(
  tenantId: string,
  siteId: string,
  input: {
    categoryId?: string | null;
    buildingId?: string | null;
    apartmentId?: string | null;
    personId?: string | null;
    employeeId?: string | null;
  },
  options?: { requireActiveCategory?: boolean },
) {
  const scope = await resolveScope(tenantId, siteId, input.buildingId, input.apartmentId);

  if (input.categoryId) {
    if (options?.requireActiveCategory !== false) {
      await feedbackCategoryService.assertActiveCategory(tenantId, input.categoryId);
    } else {
      const category = await prisma.feedbackCategory.findFirst({
        where: { id: input.categoryId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!category) throw new HttpError(400, "Seçilen kategori kullanılamaz.");
    }
  }

  if (input.personId) {
    await assertPersonInTenant(tenantId, input.personId);
    await assertPersonLinkedToApartment(tenantId, input.personId, scope.apartmentId);
  }

  if (input.employeeId) {
    await assertEmployeeAssignableToSite(tenantId, siteId, input.employeeId);
  }

  return scope;
}

function canEditFully(status: FeedbackStatus): boolean {
  return status === "OPEN" || status === "IN_PROGRESS";
}

export class FeedbackRecordService {
  private async getRaw(tenantId: string, siteId: string, id: string): Promise<RecordRow> {
    const row = await prisma.feedbackRecord.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      include: recordInclude,
    });
    if (!row) throw new HttpError(404, "Kayıt bulunamadı.");
    return row;
  }

  async list(tenantId: string, siteId: string, query: ListFeedbackRecordsQuery) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: false });

    const where: Prisma.FeedbackRecordWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };

    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.apartmentId) where.apartmentId = query.apartmentId;
    if (query.employeeId) where.employeeId = query.employeeId;

    if (query.status) {
      where.status = query.status;
    } else if (query.statusGroup === "open") {
      where.status = { in: ["OPEN", "IN_PROGRESS"] };
    } else if (query.statusGroup === "resolved") {
      where.status = { in: ["RESOLVED", "CLOSED"] };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = query.dateFrom;
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { building: { name: { contains: search, mode: "insensitive" } } },
        { apartment: { number: { contains: search, mode: "insensitive" } } },
        { person: { firstName: { contains: search, mode: "insensitive" } } },
        { person: { lastName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [total, rows, openCount, inProgressCount] = await Promise.all([
      prisma.feedbackRecord.count({ where }),
      prisma.feedbackRecord.findMany({
        where,
        include: recordInclude,
        orderBy: [{ createdAt: "desc" }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      prisma.feedbackRecord.count({
        where: { tenantId, siteId, deletedAt: null, status: "OPEN" },
      }),
      prisma.feedbackRecord.count({
        where: { tenantId, siteId, deletedAt: null, status: "IN_PROGRESS" },
      }),
    ]);

    return {
      items: rows.map(mapRecord),
      page: query.page,
      perPage: query.perPage,
      total,
      summary: {
        open: openCount,
        inProgress: inProgressCount,
        active: openCount + inProgressCount,
      },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    return mapRecord(await this.getRaw(tenantId, siteId, id));
  }

  async listHistory(tenantId: string, siteId: string, id: string) {
    await this.getRaw(tenantId, siteId, id);
    const rows = await prisma.feedbackStatusHistory.findMany({
      where: { tenantId, siteId, feedbackRecordId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        previousStatus: true,
        newStatus: true,
        note: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(tenantId: string, siteId: string, input: CreateFeedbackRecordInput) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: true });

    const scope = await validateLinks(tenantId, siteId, {
      categoryId: input.categoryId,
      buildingId: input.buildingId,
      apartmentId: input.apartmentId,
      personId: input.personId,
      employeeId: input.employeeId,
    });

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.feedbackRecord.create({
        data: {
          tenantId,
          siteId,
          type: input.type,
          title: input.title,
          description: input.description,
          priority: input.priority ?? "NORMAL",
          status: "OPEN",
          categoryId: input.categoryId ?? null,
          buildingId: scope.buildingId,
          apartmentId: scope.apartmentId,
          personId: input.personId ?? null,
          employeeId: input.employeeId ?? null,
        },
      });

      await tx.feedbackStatusHistory.create({
        data: {
          tenantId,
          siteId,
          feedbackRecordId: created.id,
          previousStatus: null,
          newStatus: "OPEN",
          note: "Kayıt oluşturuldu.",
        },
      });

      return tx.feedbackRecord.findFirstOrThrow({
        where: { id: created.id },
        include: recordInclude,
      });
    });

    return mapRecord(row);
  }

  async update(
    tenantId: string,
    siteId: string,
    id: string,
    input: UpdateFeedbackRecordInput,
  ) {
    const existing = await this.getRaw(tenantId, siteId, id);

    if (existing.status === "CLOSED") {
      throw new HttpError(400, "Kapalı kayıt düzenlenemez.");
    }
    if (existing.status === "RESOLVED") {
      throw new HttpError(400, "Çözülmüş kayıt sınırlıdır; durum değiştirerek yeniden açın.");
    }
    if (!canEditFully(existing.status)) {
      throw new HttpError(400, "Bu kayıt düzenlenemez.");
    }

    const nextCategoryId =
      input.categoryId !== undefined ? input.categoryId : existing.categoryId;
    const nextBuildingId =
      input.buildingId !== undefined ? input.buildingId : existing.buildingId;
    const nextApartmentId =
      input.apartmentId !== undefined ? input.apartmentId : existing.apartmentId;
    const nextPersonId = input.personId !== undefined ? input.personId : existing.personId;
    const nextEmployeeId =
      input.employeeId !== undefined ? input.employeeId : existing.employeeId;

    const scope = await validateLinks(
      tenantId,
      siteId,
      {
        categoryId: nextCategoryId,
        buildingId: nextBuildingId,
        apartmentId: nextApartmentId,
        personId: nextPersonId,
        employeeId: nextEmployeeId,
      },
      {
        requireActiveCategory:
          input.categoryId !== undefined && input.categoryId !== existing.categoryId,
      },
    );

    await prisma.feedbackRecord.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: {
        ...(input.type !== undefined ? { type: input.type as FeedbackType } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority as FeedbackPriority } : {}),
        categoryId: nextCategoryId ?? null,
        buildingId: scope.buildingId,
        apartmentId: scope.apartmentId,
        personId: nextPersonId ?? null,
        employeeId: nextEmployeeId ?? null,
      },
    });

    return mapRecord(await this.getRaw(tenantId, siteId, id));
  }

  async changeStatus(
    tenantId: string,
    siteId: string,
    id: string,
    input: ChangeFeedbackStatusInput,
  ) {
    const existing = await this.getRaw(tenantId, siteId, id);
    const next = input.status;

    if (existing.status === next) {
      throw new HttpError(400, "Kayıt zaten bu durumda.");
    }

    if (next === "CLOSED" && existing.status !== "RESOLVED") {
      throw new HttpError(400, "Kayıt kapatılmadan önce çözülmelidir.");
    }

    if (next === "IN_PROGRESS" && existing.status !== "OPEN") {
      throw new HttpError(400, "Yalnızca açık kayıt işleme alınabilir.");
    }

    if (next === "RESOLVED" && existing.status !== "IN_PROGRESS" && existing.status !== "OPEN") {
      throw new HttpError(400, "Bu kayıttan çözüldü durumuna geçilemez.");
    }

    if (next === "OPEN" && existing.status !== "RESOLVED" && existing.status !== "CLOSED") {
      throw new HttpError(400, "Yalnızca çözülmüş veya kapalı kayıt yeniden açılabilir.");
    }

    const data: Prisma.FeedbackRecordUpdateManyMutationInput = {
      status: next,
    };

    if (next === "RESOLVED") {
      data.resolution = input.resolution!;
      data.resolvedAt = new Date();
    }

    const note =
      input.note ||
      (next === "RESOLVED"
        ? input.resolution
        : next === "OPEN"
          ? "Kayıt yeniden açıldı."
          : undefined);

    await prisma.$transaction(async (tx) => {
      await tx.feedbackRecord.updateMany({
        where: { id, tenantId, siteId, deletedAt: null },
        data,
      });
      await tx.feedbackStatusHistory.create({
        data: {
          tenantId,
          siteId,
          feedbackRecordId: id,
          previousStatus: existing.status,
          newStatus: next,
          note: note ?? null,
        },
      });
    });

    return mapRecord(await this.getRaw(tenantId, siteId, id));
  }

  async softDelete(tenantId: string, siteId: string, id: string) {
    const existing = await this.getRaw(tenantId, siteId, id);
    if (existing.status === "OPEN" || existing.status === "IN_PROGRESS") {
      throw new HttpError(
        400,
        "Açık bir kayıt arşivlenemez. Önce kaydı sonuçlandırın.",
      );
    }

    await prisma.feedbackRecord.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { id };
  }
}

export const feedbackRecordService = new FeedbackRecordService();
