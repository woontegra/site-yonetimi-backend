import { Router } from "express";
import {
  createApartmentDebt,
  deleteApartmentDebt,
  getApartmentDebt,
  listApartmentDebts,
  updateApartmentDebt,
} from "../controllers/debt.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const debtRouter = Router();

debtRouter.use(requireAuth, requireTenant, requireSite);

debtRouter.get("/", requirePermission("debts.view"), listApartmentDebts);
debtRouter.get("/:id", requirePermission("debts.view"), getApartmentDebt);
debtRouter.post("/", requirePermission("debts.create"), createApartmentDebt);
debtRouter.patch("/:id", requirePermission("debts.create"), updateApartmentDebt);
debtRouter.delete("/:id", requirePermission("debts.cancel"), deleteApartmentDebt);
