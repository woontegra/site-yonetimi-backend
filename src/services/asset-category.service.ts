import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import type {
  CreateAssetCategoryInput,
  ListAssetCategoriesQuery,
  UpdateAssetCategoryInput,
} from "../validators/asset.validators";

const DEFAULT_CATEGORIES = [
  "Güvenlik",
  "Temizlik",
  "Bahçe",
  "Teknik",
  "Elektronik",
  "Mobilya",
  "Yangın Ekipmanı",
  "Yönetim Ofisi",
  "Ortak Alan",
  "Diğer",
];

const categorySelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assets: { where: { deletedAt: null } } } },
} as const;

function mapCategory(row: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { assets: number };
}) {
  const { _count, ...rest } = row;
  return { ...rest, assetCount: _count.assets };
}

export class AssetCategoryService {
  async ensureDefaults(tenantId: string) {
    const count = await prisma.assetCategory.count({
      where: { tenantId, deletedAt: null },
    });
    if (count > 0) return;

    await prisma.assetCategory.createMany({
      data: DEFAULT_CATEGORIES.map((name, index) => ({
        tenantId,
        name,
        sortOrder: index + 1,
      })),
    });
  }

  async list(tenantId: string, query: ListAssetCategoriesQuery) {
    await this.ensureDefaults(tenantId);

    const where: Prisma.AssetCategoryWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const rows = await prisma.assetCategory.findMany({
      where,
      select: categorySelect,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return { items: rows.map(mapCategory) };
  }

  async create(tenantId: string, input: CreateAssetCategoryInput) {
    const category = await prisma.assetCategory.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 100,
      },
      select: categorySelect,
    });
    return mapCategory(category);
  }

  async update(tenantId: string, id: string, input: UpdateAssetCategoryInput) {
    const existing = await prisma.assetCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, "Kategori bulunamadı.");

    await prisma.assetCategory.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    const category = await prisma.assetCategory.findFirstOrThrow({
      where: { id, tenantId },
      select: categorySelect,
    });
    return mapCategory(category);
  }

  async softDelete(tenantId: string, id: string) {
    const existing = await prisma.assetCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { assets: { where: { deletedAt: null } } } },
      },
    });
    if (!existing) throw new HttpError(404, "Kategori bulunamadı.");

    if (existing._count.assets > 0) {
      await prisma.assetCategory.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { isActive: false },
      });
      return { id, deactivated: true };
    }

    await prisma.assetCategory.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { id, deactivated: false };
  }

  async assertActiveCategory(tenantId: string, categoryId: string) {
    const category = await prisma.assetCategory.findFirst({
      where: { id: categoryId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new HttpError(400, "Seçilen kategori kullanılamaz.");
    }
  }
}

export const assetCategoryService = new AssetCategoryService();
