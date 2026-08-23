import { Router } from "express";
import {
  createBankTransaction,
  getBankTransaction,
  ignoreBankTransaction,
  listBankTransactions,
  matchBankTransaction,
  processBankTransaction,
} from "../controllers/bank.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const bankTransactionRouter = Router();

bankTransactionRouter.use(requireAuth, requireTenant, requireSite);

bankTransactionRouter.get("/", listBankTransactions);
bankTransactionRouter.get("/:id", getBankTransaction);
bankTransactionRouter.post("/", createBankTransaction);
bankTransactionRouter.patch("/:id/match", matchBankTransaction);
bankTransactionRouter.post("/:id/process", processBankTransaction);
bankTransactionRouter.post("/:id/ignore", ignoreBankTransaction);
