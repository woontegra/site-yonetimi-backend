import { Router } from "express";
import {
  createSite,
  deleteSite,
  previewSiteDelete,
  getSite,
  listActiveSites,
  listSites,
  updateSite,
} from "../controllers/site.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";
import { requirePermission } from "../middleware/tenant";

export const siteRouter = Router();

siteRouter.use(requireAuth, requireTenant);

siteRouter.get("/", requirePermission("sites.view"), listSites);
siteRouter.get("/active", requirePermission("sites.view"), listActiveSites);
siteRouter.get("/:id/delete-preview", requirePermission("sites.manage"), previewSiteDelete);
siteRouter.get("/:id", requirePermission("sites.view"), getSite);
siteRouter.post("/", requirePermission("sites.manage"), createSite);
siteRouter.patch("/:id", requirePermission("sites.manage"), updateSite);
siteRouter.delete("/:id", requirePermission("sites.manage"), deleteSite);
