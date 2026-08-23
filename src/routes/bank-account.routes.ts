import { Router } from "express";
import {
  createBankAccount,
  deleteBankAccount,
  getBankAccount,
  listBankAccounts,
  updateBankAccount,
} from "../controllers/bank.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const bankAccountRouter = Router();

bankAccountRouter.use(requireAuth, requireTenant, requireSite);

bankAccountRouter.get("/", listBankAccounts);
bankAccountRouter.get("/:id", getBankAccount);
bankAccountRouter.post("/", createBankAccount);
bankAccountRouter.patch("/:id", updateBankAccount);
bankAccountRouter.delete("/:id", deleteBankAccount);
