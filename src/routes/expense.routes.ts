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
import { requireTenant } from "../middleware/tenant";

export const expenseRouter = Router();

expenseRouter.use(requireAuth, requireTenant, requireSite);

expenseRouter.get("/", listExpenses);
expenseRouter.get("/summary/monthly", expenseMonthlySummary);
expenseRouter.get("/:id", getExpense);
expenseRouter.post("/", createExpense);
expenseRouter.patch("/:id", updateExpense);
expenseRouter.delete("/:id", deleteExpense);
