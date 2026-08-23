import { Router } from "express";
import {
  activateMessageTemplate,
  createMessageTemplate,
  deleteMessageTemplate,
  getIntegrationStatusesHandler,
  listCommunicationBatches,
  listCommunicationMessages,
  listMessageTemplates,
  previewDebtReminders,
  sendDebtReminders,
  updateMessageTemplate,
} from "../controllers/communication.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const communicationRouter = Router();

communicationRouter.use(requireAuth, requireTenant, requireSite);

communicationRouter.get("/message-templates", listMessageTemplates);
communicationRouter.post("/message-templates", createMessageTemplate);
communicationRouter.patch("/message-templates/:id", updateMessageTemplate);
communicationRouter.post("/message-templates/:id/activate", activateMessageTemplate);
communicationRouter.delete("/message-templates/:id", deleteMessageTemplate);

communicationRouter.get("/debt-reminders/preview", previewDebtReminders);
communicationRouter.post("/debt-reminders/send", sendDebtReminders);

communicationRouter.get("/messages", listCommunicationMessages);
communicationRouter.get("/batches", listCommunicationBatches);
communicationRouter.get("/integrations/status", getIntegrationStatusesHandler);
