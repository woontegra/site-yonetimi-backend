import { Router } from "express";
import {
  getMySubscriptionHandler,
  listMySubscriptionHistoryHandler,
} from "../controllers/subscription.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

/** Tenant lisans — site seçimine bağlı değildir (requireSite yok). */
export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth, requireTenant);

subscriptionRouter.get("/me", getMySubscriptionHandler);
subscriptionRouter.get("/me/history", listMySubscriptionHistoryHandler);
