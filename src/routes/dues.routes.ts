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
import { requireTenant } from "../middleware/tenant";

export const duesRouter = Router();

duesRouter.use(requireAuth, requireTenant, requireSite);

duesRouter.get("/", listDuesDefinitions);
duesRouter.get("/:id", getDuesDefinition);
duesRouter.get("/:id/charge-preview", previewDuesCharge);
duesRouter.post("/", createDuesDefinition);
duesRouter.post("/:id/charge", chargeDues);
duesRouter.post("/:id/cancel-open-debts", cancelOpenDuesDebts);
duesRouter.patch("/:id", updateDuesDefinition);
duesRouter.delete("/:id", deleteDuesDefinition);
