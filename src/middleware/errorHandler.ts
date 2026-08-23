import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

function isDatabaseUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "PrismaClientInitializationError";
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (isDatabaseUnavailable(err)) {
    res.status(503).json({ message: "Veritabanına şu anda bağlanılamıyor." });
    return;
  }

  console.error(err);

  if (env.nodeEnv !== "production") {
    const message =
      err instanceof Prisma.PrismaClientKnownRequestError
        ? `Sunucu hatası (Prisma ${err.code}): ${err.message}`
        : err instanceof Error
          ? `Sunucu hatası: ${err.message}`
          : "Sunucu hatası oluştu.";
    res.status(500).json({ message });
    return;
  }

  res.status(500).json({ message: "Sunucu hatası oluştu." });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: "İstenen kaynak bulunamadı." });
}
