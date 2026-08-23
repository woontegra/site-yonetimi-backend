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
import { requireTenant } from "../middleware/tenant";

export const announcementRouter = Router();

announcementRouter.use(requireAuth, requireTenant, requireSite);

announcementRouter.get("/", listAnnouncements);
announcementRouter.post("/preview-audience", previewAudience);
announcementRouter.get("/:id", getAnnouncement);
announcementRouter.post("/", createAnnouncement);
announcementRouter.patch("/:id", updateAnnouncement);
announcementRouter.post("/:id/publish", publishAnnouncement);
announcementRouter.post("/:id/archive", archiveAnnouncement);
announcementRouter.post("/:id/cancel", cancelAnnouncement);
announcementRouter.delete("/:id", deleteAnnouncement);
