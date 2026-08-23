import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { communicationService } from "../services/communication.service";
import { getIntegrationStatuses } from "../services/message-provider";
import { messageTemplateService } from "../services/message-template.service";
import { HttpError } from "../utils/httpError";
import {
  debtReminderPreviewQuerySchema,
  debtReminderSendSchema,
  listCommunicationMessagesQuerySchema,
  listMessageTemplatesQuerySchema,
  upsertMessageTemplateSchema,
} from "../validators/communication.validators";
import { z } from "zod";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

const setActiveSchema = z.object({
  isActive: z.boolean({ required_error: "isActive zorunludur." }),
});

export async function listMessageTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listMessageTemplatesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await messageTemplateService.list(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function createMessageTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = upsertMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const template = await messageTemplateService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
}

export async function updateMessageTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = upsertMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const template = await messageTemplateService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ template });
  } catch (error) {
    next(error);
  }
}

export async function activateMessageTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = setActiveSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const template = await messageTemplateService.setActive(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data.isActive,
    );
    res.status(200).json({ template });
  } catch (error) {
    next(error);
  }
}

export async function deleteMessageTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    await messageTemplateService.remove(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function previewDebtReminders(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = debtReminderPreviewQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(
        await communicationService.previewDebtReminders(
          tenantIdFrom(req),
          siteIdFrom(req),
          parsed.data,
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function sendDebtReminders(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = debtReminderSendSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const idempotencyKey =
      typeof req.headers["idempotency-key"] === "string"
        ? req.headers["idempotency-key"].trim()
        : undefined;
    res.status(201).json(
      await communicationService.sendDebtReminders(
        tenantIdFrom(req),
        siteIdFrom(req),
        parsed.data,
        idempotencyKey || undefined,
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function listCommunicationMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listCommunicationMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(
        await communicationService.listMessages(tenantIdFrom(req), siteIdFrom(req), parsed.data),
      );
  } catch (error) {
    next(error);
  }
}

export async function listCommunicationBatches(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await communicationService.listBatches(tenantIdFrom(req), siteIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function getIntegrationStatusesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    void tenantIdFrom(req);
    void siteIdFrom(req);
    res.status(200).json(await getIntegrationStatuses(tenantIdFrom(req)));
  } catch (error) {
    next(error);
  }
}
