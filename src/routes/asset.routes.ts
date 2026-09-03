import { Router } from "express";
import {
  archiveAsset,
  changeAssetLocation,
  changeAssetStatus,
  createAsset,
  createAssetMaintenance,
  deleteAsset,
  deleteAssetMaintenance,
  getAsset,
  listAssetMaintenances,
  listAssetMovements,
  listAssets,
  updateAsset,
  updateAssetMaintenance,
} from "../controllers/asset.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const assetRouter = Router();

assetRouter.use(requireAuth, requireTenant, requireSite);

assetRouter.get("/", requirePermission("assets.view"), listAssets);
assetRouter.get("/:id", requirePermission("assets.view"), getAsset);
assetRouter.get("/:id/movements", requirePermission("assets.view"), listAssetMovements);
assetRouter.get("/:id/maintenances", requirePermission("assets.view"), listAssetMaintenances);
assetRouter.post("/", requirePermission("assets.manage"), createAsset);
assetRouter.post("/:id/maintenances", requirePermission("assets.manage"), createAssetMaintenance);
assetRouter.patch("/:assetId/maintenances/:maintenanceId", requirePermission("assets.manage"), updateAssetMaintenance);
assetRouter.delete("/:assetId/maintenances/:maintenanceId", requirePermission("assets.manage"), deleteAssetMaintenance);
assetRouter.patch("/:id", requirePermission("assets.manage"), updateAsset);
assetRouter.post("/:id/status", requirePermission("assets.manage"), changeAssetStatus);
assetRouter.post("/:id/location", requirePermission("assets.manage"), changeAssetLocation);
assetRouter.post("/:id/archive", requirePermission("assets.manage"), archiveAsset);
assetRouter.delete("/:id", requirePermission("assets.manage"), deleteAsset);
