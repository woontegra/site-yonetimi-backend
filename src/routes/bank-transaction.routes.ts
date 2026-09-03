import { Router } from "express";
import {
  createBankTransaction,
  getBankTransaction,
  ignoreBankTransaction,
  listBankTransactions,
  matchBankTransaction,
  processBankTransaction,
  unmatchBankTransaction,
} from "../controllers/bank.controller";
import {
  commitBankStatementImport,
  getBankHubSummary,
  previewBankStatementImport,
} from "../controllers/bank-statement.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const bankTransactionRouter = Router();

bankTransactionRouter.use(requireAuth, requireTenant, requireSite);

bankTransactionRouter.get("/", listBankTransactions);
bankTransactionRouter.get("/summary/hub", getBankHubSummary);
bankTransactionRouter.post("/import/preview", previewBankStatementImport);
bankTransactionRouter.post("/import/commit", commitBankStatementImport);
bankTransactionRouter.get("/:id", getBankTransaction);
bankTransactionRouter.post("/", createBankTransaction);
bankTransactionRouter.patch("/:id/match", matchBankTransaction);
bankTransactionRouter.post("/:id/process", processBankTransaction);
bankTransactionRouter.post("/:id/unmatch", unmatchBankTransaction);
bankTransactionRouter.post("/:id/ignore", ignoreBankTransaction);
