import type { NextFunction, Request, Response } from "express";
import { platformEmailService } from "../services/email/platform-email.service";
import { adminUserIdFrom } from "../middleware/platformAdmin";
import { assertUuidParam, firstZodMessage } from "../utils/admin";
import { HttpError } from "../utils/httpError";
import {
  adminEmailDeliveryListQuerySchema,
  adminEmailIntegrationSchema,
  adminEmailSetActiveSchema,
  adminEmailTestSendSchema,
} from "../validators/admin.validators";

function parse<T>(
  schema: {
    safeParse: (
      data: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
  },
  data: unknown,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
  return parsed.data;
}

export async function getAdminEmailIntegration(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ integration: await platformEmailService.getSafe() });
  } catch (error) {
    next(error);
  }
}

export async function upsertAdminEmailIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminEmailIntegrationSchema, req.body ?? {});
    const result = await platformEmailService.upsert(adminUserIdFrom(req), {
      ...body,
      replyToEmail: body.replyToEmail ?? null,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function setAdminEmailActive(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminEmailSetActiveSchema, req.body ?? {});
    res.status(200).json({ integration: await platformEmailService.setActive(adminUserIdFrom(req), body.isActive) });
  } catch (error) {
    next(error);
  }
}

export async function testAdminEmailConnection(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await platformEmailService.testConnection(adminUserIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function sendAdminEmailTest(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminEmailTestSendSchema, req.body ?? {});
    const delivery = await platformEmailService.sendTestEmail(adminUserIdFrom(req), body.recipientEmail);
    res.status(200).json({ delivery });
  } catch (error) {
    next(error);
  }
}

export async function listAdminEmailDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminEmailDeliveryListQuerySchema, req.query);
    res.status(200).json(await platformEmailService.listDeliveries(query));
  } catch (error) {
    next(error);
  }
}

export async function retryAdminEmailDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await platformEmailService.retryDelivery(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function resendAdminUserInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await platformEmailService.resendWelcome(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function resendAdminTenantNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await platformEmailService.resendPlatformNotification(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
