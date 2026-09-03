import { Router } from "express";
import {
  createApartmentDuesExemption,
  getActiveApartmentDuesExemption,
  listApartmentDuesExemptions,
  revokeApartmentDuesExemption,
  updateApartmentDuesExemption,
} from "../controllers/apartment-dues-exemption.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const apartmentDuesExemptionRouter = Router();

apartmentDuesExemptionRouter.use(requireAuth, requireTenant, requireSite);

apartmentDuesExemptionRouter.get(
  "/apartments/:apartmentId/dues-exemptions",
  requirePermission("dues.view"),
  listApartmentDuesExemptions,
);
apartmentDuesExemptionRouter.get(
  "/apartments/:apartmentId/dues-exemptions/active",
  requirePermission("dues.view"),
  getActiveApartmentDuesExemption,
);
apartmentDuesExemptionRouter.post(
  "/apartments/:apartmentId/dues-exemptions",
  requirePermission("dues.manage"),
  createApartmentDuesExemption,
);
apartmentDuesExemptionRouter.patch(
  "/apartment-dues-exemptions/:id",
  requirePermission("dues.manage"),
  updateApartmentDuesExemption,
);
apartmentDuesExemptionRouter.post(
  "/apartment-dues-exemptions/:id/revoke",
  requirePermission("dues.manage"),
  revokeApartmentDuesExemption,
);
