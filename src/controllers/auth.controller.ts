import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service";
import { HttpError } from "../utils/httpError";

const loginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta girin."),
  password: z.string().min(1, "Şifre gerekli."),
});

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    }

    const result = await authService.login(parsed.data.email, parsed.data.password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function previewSession(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.previewSession();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }
    const user = await authService.getMe(req.auth.userId);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  res.status(204).send();
}
