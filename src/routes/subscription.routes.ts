import { Router } from "express";
import {
  getMySubscriptionHandler,
  listMySubscriptionHistoryHandler,
} from "../controllers/subscription.controller";
import {
  createAnnualLicenseRequestHandler,
  getAnnualLicenseOfferHandler,
} from "../controllers/annual-license-request.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

/** Tenant lisans — site seçimine bağlı değildir (requireSite yok). */
export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth, requireTenant);

subscriptionRouter.get("/me", getMySubscriptionHandler);
subscriptionRouter.get("/me/history", listMySubscriptionHistoryHandler);
subscriptionRouter.get("/annual-offer", getAnnualLicenseOfferHandler);
subscriptionRouter.post("/annual-requests", createAnnualLicenseRequestHandler);
