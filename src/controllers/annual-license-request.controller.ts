import type { NextFunction, Request, Response } from "express";
import {
  approveAnnualLicenseRequest,
  cancelAnnualLicenseRequest,
  createAnnualLicenseRequest,
  getAdminAnnualLicenseRequest,
  getAnnualLicenseOffer,
  listAdminAnnualLicenseRequests,
  markAnnualLicenseRequestContacted,
  rejectAnnualLicenseRequest,
} from "../services/annual-license-request.service";
import { HttpError } from "../utils/httpError";
import type { AnnualLicenseRequestStatus } from "@prisma/client";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new HttpError(400, "Organizasyon bağlamı gerekli.", "ORGANIZATION_CONTEXT_REQUIRED");
  }
  return tenantId;
}

function userIdFrom(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Oturum açmanız gerekiyor.");
  return userId;
}

function adminIdFrom(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Oturum açmanız gerekiyor.");
  return userId;
}

export async function getAnnualLicenseOfferHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(await getAnnualLicenseOffer(userIdFrom(req), tenantIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function createAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const note = typeof req.body?.note === "string" ? req.body.note : null;
    const request = await createAnnualLicenseRequest(userIdFrom(req), tenantIdFrom(req), { note });
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
}

export async function listAdminAnnualLicenseRequestsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.perPage ?? 20);
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const allowed: Array<AnnualLicenseRequestStatus | "open" | ""> = [
      "",
      "open",
      "PENDING",
      "CONTACTED",
      "APPROVED",
      "REJECTED",
      "CANCELLED",
    ];
    const status = allowed.includes(statusRaw as AnnualLicenseRequestStatus | "open" | "")
      ? (statusRaw as AnnualLicenseRequestStatus | "open" | "")
      : "";
    res.status(200).json(
      await listAdminAnnualLicenseRequests({
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 20,
        status,
        search,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function getAdminAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await getAdminAnnualLicenseRequest(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function contactAdminAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const adminNote = typeof req.body?.adminNote === "string" ? req.body.adminNote : null;
    res.status(200).json({
      request: await markAnnualLicenseRequestContacted(adminIdFrom(req), String(req.params.id), { adminNote }),
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectAdminAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    res.status(200).json({
      request: await rejectAnnualLicenseRequest(adminIdFrom(req), String(req.params.id), { reason }),
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelAdminAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    res.status(200).json({
      request: await cancelAnnualLicenseRequest(adminIdFrom(req), String(req.params.id), { reason }),
    });
  } catch (error) {
    next(error);
  }
}

export async function approveAdminAnnualLicenseRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const netPrice =
      req.body?.netPrice != null && Number.isFinite(Number(req.body.netPrice))
        ? Number(req.body.netPrice)
        : undefined;
    const paymentNoteRaw = typeof req.body?.paymentNote === "string" ? req.body.paymentNote : undefined;
    const paymentNote =
      paymentNoteRaw === "PAID" || paymentNoteRaw === "PENDING" || paymentNoteRaw === "COMPLIMENTARY"
        ? paymentNoteRaw
        : undefined;
    const result = await approveAnnualLicenseRequest(adminIdFrom(req), String(req.params.id), {
      reason,
      netPrice,
      paymentNote,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
