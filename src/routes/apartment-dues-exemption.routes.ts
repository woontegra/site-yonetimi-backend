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

/**
 * ÖNEMLİ: Bu router `apiRouter.use(router)` ile path’siz mount edilir.
 * Bu yüzden `router.use(requireSite)` KULLANILMAZ — aksi halde /subscription/me
 * gibi sonraki tüm tenant endpoint’leri site başlığı ister.
 */
export const apartmentDuesExemptionRouter = Router();

const gate = [requireAuth, requireTenant, requireSite] as const;

apartmentDuesExemptionRouter.get(
  "/apartments/:apartmentId/dues-exemptions",
  ...gate,
  requirePermission("dues.view"),
  listApartmentDuesExemptions,
);
apartmentDuesExemptionRouter.get(
  "/apartments/:apartmentId/dues-exemptions/active",
  ...gate,
  requirePermission("dues.view"),
  getActiveApartmentDuesExemption,
);
apartmentDuesExemptionRouter.post(
  "/apartments/:apartmentId/dues-exemptions",
  ...gate,
  requirePermission("dues.manage"),
  createApartmentDuesExemption,
);
apartmentDuesExemptionRouter.patch(
  "/apartment-dues-exemptions/:id",
  ...gate,
  requirePermission("dues.manage"),
  updateApartmentDuesExemption,
);
apartmentDuesExemptionRouter.post(
  "/apartment-dues-exemptions/:id/revoke",
  ...gate,
  requirePermission("dues.manage"),
  revokeApartmentDuesExemption,
);
