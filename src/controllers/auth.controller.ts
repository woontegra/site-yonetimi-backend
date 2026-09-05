import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service";
import { completeActivation } from "../services/email/tenant-email.service";
import { peekActivationToken } from "../services/email/activation-token.service";
import { maskEmail } from "../utils/admin";
import { HttpError } from "../utils/httpError";
import { assertRateLimit } from "../utils/rate-limit";

const loginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta girin."),
  password: z.string().min(1, "Şifre gerekli."),
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20, "Yenileme oturumu geçersiz."),
});

const activationTokenSchema = z.object({
  token: z.string().trim().min(16, "Aktivasyon bağlantısı geçersiz."),
});

const passwordPolicy = z
  .string()
  .min(8, "Şifre en az 8 karakter olmalı ve harf ile rakam içermelidir.")
  .max(128)
  .refine(
    (value) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value) && /\d/.test(value),
    "Şifre en az 8 karakter olmalı ve harf ile rakam içermelidir.",
  );

const activateSchema = activationTokenSchema.extend({
  password: passwordPolicy,
});

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalıdır.").max(120),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut şifre gerekli."),
    newPassword: passwordPolicy,
    confirmPassword: z.string().min(1, "Yeni şifre tekrarı gerekli."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Yeni şifreler eşleşmiyor.",
    path: ["confirmPassword"],
  });

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

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

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = refreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(401, "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");
    }
    const result = await authService.refresh(parsed.data.refreshToken);
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

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    }
    const user = await authService.updateProfile(req.auth.userId, parsed.data);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      throw new HttpError(401, "Oturum açmanız gerekiyor.");
    }
    assertRateLimit(`change-password:${req.auth.userId}`, 10, 15 * 60 * 1000);
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    }
    await authService.changePassword(req.auth.userId, {
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  res.status(204).send();
}

export async function peekActivation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertRateLimit(`activation-peek:${clientKey(req)}`, 40, 15 * 60 * 1000);
    const parsed = activationTokenSchema.safeParse({ token: req.query.token });
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ?? "Aktivasyon bağlantısı geçersiz.",
        "ACTIVATION_TOKEN_FAILED",
      );
    }
    const peeked = await peekActivationToken(parsed.data.token);
    if (!peeked.ok) {
      res.status(200).json({ valid: false, reason: peeked.reason });
      return;
    }
    res.status(200).json({
      valid: true,
      fullName: peeked.fullName,
      emailMasked: maskEmail(peeked.email),
      expiresAt: peeked.expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function activateAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertRateLimit(`activation-post:${clientKey(req)}`, 12, 15 * 60 * 1000);
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ?? "Geçersiz istek.",
        "ACTIVATION_TOKEN_FAILED",
      );
    }
    const result = await completeActivation(parsed.data.token, parsed.data.password);
    res.status(200).json({ ok: true, email: result.email });
  } catch (error) {
    next(error);
  }
}
