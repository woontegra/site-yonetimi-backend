import { Router } from "express";
import { getDashboardOverview } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireTenant, requireSite);

dashboardRouter.get("/overview", requirePermission("dashboard.view"), getDashboardOverview);
