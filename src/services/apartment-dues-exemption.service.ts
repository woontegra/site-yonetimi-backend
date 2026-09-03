import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { writeTenantAudit } from "./tenant-audit.service";
import {
  exemptionReasonLabel,
  mapExemptionPublic,
} from "./dues-exemption-helpers";
import { isUtcDayInInclusiveRange, turkeyTodayUtcMidnight } from "../utils/turkey-date";
import type {
  CreateApartmentDuesExemptionInput,
  UpdateApartmentDuesExemptionInput,
} from "../validators/apartment-dues-exemption.validators";

const select = {
  id: true,
  apartmentId: true,
  exemptionType: true,
  value: true,
  startDate: true,
  endDate: true,
  reason: true,
  note: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  createdByUserId: true,
  revokedByUserId: true,
  apartment: {
    select: {
      id: true,
      number: true,
      building: { select: { id: true, name: true } },
    },
  },
} as const;

export class ApartmentDuesExemptionService {
  async listForApartment(tenantId: string, siteId: string, apartmentId: string) {
    await this.assertApartmentInSite(tenantId, siteId, apartmentId);
    const rows = await prisma.apartmentDuesExemption.findMany({
      where: { tenantId, siteId, apartmentId },
      select,
      orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    });
    return {
      items: rows.map((row) => ({
        ...mapExemptionPublic(row),
        apartment: row.apartment,
        reasonLabel: exemptionReasonLabel(row.reason),
      })),
    };
  }

  async getActiveForApartment(tenantId: string, siteId: string, apartmentId: string) {
    await this.assertApartmentInSite(tenantId, siteId, apartmentId);
    const today = turkeyTodayUtcMidnight();
    const rows = await prisma.apartmentDuesExemption.findMany({
      where: {
        tenantId,
        siteId,
        apartmentId,
        isActive: true,
        revokedAt: null,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      select,
      orderBy: { createdAt: "desc" },
    });
    const active = rows.find((row) => isUtcDayInInclusiveRange(today, row.startDate, row.endDate));
    return {
      exemption: active
        ? { ...mapExemptionPublic(active), apartment: active.apartment }
        : null,
    };
  }

  async create(
    tenantId: string,
    siteId: string,
    apartmentId: string,
    actorUserId: string,
    input: CreateApartmentDuesExemptionInput,
  ) {
    const apartment = await this.assertApartmentInSite(tenantId, siteId, apartmentId);
    await this.assertNoOverlap(tenantId, apartmentId, input.startDate, input.endDate);

    const created = await prisma.apartmentDuesExemption.create({
      data: {
        tenantId,
        siteId,
        apartmentId,
        exemptionType: input.exemptionType,
        value: input.value != null ? new Prisma.Decimal(input.value) : null,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        note: input.note,
        createdByUserId: actorUserId,
      },
      select,
    });

    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "apartment_dues_exemption.create",
      targetType: "ApartmentDuesExemption",
      targetId: created.id,
      metadata: {
        apartmentId,
        apartmentNumber: apartment.number,
        buildingName: apartment.building.name,
        exemptionType: created.exemptionType,
        startDate: created.startDate.toISOString().slice(0, 10),
        endDate: created.endDate ? created.endDate.toISOString().slice(0, 10) : null,
        reason: created.reason,
      },
    });

