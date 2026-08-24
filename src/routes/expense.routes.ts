import { Router } from "express";
import {
  createExpense,
  deleteExpense,
  expenseMonthlySummary,
  getExpense,
  listExpenses,
  updateExpense,
} from "../controllers/expense.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const expenseRouter = Router();

expenseRouter.use(requireAuth, requireTenant, requireSite);

expenseRouter.get("/", requirePermission("expenses.view"), listExpenses);
expenseRouter.get("/summary/monthly", requirePermission("expenses.view"), expenseMonthlySummary);
expenseRouter.get("/:id", requirePermission("expenses.view"), getExpense);
expenseRouter.post("/", requirePermission("expenses.create"), createExpense);
expenseRouter.patch("/:id", requirePermission("expenses.manage"), updateExpense);
expenseRouter.delete("/:id", requirePermission("expenses.cancel"), deleteExpense);
