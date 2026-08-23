import { Router } from "express";
import {
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
import { requireTenant } from "../middleware/tenant";

export const assetRouter = Router();

assetRouter.use(requireAuth, requireTenant, requireSite);

assetRouter.get("/", listAssets);
assetRouter.get("/:id", getAsset);
assetRouter.get("/:id/movements", listAssetMovements);
assetRouter.get("/:id/maintenances", listAssetMaintenances);
assetRouter.post("/", createAsset);
assetRouter.post("/:id/maintenances", createAssetMaintenance);
assetRouter.patch("/:assetId/maintenances/:maintenanceId", updateAssetMaintenance);
assetRouter.delete("/:assetId/maintenances/:maintenanceId", deleteAssetMaintenance);
assetRouter.patch("/:id", updateAsset);
assetRouter.post("/:id/status", changeAssetStatus);
assetRouter.post("/:id/location", changeAssetLocation);
assetRouter.delete("/:id", deleteAsset);
