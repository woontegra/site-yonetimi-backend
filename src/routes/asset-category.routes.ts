import { Router } from "express";
import {
  createAssetCategory,
  deleteAssetCategory,
  listAssetCategories,
  updateAssetCategory,
} from "../controllers/asset.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const assetCategoryRouter = Router();

assetCategoryRouter.use(requireAuth, requireTenant);

assetCategoryRouter.get("/", listAssetCategories);
assetCategoryRouter.post("/", createAssetCategory);
assetCategoryRouter.patch("/:id", updateAssetCategory);
assetCategoryRouter.delete("/:id", deleteAssetCategory);
