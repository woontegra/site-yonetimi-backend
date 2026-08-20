import type { NextFunction, Request, Response } from "express";
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
    res.status(err.statusCode).json({ message: err.message });
    return;
  }

  if (isDatabaseUnavailable(err)) {
    res.status(503).json({ message: "Veritabanına şu anda bağlanılamıyor." });
    return;
  }

  console.error(err);
  res.status(500).json({ message: "Sunucu hatası oluştu." });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: "İstenen kaynak bulunamadı." });
}
