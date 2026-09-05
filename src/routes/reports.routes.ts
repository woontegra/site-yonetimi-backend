import { Router } from "express";
import {
  exportReport,
  getApartmentDebtsReport,
  getApartmentStatementReport,
  getBankTransactionsReport,
  getExpensesReport,
  getFinancialSummaryReport,
  getPaymentsReport,
} from "../controllers/reports.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requireTenant, requireSite);

reportsRouter.get(
  "/financial-summary",
  requirePermission("financeReports.view"),
  getFinancialSummaryReport,
);
reportsRouter.get(
  "/apartment-debts",
  requirePermission("financeReports.view"),
  getApartmentDebtsReport,
);
reportsRouter.get("/payments", requirePermission("financeReports.view"), getPaymentsReport);
reportsRouter.get("/expenses", requirePermission("financeReports.view"), getExpensesReport);
reportsRouter.get(
  "/bank-transactions",
  requirePermission("financeReports.view"),
  getBankTransactionsReport,
);
reportsRouter.get(
  "/apartment-statement",
  requirePermission("financeReports.view"),
  getApartmentStatementReport,
);
reportsRouter.get(
  "/:reportType/export",
  requirePermission("financeReports.view"),
  exportReport,
);
