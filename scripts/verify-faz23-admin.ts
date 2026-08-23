/**
 * FAZ 23 güvenlik duman testi. Tam build değildir.
 * Kullanım: npx tsx scripts/verify-faz23-admin.ts
 */
import bcrypt from "bcryptjs";
import http from "http";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { provisionPlatformAdmins } from "../src/services/platform-admin.service";
import { redactSecrets } from "../src/utils/admin";

const EMAIL = `faz23-verify-${Date.now()}@example.com`;

async function request(
  port: number,
  path: string,
  options: { method?: string; token?: string; tenantId?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.tenantId ? { "X-Tenant-Id": options.tenantId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(!redactSecrets("Bearer EAA1234567890secret")?.includes("EAA"), "token redaksiyonu");
  assert(!JSON.stringify({ password: "x" }).includes("should-not"), "sanity");

  await provisionPlatformAdmins();

  const passwordHash = await bcrypt.hash("temp-pass-23", 10);
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash, fullName: "Faz23 Verify", isPlatformAdmin: false },
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port alınamadı");
  const port = address.port;

  try {
    const noAuth = await request(port, "/api/admin/overview");
    assert(noAuth.status === 401, `auth yokken 401 beklenirdi, ${noAuth.status}`);

    const login = await request(port, "/api/auth/login", {
      method: "POST",
      body: { email: EMAIL, password: "temp-pass-23" },
    });
    assert(login.status === 200, "normal kullanıcı login olmalı");
    const token = String(login.body.token ?? "");
    const publicUser = login.body.user as { isPlatformAdmin?: boolean };
    assert(publicUser.isPlatformAdmin === false, "normal kullanıcı platform admin olmamalı");

    const forbidden = await request(port, "/api/admin/overview", { token });
    assert(forbidden.status === 403, `normal kullanıcı 403 beklenirdi, ${forbidden.status}`);

    const tenantsForbidden = await request(port, "/api/admin/tenants", { token });
    assert(tenantsForbidden.status === 403, "tenant admin/normal user tenant listesine giremez");

    const payload = JSON.stringify(forbidden.body);
    assert(!payload.toLowerCase().includes("passwordhash"), "passwordHash sızmamalı");
    assert(!payload.toLowerCase().includes("accesstoken"), "accessToken sızmamalı");

    const preview = await request(port, "/api/auth/preview-session", { method: "POST" });
    assert(preview.status === 200, "preview session");
    const previewUser = preview.body.user as { isPlatformAdmin?: boolean; tenants?: Array<{ id: string }> };
    const previewToken = String(preview.body.token ?? "");

    if (previewUser.isPlatformAdmin) {
      const ok = await request(port, "/api/admin/overview", { token: previewToken });
      assert(ok.status === 200, `platform admin overview 200 beklenirdi, ${ok.status}`);
      const text = JSON.stringify(ok.body);
      assert(!text.includes("accessTokenEncrypted"), "overview token içermemeli");
      assert(!text.includes("passwordHash"), "overview password içermemeli");

      const tenantId = previewUser.tenants?.[0]?.id;
      if (tenantId) {
        const scoped = await request(port, "/api/persons", { token: previewToken, tenantId });
        assert(scoped.status === 200 || scoped.status === 400, "tenant endpoint ayrı kalmalı");
      }
    } else {
      const stillForbidden = await request(port, "/api/admin/overview", { token: previewToken });
      assert(stillForbidden.status === 403, "preview user admin değilse 403");
    }

    console.log("FAZ 23 güvenlik duman testi geçti.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
