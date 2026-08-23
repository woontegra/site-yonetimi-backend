import { Router } from "express";
import { activateAccount, login, logout, me, peekActivation, previewSession } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/preview-session", previewSession);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
authRouter.get("/activation", peekActivation);
authRouter.post("/activate", activateAccount);
