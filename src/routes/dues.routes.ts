import { Router } from "express";
import {
  cancelOpenDuesDebts,
  chargeDues,
  createDuesDefinition,
  deleteDuesDefinition,
  getDuesDefinition,
  listDuesDefinitions,
  previewDuesCharge,
  updateDuesDefinition,
} from "../controllers/dues.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const duesRouter = Router();

duesRouter.use(requireAuth, requireTenant, requireSite);

duesRouter.get("/", requirePermission("dues.view"), listDuesDefinitions);
duesRouter.get("/:id", requirePermission("dues.view"), getDuesDefinition);
duesRouter.get("/:id/charge-preview", requirePermission("dues.view"), previewDuesCharge);
duesRouter.post("/", requirePermission("dues.manage"), createDuesDefinition);
duesRouter.post("/:id/charge", requirePermission("dues.manage"), chargeDues);
duesRouter.post("/:id/cancel-open-debts", requirePermission("dues.manage"), cancelOpenDuesDebts);
duesRouter.patch("/:id", requirePermission("dues.manage"), updateDuesDefinition);
duesRouter.delete("/:id", requirePermission("dues.manage"), deleteDuesDefinition);
