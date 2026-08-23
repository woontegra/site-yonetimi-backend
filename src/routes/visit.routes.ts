import { Router } from "express";
import {
  cancelVisit,
  checkOutVisit,
  createVisit,
  getVisit,
  listVisits,
  updateVisit,
  visitInsideSummary,
} from "../controllers/visitor.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const visitRouter = Router();

visitRouter.use(requireAuth, requireTenant, requireSite);

visitRouter.get("/", listVisits);
visitRouter.get("/summary/inside", visitInsideSummary);
visitRouter.get("/:id", getVisit);
visitRouter.post("/", createVisit);
visitRouter.patch("/:id", updateVisit);
visitRouter.post("/:id/check-out", checkOutVisit);
visitRouter.post("/:id/cancel", cancelVisit);
