import { createHmac, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import {
  extractWebhookStatusUpdates,
  processWhatsAppStatusUpdates,
} from "../services/whatsapp-webhook.service";

type RawBodyRequest = Request & { rawBody?: Buffer };

function verifySignature(req: RawBodyRequest): boolean {
  const secret = env.metaAppSecret;
  if (!secret) return true;

  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string" || !req.rawBody) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(req.rawBody).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function verifyWhatsAppWebhook(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    env.whatsappWebhookVerifyToken &&
    token === env.whatsappWebhookVerifyToken &&
    typeof challenge === "string"
  ) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send("Forbidden");
}

export async function handleWhatsAppWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!verifySignature(req as RawBodyRequest)) {
      res.status(403).json({ ok: false });
      return;
    }

    const updates = extractWebhookStatusUpdates(req.body);
    if (updates.length > 0) {
      await processWhatsAppStatusUpdates(updates);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
