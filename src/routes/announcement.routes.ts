import { Router } from "express";
import {
  archiveAnnouncement,
  cancelAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  previewAudience,
  publishAnnouncement,
  updateAnnouncement,
} from "../controllers/announcement.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requirePermission, requireTenant } from "../middleware/tenant";

export const announcementRouter = Router();

announcementRouter.use(requireAuth, requireTenant, requireSite);

announcementRouter.get("/", requirePermission("announcements.view"), listAnnouncements);
announcementRouter.post("/preview-audience", requirePermission("announcements.view"), previewAudience);
announcementRouter.get("/:id", requirePermission("announcements.view"), getAnnouncement);
announcementRouter.post("/", requirePermission("announcements.manage"), createAnnouncement);
announcementRouter.patch("/:id", requirePermission("announcements.manage"), updateAnnouncement);
announcementRouter.post("/:id/publish", requirePermission("announcements.manage"), publishAnnouncement);
announcementRouter.post("/:id/archive", requirePermission("announcements.manage"), archiveAnnouncement);
announcementRouter.post("/:id/cancel", requirePermission("announcements.manage"), cancelAnnouncement);
announcementRouter.delete("/:id", requirePermission("announcements.manage"), deleteAnnouncement);
