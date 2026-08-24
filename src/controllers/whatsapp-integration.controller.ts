import type { NextFunction, Request, Response } from "express";
import { whatsAppIntegrationService } from "../services/whatsapp-integration.service";
import { whatsAppTemplateLibraryService } from "../services/whatsapp-template-library.service";
import { HttpError } from "../utils/httpError";
import {
  createCustomTemplateSchema,
  createFromLibrarySchema,
  listWhatsAppTemplatesQuerySchema,
  templateIdParamSchema,
  updateDraftTemplateSchema,
  whatsAppConnectSchema,
} from "../validators/whatsapp-integration.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function getWhatsAppIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    const integration = await whatsAppIntegrationService.get(
      tenantIdFrom(req),
      Boolean(req.auth?.isPlatformAdmin),
    );
    res.status(200).json({ integration });
  } catch (error) {
    next(error);
  }
}

export async function connectWhatsAppIntegration(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = whatsAppConnectSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const integration = await whatsAppIntegrationService.connect(tenantIdFrom(req), parsed.data);
    res.status(200).json({ integration });
  } catch (error) {
    next(error);
  }
}

export async function testWhatsAppIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    const integration = await whatsAppIntegrationService.test(tenantIdFrom(req));
    res.status(200).json({ integration });
  } catch (error) {
    next(error);
  }
}

export async function disconnectWhatsAppIntegration(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.status(200).json(await whatsAppIntegrationService.disconnect(tenantIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function syncWhatsAppTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await whatsAppIntegrationService.syncTemplates(tenantIdFrom(req)));
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    console.error(
      "[whatsapp-template-sync]",
      error instanceof Error ? error.message : "Bilinmeyen senkronizasyon hatası",
    );
    next(new HttpError(400, "Şablonlar senkronize edilemedi. Lütfen tekrar deneyin."));
  }
}

export async function listWhatsAppTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listWhatsAppTemplatesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await whatsAppIntegrationService.listTemplates(tenantIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function listWhatsAppTemplateLibrary(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.status(200).json({ items: whatsAppTemplateLibraryService.listLibrary() });
  } catch (error) {
    next(error);
  }
}

export async function listMyWhatsAppTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await whatsAppTemplateLibraryService.listMine(tenantIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function createWhatsAppTemplateFromLibrary(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = createFromLibrarySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const item = await whatsAppTemplateLibraryService.createFromLibrary(
      tenantIdFrom(req),
      parsed.data.libraryKey,
    );
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
}

export async function createCustomWhatsAppTemplate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = createCustomTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const item = await whatsAppTemplateLibraryService.createCustom(
      tenantIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
}

export async function updateWhatsAppTemplateDraft(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const params = templateIdParamSchema.safeParse(req.params);
    if (!params.success) throw new HttpError(400, firstZodMessage(params.error));
    const parsed = updateDraftTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const item = await whatsAppTemplateLibraryService.updateDraft(
      tenantIdFrom(req),
      params.data.id,
      parsed.data,
    );
    res.status(200).json({ item });
  } catch (error) {
    next(error);
  }
}

export async function deleteWhatsAppTemplateDraft(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const params = templateIdParamSchema.safeParse(req.params);
    if (!params.success) throw new HttpError(400, firstZodMessage(params.error));
    res
      .status(200)
      .json(await whatsAppTemplateLibraryService.deleteDraft(tenantIdFrom(req), params.data.id));
  } catch (error) {
    next(error);
  }
}

export async function submitWhatsAppTemplateToMeta(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const params = templateIdParamSchema.safeParse(req.params);
    if (!params.success) throw new HttpError(400, firstZodMessage(params.error));
    res
      .status(200)
      .json(await whatsAppTemplateLibraryService.submitToMeta(tenantIdFrom(req), params.data.id));
  } catch (error) {
    next(error);
  }
}

export async function duplicateWhatsAppTemplateAsDraft(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const params = templateIdParamSchema.safeParse(req.params);
    if (!params.success) throw new HttpError(400, firstZodMessage(params.error));
    const item = await whatsAppTemplateLibraryService.duplicateAsDraft(
      tenantIdFrom(req),
      params.data.id,
    );
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
}
