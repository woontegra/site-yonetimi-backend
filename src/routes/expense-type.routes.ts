import { Router } from "express";
import {
  createExpenseType,
  deleteExpenseType,
  listExpenseTypes,
  updateExpenseType,
} from "../controllers/expense.controller";
import { requireAuth } from "../middleware/auth";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const expenseTypeRouter = Router();

expenseTypeRouter.use(requireAuth, requireTenant);

expenseTypeRouter.get("/", requirePermission("expenses.view"), listExpenseTypes);
expenseTypeRouter.post("/", requirePermission("expenses.manage"), createExpenseType);
expenseTypeRouter.patch("/:id", requirePermission("expenses.manage"), updateExpenseType);
expenseTypeRouter.delete("/:id", requirePermission("expenses.manage"), deleteExpenseType);
