import {
  Prisma,
  type AnnouncementAudienceType,
  type AnnouncementStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { normalizeTrPhone } from "../utils/phone";
import {
  assertApartmentInSite,
  assertBuildingInSite,
  assertSiteInTenant,
} from "../utils/siteScope";
import type {
  CreateAnnouncementInput,
  ListAnnouncementsQuery,
  PreviewAudienceInput,
  UpdateAnnouncementInput,
} from "../validators/announcement.validators";

const announcementInclude = {
  site: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, fullName: true, email: true } },
  buildings: {
    include: {
      building: { select: { id: true, name: true, code: true } },
    },
  },
  apartments: {
    include: {
      apartment: {
        select: {
          id: true,
          number: true,
          floor: true,
          building: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.AnnouncementInclude;

type AnnouncementRow = Prisma.AnnouncementGetPayload<{ include: typeof announcementInclude }>;

export type AudienceRecipientPreview = {
  personId: string;
  personName: string;
  phone: string | null;
  normalizedPhone: string | null;
  hasPhone: boolean;
  relationType: "OWNER" | "TENANT";
  buildingId: string;
  buildingName: string;
  apartmentId: string;
  apartmentNumber: string;
};

function audienceLabel(type: AnnouncementAudienceType): string {
  if (type === "ALL_SITE") return "Tüm Site";
  if (type === "BUILDINGS") return "Belirli Binalar";
  return "Belirli Daireler";
}

function targetSummary(row: AnnouncementRow): string {
  if (row.audienceType === "ALL_SITE") return "Tüm Site";
  if (row.audienceType === "BUILDINGS") {
    const count = row.buildings.length;
    if (count === 1) return row.buildings[0]?.building.name ?? "1 bina";
    return `${count} bina`;
  }
  const count = row.apartments.length;
  if (count === 1) return `Daire ${row.apartments[0]?.apartment.number ?? ""}`.trim();
  return `${count} daire`;
}

function mapAnnouncement(row: AnnouncementRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    title: row.title,
    content: row.content,
    audienceType: row.audienceType,
    audienceLabel: audienceLabel(row.audienceType),
    priority: row.priority,
    status: row.status,
    publishAt: row.publishAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByUser: row.createdByUser
      ? {
          id: row.createdByUser.id,
          fullName: row.createdByUser.fullName,
          email: row.createdByUser.email,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    site: row.site,
    targetBuildingCount: row.buildings.length,
    targetApartmentCount: row.apartments.length,
    targetSummary: targetSummary(row),
    buildings: row.buildings.map((item) => ({
      id: item.building.id,
      name: item.building.name,
      code: item.building.code,
    })),
    apartments: row.apartments.map((item) => ({
      id: item.apartment.id,
      number: item.apartment.number,
      floor: item.apartment.floor,
      building: item.apartment.building,
    })),
  };
}

function assertEditable(status: AnnouncementStatus, action: "edit" | "publish" | "archive") {
  if (status === "ARCHIVED") {
    const messages = {
      edit: "Arşivlenmiş duyuru düzenlenemez.",
      publish: "Arşivlenmiş duyuru yayınlanamaz.",
      archive: "Duyuru zaten arşivlenmiş.",
    } as const;
    throw new HttpError(400, messages[action]);
  }
  if (status === "CANCELLED") {
    const messages = {
      edit: "İptal edilmiş duyuru düzenlenemez.",
      publish: "İptal edilmiş duyuru yayınlanamaz.",
      archive: "İptal edilmiş duyuru arşivlenemez.",
    } as const;
    throw new HttpError(400, messages[action]);
  }
}

async function validateTargets(
  tenantId: string,
  siteId: string,
  audienceType: AnnouncementAudienceType,
  buildingIds: string[],
  apartmentIds: string[],
) {
  if (audienceType === "BUILDINGS") {
    for (const buildingId of buildingIds) {
      await assertBuildingInSite(tenantId, siteId, buildingId);
    }
    return { buildingIds, apartmentIds: [] as string[] };
  }
  if (audienceType === "APARTMENTS") {
    for (const apartmentId of apartmentIds) {
      await assertApartmentInSite(tenantId, siteId, apartmentId);
    }
    return { buildingIds: [] as string[], apartmentIds };
  }
  return { buildingIds: [] as string[], apartmentIds: [] as string[] };
}

async function replaceTargets(
  tx: Prisma.TransactionClient,
  tenantId: string,
  announcementId: string,
  audienceType: AnnouncementAudienceType,
  buildingIds: string[],
  apartmentIds: string[],
) {
  await tx.announcementBuilding.deleteMany({ where: { announcementId } });
  await tx.announcementApartment.deleteMany({ where: { announcementId } });

  if (audienceType === "BUILDINGS" && buildingIds.length > 0) {
    await tx.announcementBuilding.createMany({
      data: buildingIds.map((buildingId) => ({
        tenantId,
        announcementId,
        buildingId,
      })),
    });
  }

  if (audienceType === "APARTMENTS" && apartmentIds.length > 0) {
    await tx.announcementApartment.createMany({
      data: apartmentIds.map((apartmentId) => ({
        tenantId,
        announcementId,
        apartmentId,
      })),
    });
  }
}

async function findScoped(tenantId: string, siteId: string, id: string): Promise<AnnouncementRow> {
  const row = await prisma.announcement.findFirst({
    where: { id, tenantId, siteId, deletedAt: null },
    include: announcementInclude,
  });
  if (!row) throw new HttpError(404, "Duyuru bulunamadı.");
  return row;
}

/** Hedef daireleri çözümle. Apartment'ta siteId yok — building.siteId ile filtrele. */
async function resolveApartmentIds(
  tenantId: string,
  siteId: string,
  audienceType: AnnouncementAudienceType,
  buildingIds: string[],
  apartmentIds: string[],
): Promise<string[]> {
  if (audienceType === "ALL_SITE") {
    const rows = await prisma.apartment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  if (audienceType === "BUILDINGS") {
    const rows = await prisma.apartment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        buildingId: { in: buildingIds },
        building: { siteId, deletedAt: null },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  const rows = await prisma.apartment.findMany({
    where: {
      id: { in: apartmentIds },
      tenantId,
      deletedAt: null,
      isActive: true,
      building: { siteId, deletedAt: null },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Aktif OWNER/TENANT ilişkilerinden alıcı listesi. Bu fazda gönderim yok. */
async function resolveRecipients(
  tenantId: string,
  siteId: string,
  apartmentIds: string[],
): Promise<AudienceRecipientPreview[]> {
  if (apartmentIds.length === 0) return [];

  const relations = await prisma.apartmentPersonRelation.findMany({
    where: {
      tenantId,
      isActive: true,
      relationType: { in: ["OWNER", "TENANT"] },
      apartmentId: { in: apartmentIds },
      apartment: {
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      person: { deletedAt: null, isActive: true },
    },
    include: {
      person: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      apartment: {
        select: {
          id: true,
          number: true,
          building: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ apartmentId: "asc" }, { relationType: "asc" }],
  });

  const seen = new Set<string>();
  const recipients: AudienceRecipientPreview[] = [];

  for (const relation of relations) {
    const key = `${relation.person.id}:${relation.apartment.id}:${relation.relationType}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const normalizedPhone = normalizeTrPhone(relation.person.phone);
    recipients.push({
      personId: relation.person.id,
      personName: `${relation.person.firstName} ${relation.person.lastName}`.trim(),
      phone: relation.person.phone,
      normalizedPhone,
      hasPhone: Boolean(normalizedPhone),
      relationType: relation.relationType,
      buildingId: relation.apartment.building.id,
      buildingName: relation.apartment.building.name,
      apartmentId: relation.apartment.id,
      apartmentNumber: relation.apartment.number,
    });
  }

  recipients.sort((a, b) => {
    const byBuilding = a.buildingName.localeCompare(b.buildingName, "tr");
    if (byBuilding !== 0) return byBuilding;
    const byApt = a.apartmentNumber.localeCompare(b.apartmentNumber, "tr", { numeric: true });
    if (byApt !== 0) return byApt;
    return a.personName.localeCompare(b.personName, "tr");
  });

  return recipients;
}

export class AnnouncementService {
  async list(tenantId: string, siteId: string, query: ListAnnouncementsQuery) {
    const where: Prisma.AnnouncementWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.audienceType) where.audienceType = query.audienceType;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total] = await prisma.$transaction([
      prisma.announcement.findMany({
        where,
        include: announcementInclude,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.announcement.count({ where }),
    ]);

    return {
      items: rows.map(mapAnnouncement),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    return mapAnnouncement(await findScoped(tenantId, siteId, id));
  }

  async create(
    tenantId: string,
    siteId: string,
    input: CreateAnnouncementInput,
    options?: { publish?: boolean; createdByUserId?: string | null },
  ) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: true });
    const targets = await validateTargets(
      tenantId,
      siteId,
      input.audienceType,
      input.buildingIds,
      input.apartmentIds,
    );

    const publish = options?.publish === true;
    const now = new Date();

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          tenantId,
          siteId,
          title: input.title.trim(),
          content: input.content.trim(),
          audienceType: input.audienceType,
          priority: input.priority,
          status: publish ? "PUBLISHED" : "DRAFT",
          publishAt: input.publishAt ?? null,
          publishedAt: publish ? now : null,
          expiresAt: input.expiresAt ?? null,
          createdByUserId: options?.createdByUserId ?? null,
        },
      });

      await replaceTargets(
        tx,
        tenantId,
        created.id,
        input.audienceType,
        targets.buildingIds,
        targets.apartmentIds,
      );

      return tx.announcement.findFirstOrThrow({
        where: { id: created.id },
        include: announcementInclude,
      });
    });

    return mapAnnouncement(row);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateAnnouncementInput) {
    const current = await findScoped(tenantId, siteId, id);
    assertEditable(current.status, "edit");

    const nextAudience = input.audienceType ?? current.audienceType;
    const nextBuildingIds =
      input.buildingIds ??
      (nextAudience === "BUILDINGS" ? current.buildings.map((b) => b.building.id) : []);
    const nextApartmentIds =
      input.apartmentIds ??
      (nextAudience === "APARTMENTS" ? current.apartments.map((a) => a.apartment.id) : []);

    if (input.audienceType || input.buildingIds || input.apartmentIds) {
      await validateTargets(tenantId, siteId, nextAudience, nextBuildingIds, nextApartmentIds);
    }

    const row = await prisma.$transaction(async (tx) => {
      await tx.announcement.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.content !== undefined ? { content: input.content.trim() } : {}),
          ...(input.audienceType !== undefined ? { audienceType: input.audienceType } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.publishAt !== undefined ? { publishAt: input.publishAt } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        },
      });

      if (input.audienceType || input.buildingIds || input.apartmentIds) {
        await replaceTargets(tx, tenantId, id, nextAudience, nextBuildingIds, nextApartmentIds);
      }

      return tx.announcement.findFirstOrThrow({
        where: { id },
        include: announcementInclude,
      });
    });

    return mapAnnouncement(row);
  }

  async publish(tenantId: string, siteId: string, id: string) {
    const current = await findScoped(tenantId, siteId, id);
    assertEditable(current.status, "publish");
    if (current.status === "PUBLISHED") {
      throw new HttpError(400, "Duyuru zaten yayında.");
    }

    const row = await prisma.announcement.update({
      where: { id },
      data: {
        status: "PUBLISHED" satisfies AnnouncementStatus,
        publishedAt: new Date(),
      },
      include: announcementInclude,
    });
    return mapAnnouncement(row);
  }

  async archive(tenantId: string, siteId: string, id: string) {
    const current = await findScoped(tenantId, siteId, id);
    assertEditable(current.status, "archive");

    const row = await prisma.announcement.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: announcementInclude,
    });
    return mapAnnouncement(row);
  }

  async cancel(tenantId: string, siteId: string, id: string) {
    const current = await findScoped(tenantId, siteId, id);
    if (current.status === "CANCELLED") {
      throw new HttpError(400, "Duyuru zaten iptal edilmiş.");
    }
    if (current.status === "ARCHIVED") {
      throw new HttpError(400, "Arşivlenmiş duyuru iptal edilemez.");
    }

    const row = await prisma.announcement.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: announcementInclude,
    });
    return mapAnnouncement(row);
  }

  async softDelete(tenantId: string, siteId: string, id: string) {
    await findScoped(tenantId, siteId, id);
    await prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
    });
    return { ok: true };
  }

  /** Hedef kitle önizlemesi — WhatsApp/SMS gönderimi yok. */
  async previewAudience(tenantId: string, siteId: string, input: PreviewAudienceInput) {
    await assertSiteInTenant(tenantId, siteId, { requireActive: true });
    const targets = await validateTargets(
      tenantId,
      siteId,
      input.audienceType,
      input.buildingIds,
      input.apartmentIds,
    );

    const apartmentIds = await resolveApartmentIds(
      tenantId,
      siteId,
      input.audienceType,
      targets.buildingIds,
      targets.apartmentIds,
    );

    const recipients = await resolveRecipients(tenantId, siteId, apartmentIds);
    const withPhone = recipients.filter((r) => r.hasPhone).length;

    return {
      audienceType: input.audienceType,
      audienceLabel: audienceLabel(input.audienceType),
      apartmentCount: apartmentIds.length,
      recipientCount: recipients.length,
      withPhoneCount: withPhone,
      withoutPhoneCount: recipients.length - withPhone,
      recipients: recipients.slice(0, 100),
      truncated: recipients.length > 100,
    };
  }
}

export const announcementService = new AnnouncementService();
