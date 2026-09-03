/**
 * Auth süre parse + JWT access/refresh ayrımı doğrulama (secret loglanmaz).
 * Çalıştır: npx tsx scripts/verify-auth-refresh.ts
 */
import assert from "node:assert/strict";
import {
  describeExpiresIn,
  expiresInToSeconds,
  resolveExpiresIn,
} from "../src/lib/jwt-expires";

function testResolveExpiresIn() {
  assert.equal(resolveExpiresIn(undefined, "15m"), "15m");
  assert.equal(resolveExpiresIn("", "15m"), "15m");
  assert.equal(resolveExpiresIn("15m", "7d"), "15m");
  assert.equal(resolveExpiresIn("7d", "15m"), "7d");
  assert.equal(resolveExpiresIn("900", "15m"), 900);
  assert.equal(resolveExpiresIn("15", "15m"), 15); // saniye (jwt sayı kuralı)
  assert.equal(resolveExpiresIn("bogus", "15m"), "15m");
  assert.equal(resolveExpiresIn("15 m", "7d"), "15m");
  assert.equal(expiresInToSeconds("15m"), 900);
  assert.equal(expiresInToSeconds("7d"), 604800);
  assert.equal(expiresInToSeconds(900), 900);
  assert.equal(describeExpiresIn(900), "900s");
  assert.equal(describeExpiresIn("15m"), "15m");
  console.log("ok resolveExpiresIn");
}

async function testJwtSignVerify() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-verify-script-only";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://u:p@localhost:5432/db";
  process.env.JWT_EXPIRES_IN = "15m";
  process.env.JWT_REFRESH_EXPIRES_IN = "7d";

  // env modülü process.env okur — dynamic import
  const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } =
    await import("../src/lib/jwt");

  const access = signAccessToken({
    sub: "user-1",
    email: "a@b.com",
    tenantId: "t1",
    role: "ORGANIZASYON_SAHIBI",
  });
  const refresh = signRefreshToken({ sub: "user-1", email: "a@b.com" });

  const accessPayload = verifyAccessToken(access);
  assert.equal(accessPayload.sub, "user-1");
  assert.equal(accessPayload.typ, "access");

  const refreshPayload = verifyRefreshToken(refresh);
  assert.equal(refreshPayload.sub, "user-1");
  assert.equal(refreshPayload.typ, "refresh");

  assert.throws(() => verifyAccessToken(refresh));
  assert.throws(() => verifyRefreshToken(access));
  console.log("ok jwt access/refresh separation");
}

async function testSingleFlightQueue() {
  let calls = 0;
  let resolveFn: ((v: string) => void) | null = null;
  const slow = () =>
    new Promise<string>((resolve) => {
      calls += 1;
      resolveFn = resolve;
    });

  let inflight: Promise<string> | null = null;
  const singleFlight = () => {
    if (!inflight) {
      inflight = slow().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  const p1 = singleFlight();
  const p2 = singleFlight();
  const p3 = singleFlight();
  assert.equal(calls, 1);
  resolveFn!("token-x");
  const results = await Promise.all([p1, p2, p3]);
  assert.deepEqual(results, ["token-x", "token-x", "token-x"]);
  console.log("ok single-flight concurrency pattern");
}

async function main() {
  testResolveExpiresIn();
  await testJwtSignVerify();
  await testSingleFlightQueue();
  console.log("verify-auth-refresh: all passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
