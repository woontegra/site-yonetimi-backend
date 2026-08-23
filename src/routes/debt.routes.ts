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
import { requireTenant } from "../middleware/tenant";

export const debtRouter = Router();

debtRouter.use(requireAuth, requireTenant, requireSite);

debtRouter.get("/", listApartmentDebts);
debtRouter.get("/:id", getApartmentDebt);
debtRouter.post("/", createApartmentDebt);
debtRouter.patch("/:id", updateApartmentDebt);
debtRouter.delete("/:id", deleteApartmentDebt);
