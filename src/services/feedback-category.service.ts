import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import type {
  CreateFeedbackCategoryInput,
  ListFeedbackCategoriesQuery,
  UpdateFeedbackCategoryInput,
} from "../validators/feedback.validators";

const DEFAULT_CATEGORIES = [
  "Temizlik",
  "Teknik Arıza",
  "Asansör",
  "Güvenlik",
  "Otopark",
  "Ortak Alan",
  "Yönetim",
  "Gürültü",
  "Peyzaj",
  "Diğer",
];

const categorySelect = {
  id: true,
  name: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { records: { where: { deletedAt: null } } } },
} as const;

function mapCategory(row: {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { records: number };
}) {
  const { _count, ...rest } = row;
  return { ...rest, recordCount: _count.records };
}

export class FeedbackCategoryService {
  async ensureDefaults(tenantId: string) {
    const count = await prisma.feedbackCategory.count({
      where: { tenantId, deletedAt: null },
    });
    if (count > 0) return;

    await prisma.feedbackCategory.createMany({
      data: DEFAULT_CATEGORIES.map((name, index) => ({
        tenantId,
        name,
        sortOrder: index + 1,
      })),
    });
  }

  async list(tenantId: string, query: ListFeedbackCategoriesQuery) {
    await this.ensureDefaults(tenantId);

    const where: Prisma.FeedbackCategoryWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;

    const search = query.search?.trim();
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const rows = await prisma.feedbackCategory.findMany({
      where,
      select: categorySelect,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return { items: rows.map(mapCategory) };
  }

  async create(tenantId: string, input: CreateFeedbackCategoryInput) {
    const category = await prisma.feedbackCategory.create({
      data: {
        tenantId,
        name: input.name,
        sortOrder: input.sortOrder ?? 100,
      },
      select: categorySelect,
    });
    return mapCategory(category);
  }

  async update(tenantId: string, id: string, input: UpdateFeedbackCategoryInput) {
    const existing = await prisma.feedbackCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, "Kategori bulunamadı.");

    await prisma.feedbackCategory.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    const category = await prisma.feedbackCategory.findFirstOrThrow({
      where: { id, tenantId },
      select: categorySelect,
    });
    return mapCategory(category);
  }

  async softDelete(tenantId: string, id: string) {
    const existing = await prisma.feedbackCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { records: { where: { deletedAt: null } } } },
      },
    });
    if (!existing) throw new HttpError(404, "Kategori bulunamadı.");

    if (existing._count.records > 0) {
      await prisma.feedbackCategory.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { isActive: false },
      });
      return { id, deactivated: true };
    }

    await prisma.feedbackCategory.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { id, deactivated: false };
  }

  async assertActiveCategory(tenantId: string, categoryId: string) {
    const category = await prisma.feedbackCategory.findFirst({
      where: { id: categoryId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new HttpError(400, "Seçilen kategori kullanılamaz.");
    }
  }
}

export const feedbackCategoryService = new FeedbackCategoryService();
