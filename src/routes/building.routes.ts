import { Router } from "express";
import {
  createBuilding,
  deleteBuilding,
  getBuilding,
  listBuildings,
  updateBuilding,
} from "../controllers/building.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const buildingRouter = Router();

buildingRouter.use(requireAuth, requireTenant, requireSite);

buildingRouter.get("/", requirePermission("buildings.view"), listBuildings);
buildingRouter.get("/:id", requirePermission("buildings.view"), getBuilding);
buildingRouter.post("/", requirePermission("buildings.manage"), createBuilding);
buildingRouter.patch("/:id", requirePermission("buildings.manage"), updateBuilding);
buildingRouter.delete("/:id", requirePermission("buildings.manage"), deleteBuilding);
