import { Router } from "express";
import {
  createBankMatchingRule,
  deleteBankMatchingRule,
  listBankMatchingRules,
  updateBankMatchingRule,
} from "../controllers/bank.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const bankMatchingRuleRouter = Router();

bankMatchingRuleRouter.use(requireAuth, requireTenant, requireSite);

bankMatchingRuleRouter.get("/", listBankMatchingRules);
bankMatchingRuleRouter.post("/", createBankMatchingRule);
bankMatchingRuleRouter.patch("/:id", updateBankMatchingRule);
bankMatchingRuleRouter.delete("/:id", deleteBankMatchingRule);
