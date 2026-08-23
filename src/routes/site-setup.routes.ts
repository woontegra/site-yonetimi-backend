import { Router } from "express";
import {
  assignResident,
  bulkCreateApartments,
  bulkCreateBuildings,
  commitImport,
  commitResidentsImport,
  getSetupSummary,
  previewImport,
  previewResidentsImport,
  updateSetupStatus,
} from "../controllers/site-setup.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const siteSetupRouter = Router();

siteSetupRouter.use(requireAuth, requireTenant, requireSite);

siteSetupRouter.get("/summary", getSetupSummary);
siteSetupRouter.patch("/status", updateSetupStatus);
siteSetupRouter.post("/buildings/bulk", bulkCreateBuildings);
siteSetupRouter.post("/apartments/bulk", bulkCreateApartments);
siteSetupRouter.post("/residents", assignResident);
siteSetupRouter.post("/residents/import/preview", previewResidentsImport);
siteSetupRouter.post("/residents/import/commit", commitResidentsImport);
siteSetupRouter.post("/import/preview", previewImport);
siteSetupRouter.post("/import/commit", commitImport);
