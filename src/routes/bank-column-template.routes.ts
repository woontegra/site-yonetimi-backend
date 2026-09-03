import { Router } from "express";
import {
  createBankColumnTemplate,
  deleteBankColumnTemplate,
  listBankColumnTemplates,
  updateBankColumnTemplate,
} from "../controllers/bank-statement.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const bankColumnTemplateRouter = Router();

bankColumnTemplateRouter.use(requireAuth, requireTenant, requireSite);

bankColumnTemplateRouter.get("/", listBankColumnTemplates);
bankColumnTemplateRouter.post("/", createBankColumnTemplate);
bankColumnTemplateRouter.patch("/:id", updateBankColumnTemplate);
bankColumnTemplateRouter.delete("/:id", deleteBankColumnTemplate);
