import type { NextFunction, Request, Response } from "express";
import { adminAuditService } from "../services/admin-audit.service";
import { adminCommunicationService } from "../services/admin-communication.service";
import { adminIntegrationService } from "../services/admin-integration.service";
import { adminOverviewService } from "../services/admin-overview.service";
import { adminSiteService } from "../services/admin-site.service";
import { adminSubscriptionService } from "../services/admin-subscription.service";
import { adminSystemService } from "../services/admin-system.service";
import { adminTenantService } from "../services/admin-tenant.service";
import { adminUserService } from "../services/admin-user.service";
import { adminUserIdFrom } from "../middleware/platformAdmin";
import { assertUuidParam, firstZodMessage } from "../utils/admin";
import { HttpError } from "../utils/httpError";
import {
  adminAuditListQuerySchema,
  adminCommunicationListQuerySchema,
  adminEndsAtSchema,
  adminExtendSchema,
  adminIntegrationListQuerySchema,
  adminNoteSchema,
  adminPlanSchema,
  adminSiteListQuerySchema,
  adminSubscriptionListQuerySchema,
  adminTenantListQuerySchema,
  adminTrialSchema,
  adminUserListQuerySchema,
  adminCreateTenantSchema,
} from "../validators/admin.validators";

function parse<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
  return parsed.data;
}

export async function getAdminOverview(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminOverviewService.getOverview());
  } catch (error) {
    next(error);
  }
}

export async function listAdminTenants(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminTenantListQuerySchema, req.query);
    res.status(200).json(await adminTenantService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function createAdminTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminCreateTenantSchema, req.body ?? {});
    const result = await adminTenantService.create(adminUserIdFrom(req), body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAdminTenant(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ tenant: await adminTenantService.getById(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function listAdminTenantSites(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ items: await adminTenantService.listSites(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function listAdminTenantUsers(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ items: await adminTenantService.listUsers(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function listAdminTenantNotes(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ items: await adminTenantService.listNotes(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function createAdminTenantNote(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminNoteSchema, req.body);
    const note = await adminTenantService.addNote(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
      body.content,
    );
    res.status(201).json({ note });
  } catch (error) {
    next(error);
  }
}

export async function activateAdminTenant(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminTenantService.setActive(adminUserIdFrom(req), assertUuidParam(String(req.params.id)), true));
  } catch (error) {
    next(error);
  }
}

export async function deactivateAdminTenant(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminTenantService.setActive(adminUserIdFrom(req), assertUuidParam(String(req.params.id)), false));
  } catch (error) {
    next(error);
  }
}

export async function extendAdminTenantSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminExtendSchema, req.body ?? {});
    if (body.days == null && !body.endsAt) {
      throw new HttpError(400, "Gün sayısı veya bitiş tarihi gerekli.");
    }
    const subscription = await adminTenantService.extendSubscription(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
      { days: body.days, endsAt: body.endsAt, plan: body.plan },
    );
    res.status(200).json({ subscription });
  } catch (error) {
    next(error);
  }
}

export async function trialAdminTenantSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminTrialSchema, req.body ?? {});
    const subscription = await adminTenantService.extendSubscription(
      adminUserIdFrom(req),
      assertUuidParam(String(req.params.id)),
      { trialDays: body.days },
    );
    res.status(200).json({ subscription });
  } catch (error) {
    next(error);
  }
}

export async function listAdminTenantAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminAuditListQuerySchema, req.query);
    res.status(200).json(
      await adminAuditService.list({
        ...query,
        tenantId: assertUuidParam(String(req.params.id)),
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function getAdminUserSummary(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminUserService.summary());
  } catch (error) {
    next(error);
  }
}

export async function listAdminUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminUserListQuerySchema, req.query);
    res.status(200).json(await adminUserService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function getAdminUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ user: await adminUserService.getById(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function activateAdminUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminUserService.setActive(adminUserIdFrom(req), assertUuidParam(String(req.params.id)), true));
  } catch (error) {
    next(error);
  }
}

