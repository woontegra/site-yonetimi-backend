import { Router } from "express";
import {
  changeFeedbackStatus,
  createFeedbackRecord,
  deleteFeedbackRecord,
  getFeedbackRecord,
  listFeedbackRecordHistory,
  listFeedbackRecords,
  updateFeedbackRecord,
} from "../controllers/feedback.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const feedbackRecordRouter = Router();

feedbackRecordRouter.use(requireAuth, requireTenant, requireSite);

feedbackRecordRouter.get("/", listFeedbackRecords);
feedbackRecordRouter.get("/:id", getFeedbackRecord);
feedbackRecordRouter.get("/:id/history", listFeedbackRecordHistory);
feedbackRecordRouter.post("/", createFeedbackRecord);
feedbackRecordRouter.patch("/:id", updateFeedbackRecord);
feedbackRecordRouter.post("/:id/status", changeFeedbackStatus);
feedbackRecordRouter.delete("/:id", deleteFeedbackRecord);
