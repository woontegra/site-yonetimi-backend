import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { assetCategoryService } from "../services/asset-category.service";
import { assetService } from "../services/asset.service";
import { HttpError } from "../utils/httpError";
import {
  changeAssetLocationSchema,
  changeAssetStatusSchema,
  createAssetCategorySchema,
  createAssetMaintenanceSchema,
  createAssetSchema,
  listAssetCategoriesQuerySchema,
  listAssetMaintenancesQuerySchema,
  listAssetsQuerySchema,
  updateAssetCategorySchema,
  updateAssetMaintenanceSchema,
  updateAssetSchema,
} from "../validators/asset.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listAssetCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listAssetCategoriesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await assetCategoryService.list(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function createAssetCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createAssetCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const category = await assetCategoryService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
}

export async function updateAssetCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateAssetCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const category = await assetCategoryService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ category });
  } catch (error) {
    next(error);
  }
}

export async function deleteAssetCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await assetCategoryService.softDelete(tenantIdFrom(req), String(req.params.id));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listAssets(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listAssetsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await assetService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const asset = await assetService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function listAssetMovements(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(
        await assetService.listMovements(
          tenantIdFrom(req),
          siteIdFrom(req),
          String(req.params.id),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function createAsset(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createAssetSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const asset = await assetService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function updateAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateAssetSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const asset = await assetService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function changeAssetStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = changeAssetStatusSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const asset = await assetService.changeStatus(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function changeAssetLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = changeAssetLocationSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const asset = await assetService.changeLocation(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function deleteAsset(req: Request, res: Response, next: NextFunction) {
  try {
    await assetService.softDelete(tenantIdFrom(req), siteIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function listAssetMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listAssetMaintenancesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(
        await assetService.listMaintenances(
          tenantIdFrom(req),
          siteIdFrom(req),
          String(req.params.id),
          parsed.data,
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function createAssetMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createAssetMaintenanceSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const maintenance = await assetService.createMaintenance(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(201).json({ maintenance });
  } catch (error) {
    next(error);
  }
}

export async function updateAssetMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateAssetMaintenanceSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const maintenance = await assetService.updateMaintenance(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.assetId),
      String(req.params.maintenanceId),
      parsed.data,
    );
    res.status(200).json({ maintenance });
  } catch (error) {
    next(error);
  }
}

export async function deleteAssetMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    await assetService.softDeleteMaintenance(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.assetId),
      String(req.params.maintenanceId),
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
