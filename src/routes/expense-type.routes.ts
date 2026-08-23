import { Router } from "express";
import {
  createExpenseType,
  deleteExpenseType,
  listExpenseTypes,
  updateExpenseType,
} from "../controllers/expense.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const expenseTypeRouter = Router();

expenseTypeRouter.use(requireAuth, requireTenant);

expenseTypeRouter.get("/", listExpenseTypes);
expenseTypeRouter.post("/", createExpenseType);
expenseTypeRouter.patch("/:id", updateExpenseType);
expenseTypeRouter.delete("/:id", deleteExpenseType);
