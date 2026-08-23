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
import { requireTenant } from "../middleware/tenant";

export const paymentRouter = Router();

paymentRouter.use(requireAuth, requireTenant, requireSite);

paymentRouter.get("/", listPayments);
paymentRouter.get("/summary/monthly", paymentMonthlySummary);
paymentRouter.get("/:id", getPayment);
paymentRouter.post("/", createPayment);
paymentRouter.delete("/:id", deletePayment);
