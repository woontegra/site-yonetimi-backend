import { Router } from "express";
import {
  activateAdminTenant,
  activateAdminUser,
  cancelAdminSubscription,
  changeAdminSubscriptionPlan,
  convertAdminAnnualLicense,
  createAdminTenant,
  createAdminTenantNote,
  createAdminUserNote,
  deactivateAdminTenant,
  deactivateAdminUser,
  deleteAdminTenant,
  deleteAdminUser,
  extendAdminDemoLicense,
  extendAdminSubscription,
  extendAdminTenantSubscription,
  getAdminCommunication,
  getAdminIntegration,
  getAdminOverview,
  getAdminSite,
  getAdminSubscription,
  getAdminSubscriptionSummary,
  getAdminSystem,
  getAdminTenant,
  getAdminUser,
  getAdminUserSummary,
  listAdminAuditLogs,
  listAdminCommunications,
  listAdminIntegrations,
  listAdminSites,
  listAdminSubscriptionHistory,
  listAdminSubscriptions,
  listAdminTenantAuditLogs,
  listAdminTenantNotes,
  listAdminTenantSites,
  listAdminTenantStats,
  listAdminTenantUsers,
  listAdminTenants,
  listAdminUserAccess,
  listAdminUserActivity,
  listAdminUserAuditLogs,
  listAdminUserCommunications,
  listAdminUserNotes,
  listAdminUserTenantSites,
  listAdminUsers,
  previewAdminUserDelete,
  reactivateAdminSubscription,
  renewAdminAnnualLicense,
  setAdminSubscriptionEndsAt,
  startAdminAnnualLicense,
  startAdminDemoLicense,
  suspendAdminSubscription,
  trialAdminTenantSubscription,
  updateAdminUser,
  updateAdminUserAccess,
} from "../controllers/admin.controller";
import {
  approveAdminAnnualLicenseRequestHandler,
  cancelAdminAnnualLicenseRequestHandler,
  contactAdminAnnualLicenseRequestHandler,
  getAdminAnnualLicenseRequestHandler,
  listAdminAnnualLicenseRequestsHandler,
  rejectAdminAnnualLicenseRequestHandler,
} from "../controllers/annual-license-request.controller";
import {
  getAdminEmailIntegration,
  listAdminEmailDeliveries,
  resendAdminTenantNotification,
  resendAdminUserInvite,
  retryAdminEmailDelivery,
  sendAdminEmailTest,
  setAdminEmailActive,
  testAdminEmailConnection,
  upsertAdminEmailIntegration,
} from "../controllers/admin-email.controller";
import { requireAuth } from "../middleware/auth";
import { requirePlatformAdmin } from "../middleware/platformAdmin";

export const adminRouter = Router();

/** Platform admin: DB doğrulaması. Tenant aboneliğine bağlı değildir. */
adminRouter.use(requireAuth, requirePlatformAdmin);

adminRouter.get("/overview", getAdminOverview);
adminRouter.get("/tenant-stats", listAdminTenantStats);
adminRouter.get("/system", getAdminSystem);
adminRouter.get("/audit-logs", listAdminAuditLogs);

adminRouter.get("/tenants", listAdminTenants);
adminRouter.post("/tenants", createAdminTenant);
adminRouter.get("/tenants/:id/sites", listAdminTenantSites);
adminRouter.get("/tenants/:id/users", listAdminTenantUsers);
adminRouter.get("/tenants/:id/notes", listAdminTenantNotes);
adminRouter.post("/tenants/:id/notes", createAdminTenantNote);
adminRouter.get("/tenants/:id/audit-logs", listAdminTenantAuditLogs);
adminRouter.post("/tenants/:id/activate", activateAdminTenant);
adminRouter.post("/tenants/:id/deactivate", deactivateAdminTenant);
adminRouter.delete("/tenants/:id", deleteAdminTenant);
adminRouter.post("/tenants/:id/subscription/extend", extendAdminTenantSubscription);
adminRouter.post("/tenants/:id/subscription/trial", trialAdminTenantSubscription);
adminRouter.post("/tenants/:id/resend-notification", resendAdminTenantNotification);
adminRouter.get("/tenants/:id", getAdminTenant);

