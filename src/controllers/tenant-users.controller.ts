import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { tenantUserService } from "../services/tenant-users.service";
import { HttpError } from "../utils/httpError";

function actorFrom(req: Request) {
  if (!req.auth?.userId || !req.auth.role || !req.auth.tenantId) {
    throw new HttpError(401, "Oturum açmanız gerekiyor.");
  }
  return {
    userId: req.auth.userId,
    role: req.auth.role,
    permissions: req.auth.permissions ?? [],
    tenantId: req.auth.tenantId,
  };
}

export async function getTenantUserCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    actorFrom(req);
    res.json(tenantUserService.catalog());
  } catch (error) {
    next(error);
  }
}

export async function listTenantUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await tenantUserService.list(actor.tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function inviteTenantUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const body = req.body as {
      fullName?: string;
      email?: string;
      role?: UserRole;
      allSites?: boolean;
      siteIds?: string[];
      permissions?: string[];
    };
    const result = await tenantUserService.invite(actor, actor.tenantId, {
      fullName: body.fullName ?? "",
      email: body.email ?? "",
      role: body.role ?? "GORUNTULEYICI",
      allSites: body.allSites !== false,
      siteIds: body.siteIds ?? [],
      permissions: body.permissions ?? [],
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function resendTenantUserInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await tenantUserService.resendInvite(actor.userId, actor.tenantId, String(req.params.id));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateTenantUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const body = req.body as {
      role?: UserRole;
      allSites?: boolean;
      siteIds?: string[];
      permissions?: string[];
    };
    const result = await tenantUserService.update(actor, actor.tenantId, String(req.params.id), body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function disableTenantUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await tenantUserService.setStatus(actor, actor.tenantId, String(req.params.id), "DISABLED");
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function enableTenantUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await tenantUserService.setStatus(actor, actor.tenantId, String(req.params.id), "ACTIVE");
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function removeTenantUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await tenantUserService.remove(actor, actor.tenantId, String(req.params.id));
    res.json(result);
  } catch (error) {
    next(error);
  }
}
