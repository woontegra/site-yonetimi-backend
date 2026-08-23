import { Router } from "express";
import {
  createFeedbackCategory,
  deleteFeedbackCategory,
  listFeedbackCategories,
  updateFeedbackCategory,
} from "../controllers/feedback.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const feedbackCategoryRouter = Router();

feedbackCategoryRouter.use(requireAuth, requireTenant);

feedbackCategoryRouter.get("/", listFeedbackCategories);
feedbackCategoryRouter.post("/", createFeedbackCategory);
feedbackCategoryRouter.patch("/:id", updateFeedbackCategory);
feedbackCategoryRouter.delete("/:id", deleteFeedbackCategory);