export async function deactivateAdminUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminUserService.setActive(adminUserIdFrom(req), assertUuidParam(String(req.params.id)), false));
  } catch (error) {
    next(error);
  }
}

export async function createAdminUserNote(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminNoteSchema, req.body);
    const user = await adminUserService.getById(assertUuidParam(String(req.params.id)));
    if (!user.tenant) throw new HttpError(400, "Kullanıcının bağlı olduğu bir tenant yok.");
    const note = await adminTenantService.addNote(adminUserIdFrom(req), user.tenant.id, body.content);
    res.status(201).json({ note });
  } catch (error) {
    next(error);
  }
}

export async function listAdminUserAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminAuditListQuerySchema, req.query);
    res.status(200).json(
      await adminAuditService.list({
        ...query,
        targetType: "User",
        targetId: assertUuidParam(String(req.params.id)),
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function listAdminSites(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminSiteListQuerySchema, req.query);
    res.status(200).json(await adminSiteService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function getAdminSite(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ site: await adminSiteService.getById(assertUuidParam(String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function listAdminSubscriptions(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminSubscriptionListQuerySchema, req.query);
    res.status(200).json(await adminSubscriptionService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function extendAdminSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminExtendSchema, req.body ?? {});
    const tenantId = assertUuidParam(String(req.params.tenantId), "Geçersiz tenant.");
    if (body.endsAt) {
      res.status(200).json({
        subscription: await adminSubscriptionService.setEndsAt(adminUserIdFrom(req), tenantId, body.endsAt),
      });
      return;
    }
    res.status(200).json({
      subscription: await adminSubscriptionService.extendDays(adminUserIdFrom(req), tenantId, body.days ?? 7),
    });
  } catch (error) {
    next(error);
  }
}

export async function changeAdminSubscriptionPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminPlanSchema, req.body);
    res.status(200).json({
      subscription: await adminSubscriptionService.changePlan(
        adminUserIdFrom(req),
        assertUuidParam(String(req.params.tenantId), "Geçersiz tenant."),
        body.plan,
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function suspendAdminSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      subscription: await adminSubscriptionService.setStatus(
        adminUserIdFrom(req),
        assertUuidParam(String(req.params.tenantId), "Geçersiz tenant."),
        "SUSPENDED",
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function reactivateAdminSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      subscription: await adminSubscriptionService.setStatus(
        adminUserIdFrom(req),
        assertUuidParam(String(req.params.tenantId), "Geçersiz tenant."),
        "ACTIVE",
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function setAdminSubscriptionEndsAt(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parse(adminEndsAtSchema, req.body);
    res.status(200).json({
      subscription: await adminSubscriptionService.setEndsAt(
        adminUserIdFrom(req),
        assertUuidParam(String(req.params.tenantId), "Geçersiz tenant."),
        body.endsAt,
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function listAdminIntegrations(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminIntegrationListQuerySchema, req.query);
    res.status(200).json(await adminIntegrationService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function getAdminIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      integration: await adminIntegrationService.getById(assertUuidParam(String(req.params.id))),
    });
  } catch (error) {
    next(error);
  }
}

export async function listAdminCommunications(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminCommunicationListQuerySchema, req.query);
    res.status(200).json(await adminCommunicationService.list(query));
  } catch (error) {
    next(error);
  }
}

export async function getAdminCommunication(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      message: await adminCommunicationService.getById(assertUuidParam(String(req.params.id))),
    });
  } catch (error) {
    next(error);
  }
}

export async function getAdminSystem(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminSystemService.getStatus());
  } catch (error) {
    next(error);
  }
}

export async function listAdminAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(adminAuditListQuerySchema, req.query);
    res.status(200).json(await adminAuditService.list(query));
  } catch (error) {
    next(error);
  }
}
