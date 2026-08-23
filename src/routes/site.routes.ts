import { Router } from "express";
import {
  createSite,
  deleteSite,
  getSite,
  listActiveSites,
  listSites,
  updateSite,
} from "../controllers/site.controller";
import { requireAuth, requireSiteManager } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const siteRouter = Router();

siteRouter.use(requireAuth, requireTenant);

siteRouter.get("/", listSites);
siteRouter.get("/active", listActiveSites);
siteRouter.get("/:id", getSite);
siteRouter.post("/", createSite);
siteRouter.patch("/:id", updateSite);
siteRouter.delete("/:id", requireSiteManager, deleteSite);
