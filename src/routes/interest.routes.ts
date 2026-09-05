import { Router } from "express";
import {
  applyInterest,
  createInterestDecision,
  deleteInterestDecision,
  getInterestDecision,
  listInterestDecisions,
  previewInterest,
  updateInterestDecision,
} from "../controllers/interest.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const interestRouter = Router();

interestRouter.use(requireAuth, requireTenant, requireSite);

interestRouter.get("/", requirePermission("interest.view"), listInterestDecisions);
interestRouter.post("/preview", requirePermission("interest.view"), previewInterest);
interestRouter.post("/apply", requirePermission("interest.manage"), applyInterest);
interestRouter.get("/:id", requirePermission("interest.view"), getInterestDecision);
interestRouter.post("/", requirePermission("interest.manage"), createInterestDecision);
interestRouter.patch("/:id", requirePermission("interest.manage"), updateInterestDecision);
interestRouter.delete("/:id", requirePermission("interest.manage"), deleteInterestDecision);
