import { Router } from "express";
import {
  disableTenantUser,
  enableTenantUser,
  getTenantUserCatalog,
  inviteTenantUser,
  listTenantUsers,
  removeTenantUser,
  resendTenantUserInvite,
  updateTenantUser,
} from "../controllers/tenant-users.controller";
import { requireAuth } from "../middleware/auth";
import { requireAnyPermission, requirePermission, requireTenant } from "../middleware/tenant";

export const tenantUserRouter = Router();

tenantUserRouter.use(requireAuth, requireTenant);

tenantUserRouter.get("/catalog", requirePermission("users.view"), getTenantUserCatalog);
tenantUserRouter.get("/", requirePermission("users.view"), listTenantUsers);
tenantUserRouter.post("/", requireAnyPermission("users.invite", "users.manage"), inviteTenantUser);
tenantUserRouter.post("/:id/resend-invite", requireAnyPermission("users.invite", "users.manage"), resendTenantUserInvite);
tenantUserRouter.patch("/:id", requirePermission("users.manage"), updateTenantUser);
tenantUserRouter.post("/:id/disable", requirePermission("users.manage"), disableTenantUser);
tenantUserRouter.post("/:id/enable", requirePermission("users.manage"), enableTenantUser);
tenantUserRouter.delete("/:id", requirePermission("users.manage"), removeTenantUser);
