import { Router } from "express";
import {
  activateAccount,
  changePassword,
  login,
  logout,
  me,
  peekActivation,
  previewSession,
  refresh,
  updateProfile,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/preview-session", previewSession);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
authRouter.patch("/me", requireAuth, updateProfile);
authRouter.post("/change-password", requireAuth, changePassword);
authRouter.get("/activation", peekActivation);
authRouter.post("/activate", activateAccount);
