import { Router } from "express";
import {
  connectWhatsAppIntegration,
  createCustomWhatsAppTemplate,
  createWhatsAppTemplateFromLibrary,
  deleteWhatsAppTemplateDraft,
  disconnectWhatsAppIntegration,
  duplicateWhatsAppTemplateAsDraft,
  getWhatsAppIntegration,
  listMyWhatsAppTemplates,
  listWhatsAppTemplateLibrary,
  listWhatsAppTemplates,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplates,
  testWhatsAppIntegration,
  updateWhatsAppTemplateDraft,
} from "../controllers/whatsapp-integration.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const whatsappIntegrationRouter = Router();

whatsappIntegrationRouter.use(requireAuth, requireTenant);

whatsappIntegrationRouter.get("/", getWhatsAppIntegration);
whatsappIntegrationRouter.post("/connect", connectWhatsAppIntegration);
whatsappIntegrationRouter.post("/test", testWhatsAppIntegration);
whatsappIntegrationRouter.delete("/", disconnectWhatsAppIntegration);
whatsappIntegrationRouter.post("/templates/sync", syncWhatsAppTemplates);
whatsappIntegrationRouter.get("/templates/library", listWhatsAppTemplateLibrary);
whatsappIntegrationRouter.get("/templates/mine", listMyWhatsAppTemplates);
whatsappIntegrationRouter.post("/templates/from-library", createWhatsAppTemplateFromLibrary);
whatsappIntegrationRouter.post("/templates/custom", createCustomWhatsAppTemplate);
whatsappIntegrationRouter.patch("/templates/:id", updateWhatsAppTemplateDraft);
whatsappIntegrationRouter.delete("/templates/:id", deleteWhatsAppTemplateDraft);
whatsappIntegrationRouter.post("/templates/:id/submit", submitWhatsAppTemplateToMeta);
whatsappIntegrationRouter.post("/templates/:id/duplicate", duplicateWhatsAppTemplateAsDraft);
whatsappIntegrationRouter.get("/templates", listWhatsAppTemplates);
