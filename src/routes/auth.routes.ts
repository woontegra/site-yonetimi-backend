import { Router } from "express";
import { login, logout, me, previewSession } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/preview-session", previewSession);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
