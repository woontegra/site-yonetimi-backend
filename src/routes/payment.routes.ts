import { Router } from "express";
import {
  createPayment,
  deletePayment,
  getPayment,
  listPayments,
  paymentMonthlySummary,
} from "../controllers/payment.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const paymentRouter = Router();

paymentRouter.use(requireAuth, requireTenant, requireSite);

paymentRouter.get("/", requirePermission("payments.view"), listPayments);
paymentRouter.get("/summary/monthly", requirePermission("payments.view"), paymentMonthlySummary);
paymentRouter.get("/:id", requirePermission("payments.view"), getPayment);
paymentRouter.post("/", requirePermission("payments.create"), createPayment);
paymentRouter.delete("/:id", requirePermission("payments.cancel"), deletePayment);
