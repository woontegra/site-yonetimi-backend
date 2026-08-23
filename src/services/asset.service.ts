import { Prisma, type AssetMovementType, type AssetStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { toMoneyString } from "../utils/money";
import { assertApartmentInSite, assertBuildingInSite } from "../utils/siteScope";
import { assetCategoryService } from "./asset-category.service";
import type {
  ChangeAssetLocationInput,
  ChangeAssetStatusInput,
  CreateAssetInput,
  CreateAssetMaintenanceInput,
  ListAssetMaintenancesQuery,
  ListAssetsQuery,
  UpdateAssetInput,
  UpdateAssetMaintenanceInput,
} from "../validators/asset.validators";

const assetInclude = {
  category: { select: { id: true, name: true, isActive: true } },
  building: { select: { id: true, name: true, code: true } },
  apartment: {
    select: { id: true, number: true, building: { select: { id: true, name: true } } },
  },
  site: { select: { id: true, name: true } },
  maintenances: {
    where: { deletedAt: null },
    select: { maintenanceDate: true, nextMaintenanceDate: true },
    orderBy: { maintenanceDate: "desc" },
  },
} as const;

function mapMoney(value: Prisma.Decimal | null | undefined): string | null {
  if (value == null) return null;
  return toMoneyString(value);
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** Son bakım tarihi ve bugünden itibaren en yakın planlı bakım tarihi. */
function maintenanceDates(
  rows: Array<{ maintenanceDate: Date; nextMaintenanceDate: Date | null }>,
): { lastMaintenanceDate: string | null; nextMaintenanceDate: string | null } {
  const latest = rows[0];
  if (!latest) return { lastMaintenanceDate: null, nextMaintenanceDate: null };

  const today = startOfToday();
  let upcoming: Date | null = null;
  for (const row of rows) {
    const next = row.nextMaintenanceDate;
    if (!next || next < today) continue;
    if (!upcoming || next < upcoming) upcoming = next;
  }

  return {
    lastMaintenanceDate: latest.maintenanceDate.toISOString(),
    nextMaintenanceDate: (upcoming ?? latest.nextMaintenanceDate)?.toISOString() ?? null,
  };
}

function mapAsset(row: Prisma.AssetGetPayload<{ include: typeof assetInclude }>) {
  const { lastMaintenanceDate, nextMaintenanceDate } = maintenanceDates(row.maintenances);
  return {
    id: row.id,
    siteId: row.siteId,
    buildingId: row.buildingId,
    apartmentId: row.apartmentId,
    assetCategoryId: row.assetCategoryId,
    name: row.name,
    code: row.code,
    quantity: row.quantity,
    unit: row.unit,
    purchaseDate: row.purchaseDate?.toISOString() ?? null,
    purchasePrice: mapMoney(row.purchasePrice),
    currentValue: mapMoney(row.currentValue),
    supplierName: row.supplierName,
    location: row.location,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    warrantyEndDate: row.warrantyEndDate?.toISOString() ?? null,
    status: row.status,
    description: row.description,
    lastMaintenanceDate,
    nextMaintenanceDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    category: row.category,
    building: row.building,
    apartment: row.apartment,
    site: row.site,
  };
}

function mapMaintenance(row: {
  id: string;
  assetId: string;
  type: string;
  maintenanceDate: Date;
  description: string;
  cost: Prisma.Decimal | null;
  performedBy: string | null;
  nextMaintenanceDate: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    assetId: row.assetId,
    type: row.type,
    maintenanceDate: row.maintenanceDate.toISOString(),
    description: row.description,
    cost: mapMoney(row.cost),
    performedBy: row.performedBy,
    nextMaintenanceDate: row.nextMaintenanceDate?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function moneyOrNull(value: number | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Prisma.Decimal(value);
}

export class AssetService {
  private async getRaw(tenantId: string, siteId: string, id: string) {
    const asset = await prisma.asset.findFirst({
      where: { id, tenantId, siteId, deletedAt: null },
      include: assetInclude,
    });
    if (!asset) throw new HttpError(404, "Demirbaş bulunamadı.");
    return asset;
  }

  /** Demirbaş kodu tenant + site içinde silinmemiş kayıtlar arasında benzersiz olmalıdır. */
  private async assertCodeUnique(
    tenantId: string,
    siteId: string,
    code: string,
    excludeId?: string,
  ) {
    const duplicate = await prisma.asset.findFirst({
      where: {
        tenantId,
        siteId,
        deletedAt: null,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new HttpError(400, "Bu demirbaş kodu bu sitede zaten kullanılıyor.");
    }
  }

  /**
   * Daire seçildiyse bina daireden türetilir; sadece bina verildiyse site içinde doğrulanır.
   * Dönen buildingId undefined ise çağıran mevcut değeri korur.
   */
  private async resolveLocation(
    tenantId: string,
    siteId: string,
    input: { buildingId?: string | null; apartmentId?: string | null },
  ): Promise<{ buildingId?: string | null }> {
    if (input.apartmentId) {
      const apartment = await assertApartmentInSite(tenantId, siteId, input.apartmentId);
      if (input.buildingId && input.buildingId !== apartment.buildingId) {
        throw new HttpError(400, "Seçilen daire bu binaya ait değil.");
      }
      return { buildingId: apartment.buildingId };
    }
    if (input.buildingId) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
      return { buildingId: input.buildingId };
    }
    return { buildingId: input.buildingId === null ? null : undefined };
  }

  async list(tenantId: string, siteId: string, query: ListAssetsQuery) {
    const where: Prisma.AssetWhereInput = {
      tenantId,
      siteId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.categoryId) where.assetCategoryId = query.categoryId;
    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.apartmentId) where.apartmentId = query.apartmentId;

    if (query.upcomingMaintenanceDays) {
      const from = startOfToday();
      const until = new Date(from);
      until.setDate(until.getDate() + query.upcomingMaintenanceDays);
      where.maintenances = {
        some: {
          deletedAt: null,
          nextMaintenanceDate: { gte: from, lte: until },
        },
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const [rows, total, valueAgg, inMaintenance, outOfService] = await prisma.$transaction([
      prisma.asset.findMany({
        where,
        include: assetInclude,
        orderBy: [{ name: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.asset.count({ where }),
      prisma.asset.aggregate({
        where: { ...where, currentValue: { not: null } },
        _sum: { currentValue: true },
      }),
      prisma.asset.count({ where: { ...where, status: "IN_MAINTENANCE" } }),
      prisma.asset.count({ where: { ...where, status: "OUT_OF_SERVICE" } }),
    ]);

    return {
      items: rows.map(mapAsset),
      page: query.page,
      perPage: query.perPage,
      total,
      totalCurrentValue: valueAgg._sum.currentValue
        ? toMoneyString(valueAgg._sum.currentValue)
        : null,
      summary: { total, inMaintenance, outOfService },
    };
  }

  async getById(tenantId: string, siteId: string, id: string) {
    return mapAsset(await this.getRaw(tenantId, siteId, id));
  }

  async listMovements(tenantId: string, siteId: string, assetId: string) {
    await this.getRaw(tenantId, siteId, assetId);

    const rows = await prisma.assetMovement.findMany({
      where: { tenantId, siteId, assetId },
      include: {
        fromBuilding: { select: { id: true, name: true } },
        toBuilding: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        fromBuildingId: row.fromBuildingId,
        toBuildingId: row.toBuildingId,
        fromBuilding: row.fromBuilding,
        toBuilding: row.toBuilding,
        fromLocation: row.fromLocation,
        toLocation: row.toLocation,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        previousQuantity: row.previousQuantity,
        newQuantity: row.newQuantity,
        note: row.note,
        occurredAt: row.occurredAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(tenantId: string, siteId: string, input: CreateAssetInput) {
    const { buildingId } = await this.resolveLocation(tenantId, siteId, input);
    if (input.assetCategoryId) {
      await assetCategoryService.assertActiveCategory(tenantId, input.assetCategoryId);
    }
    if (input.code) {
      await this.assertCodeUnique(tenantId, siteId, input.code);
    }

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          tenantId,
          siteId,
          buildingId: buildingId ?? null,
          apartmentId: input.apartmentId ?? null,
          assetCategoryId: input.assetCategoryId ?? null,
          name: input.name,
          code: input.code ?? null,
          quantity: input.quantity ?? 1,
          unit: input.unit ?? "Adet",
          purchaseDate: input.purchaseDate ?? null,
          purchasePrice:
            input.purchasePrice !== undefined ? new Prisma.Decimal(input.purchasePrice) : null,
          currentValue:
            input.currentValue !== undefined ? new Prisma.Decimal(input.currentValue) : null,
          supplierName: input.supplierName ?? null,
          location: input.location ?? null,
          brand: input.brand ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          warrantyEndDate: input.warrantyEndDate ?? null,
          status: (input.status ?? "ACTIVE") as AssetStatus,
          description: input.description ?? null,
        },
      });

      await tx.assetMovement.create({
        data: {
          tenantId,
          siteId,
          assetId: created.id,
          type: "CREATED",
          toBuildingId: created.buildingId,
          toLocation: created.location,
          newStatus: created.status,
          newQuantity: created.quantity,
          note: "Demirbaş oluşturuldu.",
        },
      });

      return tx.asset.findFirstOrThrow({
        where: { id: created.id },
        include: assetInclude,
      });
    });

    return mapAsset(asset);
  }

  async update(tenantId: string, siteId: string, id: string, input: UpdateAssetInput) {
    const existing = await this.getRaw(tenantId, siteId, id);

    if (input.assetCategoryId) {
      await assetCategoryService.assertActiveCategory(tenantId, input.assetCategoryId);
    }
    if (input.code) {
      await this.assertCodeUnique(tenantId, siteId, input.code, id);
    }

    const resolved = await this.resolveLocation(tenantId, siteId, {
      buildingId: input.buildingId,
      apartmentId:
        input.apartmentId !== undefined ? input.apartmentId : existing.apartmentId,
    });
    const nextBuildingId =
      resolved.buildingId !== undefined ? resolved.buildingId : existing.buildingId;
    const nextLocation = input.location !== undefined ? input.location : existing.location;
    const nextStatus = (input.status !== undefined ? input.status : existing.status) as AssetStatus;
    const nextQuantity = input.quantity !== undefined ? input.quantity : existing.quantity;

    const locationChanged =
      nextBuildingId !== existing.buildingId || nextLocation !== existing.location;
    const statusChanged = nextStatus !== existing.status;
    const quantityChanged = nextQuantity !== existing.quantity;

    const asset = await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id, tenantId, siteId, deletedAt: null },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.assetCategoryId !== undefined
            ? { assetCategoryId: input.assetCategoryId }
            : {}),
          ...(resolved.buildingId !== undefined ? { buildingId: resolved.buildingId } : {}),
          ...(input.apartmentId !== undefined ? { apartmentId: input.apartmentId } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.purchaseDate !== undefined ? { purchaseDate: input.purchaseDate } : {}),
          ...(input.purchasePrice !== undefined
            ? { purchasePrice: moneyOrNull(input.purchasePrice) }
            : {}),
          ...(input.currentValue !== undefined
            ? { currentValue: moneyOrNull(input.currentValue) }
            : {}),
          ...(input.supplierName !== undefined ? { supplierName: input.supplierName } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
          ...(input.warrantyEndDate !== undefined
            ? { warrantyEndDate: input.warrantyEndDate }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });

      type MovementDraft = {
        type: AssetMovementType;
        fromBuildingId?: string | null;
        toBuildingId?: string | null;
        fromLocation?: string | null;
        toLocation?: string | null;
        previousStatus?: AssetStatus | null;
        newStatus?: AssetStatus | null;
        previousQuantity?: number | null;
        newQuantity?: number | null;
        note?: string | null;
      };

      const movements: MovementDraft[] = [];

      if (locationChanged) {
        movements.push({
          type: "LOCATION_CHANGED",
          fromBuildingId: existing.buildingId,
          toBuildingId: nextBuildingId,
          fromLocation: existing.location,
          toLocation: nextLocation,
          note: input.note ?? null,
        });
      }
      if (statusChanged) {
        movements.push({
          type: "STATUS_CHANGED",
          previousStatus: existing.status,
          newStatus: nextStatus,
          note: input.note ?? null,
        });
      }
      if (quantityChanged) {
        movements.push({
          type: "QUANTITY_CHANGED",
          previousQuantity: existing.quantity,
          newQuantity: nextQuantity,
          note: input.note ?? null,
        });
      }

      const meaningfulKeys = Object.keys(input).filter((key) => key !== "note");
      if (
        !locationChanged &&
        !statusChanged &&
        !quantityChanged &&
        meaningfulKeys.length > 0
      ) {
        movements.push({
          type: "UPDATED",
          note: input.note ?? "Demirbaş güncellendi.",
        });
      }

      if (movements.length > 0) {
        await tx.assetMovement.createMany({
          data: movements.map((movement) => ({
            tenantId,
            siteId,
            assetId: id,
            type: movement.type,
            fromBuildingId: movement.fromBuildingId ?? null,
            toBuildingId: movement.toBuildingId ?? null,
            fromLocation: movement.fromLocation ?? null,
            toLocation: movement.toLocation ?? null,
            previousStatus: movement.previousStatus ?? null,
            newStatus: movement.newStatus ?? null,
            previousQuantity: movement.previousQuantity ?? null,
            newQuantity: movement.newQuantity ?? null,
            note: movement.note ?? null,
          })),
        });
      }

      return tx.asset.findFirstOrThrow({
        where: { id, tenantId, siteId },
        include: assetInclude,
      });
    });

    return mapAsset(asset);
  }

  async changeStatus(
    tenantId: string,
    siteId: string,
    id: string,
    input: ChangeAssetStatusInput,
  ) {
    return this.update(tenantId, siteId, id, {
      status: input.status,
      note: input.note,
    });
  }

  async changeLocation(
    tenantId: string,
    siteId: string,
    id: string,
    input: ChangeAssetLocationInput,
  ) {
    if (input.buildingId) {
      await assertBuildingInSite(tenantId, siteId, input.buildingId);
    }

    // Bina değiştiğinde daire ataması geçersiz kalır; birlikte temizlenir.
    const existing = await this.getRaw(tenantId, siteId, id);
    const clearApartment =
      input.buildingId !== undefined &&
      existing.apartmentId != null &&
      input.buildingId !== existing.buildingId;

    return this.update(tenantId, siteId, id, {
      ...(clearApartment ? { apartmentId: null } : {}),
      buildingId: input.buildingId === undefined ? undefined : input.buildingId,
      location: input.location === undefined ? undefined : input.location,
      note: input.note,
    });
  }

  async softDelete(tenantId: string, siteId: string, id: string) {
    await this.getRaw(tenantId, siteId, id);
    await prisma.asset.updateMany({
      where: { id, tenantId, siteId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { id };
  }

  async listMaintenances(
    tenantId: string,
    siteId: string,
    assetId: string,
    query: ListAssetMaintenancesQuery,
  ) {
    await this.getRaw(tenantId, siteId, assetId);

    const where: Prisma.AssetMaintenanceWhereInput = {
      tenantId,
      siteId,
      assetId,
      deletedAt: null,
    };
    if (query.type) where.type = query.type;

    const skip = (query.page - 1) * query.perPage;
    const [rows, total, costAgg] = await prisma.$transaction([
      prisma.assetMaintenance.findMany({
        where,
        orderBy: [{ maintenanceDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.perPage,
      }),
      prisma.assetMaintenance.count({ where }),
      prisma.assetMaintenance.aggregate({
        where: { ...where, cost: { not: null } },
        _sum: { cost: true },
      }),
    ]);

    return {
      items: rows.map(mapMaintenance),
      page: query.page,
      perPage: query.perPage,
      total,
      totalCost: costAgg._sum.cost ? toMoneyString(costAgg._sum.cost) : null,
    };
  }

  async createMaintenance(
    tenantId: string,
    siteId: string,
    assetId: string,
    input: CreateAssetMaintenanceInput,
  ) {
    await this.getRaw(tenantId, siteId, assetId);

    const created = await prisma.assetMaintenance.create({
      data: {
        tenantId,
        siteId,
        assetId,
        type: input.type,
        maintenanceDate: input.maintenanceDate,
        description: input.description,
        cost: input.cost !== undefined ? new Prisma.Decimal(input.cost) : null,
        performedBy: input.performedBy ?? null,
        nextMaintenanceDate: input.nextMaintenanceDate ?? null,
        note: input.note ?? null,
      },
    });

    return mapMaintenance(created);
  }

  async updateMaintenance(
    tenantId: string,
    siteId: string,
    assetId: string,
    maintenanceId: string,
    input: UpdateAssetMaintenanceInput,
  ) {
    await this.getRaw(tenantId, siteId, assetId);
    await this.getRawMaintenance(tenantId, siteId, assetId, maintenanceId);

    await prisma.assetMaintenance.updateMany({
      where: { id: maintenanceId, tenantId, siteId, assetId, deletedAt: null },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.maintenanceDate !== undefined
          ? { maintenanceDate: input.maintenanceDate }
          : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.cost !== undefined ? { cost: moneyOrNull(input.cost) } : {}),
        ...(input.performedBy !== undefined ? { performedBy: input.performedBy } : {}),
        ...(input.nextMaintenanceDate !== undefined
          ? { nextMaintenanceDate: input.nextMaintenanceDate }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });

    const updated = await prisma.assetMaintenance.findFirstOrThrow({
      where: { id: maintenanceId, tenantId, siteId, assetId },
    });
    return mapMaintenance(updated);
  }

  async softDeleteMaintenance(
    tenantId: string,
    siteId: string,
    assetId: string,
    maintenanceId: string,
  ) {
    await this.getRaw(tenantId, siteId, assetId);
    await this.getRawMaintenance(tenantId, siteId, assetId, maintenanceId);

    await prisma.assetMaintenance.updateMany({
      where: { id: maintenanceId, tenantId, siteId, assetId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { id: maintenanceId };
  }

  private async getRawMaintenance(
    tenantId: string,
    siteId: string,
    assetId: string,
    maintenanceId: string,
  ) {
    const maintenance = await prisma.assetMaintenance.findFirst({
      where: { id: maintenanceId, tenantId, siteId, assetId, deletedAt: null },
      select: { id: true },
    });
    if (!maintenance) throw new HttpError(404, "Bakım kaydı bulunamadı.");
    return maintenance;
  }
}

export const assetService = new AssetService();
