import { Router } from "express";
import {
  confirmBankTransactionMatch,
  classifyBankDebit,
  createBankTransaction,
  getBankTransaction,
  ignoreBankTransaction,
  listBankTransactions,
  matchBankTransaction,
  previewBankTransactionProcessBatch,
  processBankTransaction,
  processBankTransactionAuto,
  processBankTransactionBatch,
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
bankTransactionRouter.post("/process-batch/preview", previewBankTransactionProcessBatch);
bankTransactionRouter.post("/process-batch", processBankTransactionBatch);
bankTransactionRouter.get("/:id", getBankTransaction);
bankTransactionRouter.post("/", createBankTransaction);
bankTransactionRouter.patch("/:id/match", matchBankTransaction);
bankTransactionRouter.post("/:id/confirm-match", confirmBankTransactionMatch);
bankTransactionRouter.post("/:id/classify-debit", classifyBankDebit);
bankTransactionRouter.post("/:id/process", processBankTransaction);
bankTransactionRouter.post("/:id/process-auto", processBankTransactionAuto);
bankTransactionRouter.post("/:id/unmatch", unmatchBankTransaction);
bankTransactionRouter.post("/:id/ignore", ignoreBankTransaction);
