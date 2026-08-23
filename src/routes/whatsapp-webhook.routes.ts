import { Router } from "express";
import {
  handleWhatsAppWebhook,
  verifyWhatsAppWebhook,
} from "../controllers/whatsapp-webhook.controller";

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get("/", verifyWhatsAppWebhook);
whatsappWebhookRouter.post("/", handleWhatsAppWebhook);
