import { Router } from "express";
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "../controllers/supplier.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const supplierRouter = Router();

supplierRouter.use(requireAuth, requireTenant);

supplierRouter.get("/", listSuppliers);
supplierRouter.get("/:id", getSupplier);
supplierRouter.post("/", createSupplier);
supplierRouter.patch("/:id", updateSupplier);
supplierRouter.delete("/:id", deleteSupplier);
