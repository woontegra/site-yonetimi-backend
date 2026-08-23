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
import { requireTenant } from "../middleware/tenant";

export const buildingRouter = Router();

buildingRouter.use(requireAuth, requireTenant, requireSite);

buildingRouter.get("/", listBuildings);
buildingRouter.get("/:id", getBuilding);
buildingRouter.post("/", createBuilding);
buildingRouter.patch("/:id", updateBuilding);
buildingRouter.delete("/:id", deleteBuilding);
