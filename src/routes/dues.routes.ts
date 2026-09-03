import { Router } from "express";
import {
  cancelOpenDuesDebts,
  chargeDues,
  createDuesDefinition,
  createMultiPeriodAssessment,
  deleteDuesDefinition,
  getAssessmentBatch,
  getDuesDefinition,
  listDuesDefinitions,
  previewDuesCharge,
  previewDuesChargeScope,
  previewDuesPurge,
  previewMultiPeriodAssessment,
  purgeAssessmentBatch,
  purgeDuesAssessment,
  updateDuesDefinition,
} from "../controllers/dues.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const duesRouter = Router();

duesRouter.use(requireAuth, requireTenant, requireSite);

duesRouter.get("/", requirePermission("dues.view"), listDuesDefinitions);
duesRouter.get("/charge-scope-preview", requirePermission("dues.view"), previewDuesChargeScope);
duesRouter.post(
  "/assessment-preview",
  requirePermission("dues.view"),
  previewMultiPeriodAssessment,
);
duesRouter.post(
  "/assessment-batch",
  requirePermission("dues.manage"),
  createMultiPeriodAssessment,
);
duesRouter.get(
  "/batches/:batchId",
  requirePermission("dues.view"),
  getAssessmentBatch,
);
duesRouter.post(
  "/batches/:batchId/purge",
  requirePermission("dues.manage"),
  purgeAssessmentBatch,
);
duesRouter.get("/:id", requirePermission("dues.view"), getDuesDefinition);
duesRouter.get("/:id/charge-preview", requirePermission("dues.view"), previewDuesCharge);
duesRouter.get("/:id/purge-preview", requirePermission("dues.manage"), previewDuesPurge);
duesRouter.post("/", requirePermission("dues.manage"), createDuesDefinition);
duesRouter.post("/:id/charge", requirePermission("dues.manage"), chargeDues);
duesRouter.post("/:id/cancel-open-debts", requirePermission("dues.manage"), cancelOpenDuesDebts);
duesRouter.post("/:id/purge", requirePermission("dues.manage"), purgeDuesAssessment);
duesRouter.patch("/:id", requirePermission("dues.manage"), updateDuesDefinition);
duesRouter.delete("/:id", requirePermission("dues.manage"), deleteDuesDefinition);