adminRouter.get("/users/summary", getAdminUserSummary);
adminRouter.get("/users", listAdminUsers);
adminRouter.get("/users/:id/access", listAdminUserAccess);
adminRouter.get("/users/:id/tenant-sites", listAdminUserTenantSites);
adminRouter.get("/users/:id/activity", listAdminUserActivity);
adminRouter.get("/users/:id/communications", listAdminUserCommunications);
adminRouter.get("/users/:id/notes", listAdminUserNotes);
adminRouter.get("/users/:id/audit-logs", listAdminUserAuditLogs);
adminRouter.get("/users/:id/delete-preview", previewAdminUserDelete);
adminRouter.patch("/users/:id", updateAdminUser);
adminRouter.patch("/users/:id/access", updateAdminUserAccess);
adminRouter.post("/users/:id/notes", createAdminUserNote);
adminRouter.post("/users/:id/activate", activateAdminUser);
adminRouter.post("/users/:id/deactivate", deactivateAdminUser);
adminRouter.post("/users/:id/resend-invite", resendAdminUserInvite);
adminRouter.delete("/users/:id", deleteAdminUser);
adminRouter.get("/users/:id", getAdminUser);

adminRouter.get("/sites", listAdminSites);
adminRouter.get("/sites/:id", getAdminSite);

adminRouter.get("/subscriptions/summary", getAdminSubscriptionSummary);
adminRouter.get("/subscriptions", listAdminSubscriptions);
adminRouter.get("/subscriptions/:tenantId/history", listAdminSubscriptionHistory);
adminRouter.get("/subscriptions/:tenantId", getAdminSubscription);
adminRouter.post("/subscriptions/:tenantId/demo/start", startAdminDemoLicense);
adminRouter.post("/subscriptions/:tenantId/demo/extend", extendAdminDemoLicense);
adminRouter.post("/subscriptions/:tenantId/convert-annual", convertAdminAnnualLicense);
adminRouter.post("/subscriptions/:tenantId/annual/start", startAdminAnnualLicense);
adminRouter.post("/subscriptions/:tenantId/annual/renew", renewAdminAnnualLicense);
adminRouter.post("/subscriptions/:tenantId/cancel", cancelAdminSubscription);
adminRouter.post("/subscriptions/:tenantId/extend", extendAdminSubscription);
adminRouter.post("/subscriptions/:tenantId/plan", changeAdminSubscriptionPlan);
adminRouter.post("/subscriptions/:tenantId/suspend", suspendAdminSubscription);
adminRouter.post("/subscriptions/:tenantId/reactivate", reactivateAdminSubscription);
adminRouter.post("/subscriptions/:tenantId/ends-at", setAdminSubscriptionEndsAt);

adminRouter.get("/license-requests", listAdminAnnualLicenseRequestsHandler);
adminRouter.get("/license-requests/:id", getAdminAnnualLicenseRequestHandler);
adminRouter.post("/license-requests/:id/contacted", contactAdminAnnualLicenseRequestHandler);
adminRouter.post("/license-requests/:id/approve", approveAdminAnnualLicenseRequestHandler);
adminRouter.post("/license-requests/:id/reject", rejectAdminAnnualLicenseRequestHandler);
adminRouter.post("/license-requests/:id/cancel", cancelAdminAnnualLicenseRequestHandler);

adminRouter.get("/integrations", listAdminIntegrations);
adminRouter.get("/integrations/:id", getAdminIntegration);

adminRouter.get("/email-integration", getAdminEmailIntegration);
adminRouter.put("/email-integration", upsertAdminEmailIntegration);
adminRouter.post("/email-integration/set-active", setAdminEmailActive);
adminRouter.post("/email-integration/test-connection", testAdminEmailConnection);
adminRouter.post("/email-integration/test-send", sendAdminEmailTest);
adminRouter.get("/email-deliveries", listAdminEmailDeliveries);
adminRouter.post("/email-deliveries/:id/retry", retryAdminEmailDelivery);

adminRouter.get("/communications", listAdminCommunications);
adminRouter.get("/communications/:id", getAdminCommunication);
