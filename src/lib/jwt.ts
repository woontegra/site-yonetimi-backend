import jwt, { type SignOptions } from "jsonwebtoken";
import { createHash } from "crypto";
import { env } from "../config/env";

export type AccessJwtPayload = {
  sub: string;
  email: string;
  tenantId: string | null;
  role: string | null;
  typ?: "access";
};

export type RefreshJwtPayload = {
  sub: string;
  email: string;
  typ: "refresh";
};

export { describeExpiresIn, resolveExpiresIn, expiresInToSeconds } from "./jwt-expires";

export function signAccessToken(payload: Omit<AccessJwtPayload, "typ">): string {
  const options: SignOptions = { expiresIn: env.jwtAccessExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign({ ...payload, typ: "access" }, env.jwtSecret, options);
}

export function verifyAccessToken(token: string): AccessJwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === "string") {
    throw new Error("Geçersiz oturum");
  }
  const payload = decoded as AccessJwtPayload;
  if (payload.typ && payload.typ !== "access") {
    throw new Error("Geçersiz oturum türü");
  }
  return payload;
}

export function signRefreshToken(payload: Omit<RefreshJwtPayload, "typ">): string {
  const options: SignOptions = { expiresIn: env.jwtRefreshExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign({ ...payload, typ: "refresh" }, env.jwtRefreshSecret, options);
}

export function verifyRefreshToken(token: string): RefreshJwtPayload {
  const decoded = jwt.verify(token, env.jwtRefreshSecret);
  if (typeof decoded === "string") {
    throw new Error("Geçersiz yenileme oturumu");
  }
  const payload = decoded as RefreshJwtPayload;
  if (payload.typ !== "refresh") {
    throw new Error("Geçersiz yenileme oturumu");
  }
  if (!payload.sub || !payload.email) {
    throw new Error("Geçersiz yenileme oturumu");
  }
  return payload;
}

/** Secret varlığını doğrulamak için kısa parmak izi (logda secret gösterme). */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}