    return { exemption: { ...mapExemptionPublic(created), apartment: created.apartment } };
  }

  async update(
    tenantId: string,
    siteId: string,
    id: string,
    actorUserId: string,
    input: UpdateApartmentDuesExemptionInput,
  ) {
    const current = await this.getOwned(tenantId, siteId, id);
    if (!current.isActive || current.revokedAt) {
      throw new HttpError(409, "İptal edilmiş muafiyet düzenlenemez.");
    }

    const startDate = input.startDate ?? current.startDate;
    let endDate = current.endDate;
    if (input.indefinite === true) endDate = null;
    else if (input.endDate !== undefined) endDate = input.endDate;

    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new HttpError(400, "Bitiş tarihi başlangıçtan önce olamaz.");
    }

    await this.assertNoOverlap(tenantId, current.apartmentId, startDate, endDate, id);

    const exemptionType = input.exemptionType ?? current.exemptionType;
    let value: Prisma.Decimal | null = current.value;
    if (exemptionType === "FULL") value = null;
    else if (input.value !== undefined) {
      value = input.value == null ? null : new Prisma.Decimal(input.value);
    }

    await prisma.apartmentDuesExemption.updateMany({
      where: { id, tenantId, siteId, isActive: true },
      data: {
        ...(input.exemptionType !== undefined ? { exemptionType: input.exemptionType } : {}),
        value,
        startDate,
        endDate,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() ? input.note.trim() : null } : {}),
      },
    });

    const updated = await this.getOwned(tenantId, siteId, id);

    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "apartment_dues_exemption.update",
      targetType: "ApartmentDuesExemption",
      targetId: id,
      metadata: {
        apartmentId: updated.apartmentId,
        exemptionType: updated.exemptionType,
        startDate: updated.startDate.toISOString().slice(0, 10),
        endDate: updated.endDate ? updated.endDate.toISOString().slice(0, 10) : null,
        reason: updated.reason,
      },
    });

    return { exemption: { ...mapExemptionPublic(updated), apartment: updated.apartment } };
  }

  async revoke(tenantId: string, siteId: string, id: string, actorUserId: string) {
    const current = await this.getOwned(tenantId, siteId, id);
    if (!current.isActive || current.revokedAt) {
      throw new HttpError(409, "Muafiyet zaten iptal edilmiş.");
    }

    await prisma.apartmentDuesExemption.updateMany({
      where: { id, tenantId, siteId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
      },
    });

    await writeTenantAudit({
      tenantId,
      actorUserId,
      action: "apartment_dues_exemption.revoke",
      targetType: "ApartmentDuesExemption",
      targetId: id,
      metadata: {
        apartmentId: current.apartmentId,
        apartmentNumber: current.apartment.number,
        exemptionType: current.exemptionType,
        startDate: current.startDate.toISOString().slice(0, 10),
        endDate: current.endDate ? current.endDate.toISOString().slice(0, 10) : null,
        reason: current.reason,
      },
    });

    const updated = await this.getOwned(tenantId, siteId, id);
    return { exemption: { ...mapExemptionPublic(updated), apartment: updated.apartment } };
  }

  private async getOwned(tenantId: string, siteId: string, id: string) {
    const row = await prisma.apartmentDuesExemption.findFirst({
      where: { id, tenantId, siteId },
      select,
    });
    if (!row) throw new HttpError(404, "Muafiyet bulunamadı.");
    return row;
  }

  private async assertApartmentInSite(tenantId: string, siteId: string, apartmentId: string) {
    const apartment = await prisma.apartment.findFirst({
      where: {
        id: apartmentId,
        tenantId,
        deletedAt: null,
        building: { siteId, deletedAt: null },
      },
      select: {
        id: true,
        number: true,
        building: { select: { id: true, name: true, siteId: true } },
      },
    });
    if (!apartment) throw new HttpError(404, "Daire bulunamadı.");
    return apartment;
  }

  private async assertNoOverlap(
    tenantId: string,
    apartmentId: string,
    startDate: Date,
    endDate: Date | null,
    excludeId?: string,
  ) {
    const candidates = await prisma.apartmentDuesExemption.findMany({
      where: {
        tenantId,
        apartmentId,
        isActive: true,
        revokedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, startDate: true, endDate: true },
    });

    for (const other of candidates) {
      const otherEnd = other.endDate;
      const overlaps =
        startDate.getTime() <= (otherEnd ? otherEnd.getTime() : Number.POSITIVE_INFINITY) &&
        other.startDate.getTime() <= (endDate ? endDate.getTime() : Number.POSITIVE_INFINITY);
      if (overlaps) {
        throw new HttpError(
          409,
          "Bu daire için seçilen tarihlerle çakışan aktif bir muafiyet zaten var.",
        );
      }
    }
  }
}

export const apartmentDuesExemptionService = new ApartmentDuesExemptionService();
