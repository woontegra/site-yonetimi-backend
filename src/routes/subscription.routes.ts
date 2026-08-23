import { Router } from "express";
import { getMySubscriptionHandler } from "../controllers/subscription.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth, requireTenant);

subscriptionRouter.get("/me", getMySubscriptionHandler);
