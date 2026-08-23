/**
 * Smoke test for employee + assignment APIs.
 * Run: npx tsx scripts/smoke-employees.ts
 */
const API = process.env.API_URL ?? "http://localhost:4100";

async function req(path: string, init: RequestInit & { token?: string; tenantId?: string } = {}) {
  const { token, tenantId, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
      ...(headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return body as Record<string, unknown>;
}

async function main() {
  const session = await req("/api/auth/preview-session", { method: "POST", body: "{}" });
  const token = session.token as string;
  const user = session.user as { tenants?: Array<{ id: string }> };
  const tenantId = user.tenants?.[0]?.id;
  if (!token || !tenantId) throw new Error("auth missing");
  const auth = { token, tenantId };
  console.log("auth ok", tenantId);

  const stamp = Date.now();
  const employee = (
    await req("/api/employees", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `Calisan${stamp}`,
        jobTitle: "Guvenlik",
        phone: "05551112233",
        hireDate: "2026-01-15",
      }),
    })
  ).employee as { id: string; firstName: string; lastName: string; jobTitle: string };
  console.log("employee_create", employee.id, employee.firstName, employee.lastName, employee.jobTitle);

  const edited = (
    await req(`/api/employees/${employee.id}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({
        phone: "05559998877",
        jobTitle: "Site Gorevlisi",
        address: "Smoke Adres",
      }),
    })
  ).employee as { id: string; phone: string | null; jobTitle: string };
  console.log("employee_edit", edited.jobTitle, edited.phone);

  const siteAssignment = (
    await req(`/api/employees/${employee.id}/assignments`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        scope: "SITE",
        startDate: "2026-02-01",
        note: "Site geneli smoke",
      }),
    })
  ).assignment as { id: string; scope: string };
  console.log("assignment_site", siteAssignment.id, siteAssignment.scope);

  const buildings = (await req("/api/buildings?perPage=1", auth)) as {
    items?: Array<{ id: string; name: string }>;
  };
  const building = buildings.items?.[0];
  if (building) {
    console.log("building_reuse", building.id, building.name);
    const buildingAssignment = (
      await req(`/api/employees/${employee.id}/assignments`, {
        ...auth,
        method: "POST",
        body: JSON.stringify({
          scope: "BUILDING",
          buildingId: building.id,
          startDate: "2026-03-01",
          note: "Bina smoke",
        }),
      })
    ).assignment as { id: string; scope: string; building?: { id: string } | null };
    console.log("assignment_building", buildingAssignment.id, buildingAssignment.building?.id);

    const ended = (
      await req(`/api/employees/assignments/${buildingAssignment.id}/end`, {
        ...auth,
        method: "POST",
        body: JSON.stringify({ endDate: "2026-08-01" }),
      })
    ).assignment as { id: string; isActive?: boolean; endDate?: string };
    console.log("assignment_end", ended.id, ended.endDate, "active=", ended.isActive);
  } else {
    console.log("building_skip no buildings");
  }

  const terminated = (
    await req(`/api/employees/${employee.id}/terminate`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({ terminationDate: "2026-08-20" }),
    })
  ).employee as { id: string; isActive: boolean; terminationDate?: string };
  console.log("employee_terminate", terminated.id, "active=", terminated.isActive, terminated.terminationDate);

  try {
    await req(`/api/employees/${employee.id}/assignments`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({ scope: "SITE", startDate: "2026-08-21" }),
    });
    console.log("TERMINATED_ASSIGNMENT_UNEXPECTED_OK");
  } catch (e) {
    console.log("terminated_assignment_blocked", (e as Error).message);
  }

  const employee2 = (
    await req("/api/employees", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `Arsiv${stamp}`,
        jobTitle: "Temizlik",
      }),
    })
  ).employee as { id: string };
  console.log("employee2_create", employee2.id);

  await req(`/api/employees/${employee2.id}`, { ...auth, method: "DELETE" });
  console.log("employee2_archived");

  const activeForBad = (
    await req("/api/employees", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `Aktif${stamp}`,
        jobTitle: "Bakim",
      }),
    })
  ).employee as { id: string };
  console.log("employee_active_for_bad_building", activeForBad.id);

  try {
    await req(`/api/employees/${activeForBad.id}/assignments`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        scope: "BUILDING",
        buildingId: "00000000-0000-4000-8000-000000000099",
        startDate: "2026-08-01",
      }),
    });
    console.log("BAD_BUILDING_UNEXPECTED_OK");
  } catch (e) {
    console.log("bad_building_blocked", (e as Error).message);
  }

  const listed = (await req(`/api/employees?search=Smoke&perPage=50`, auth)) as {
    total: number;
    items: Array<{ id: string; lastName: string }>;
  };
  console.log("search_list", listed.total, listed.items.slice(0, 5).map((i) => i.lastName).join(","));

  if (listed.total < 1) throw new Error("expected search results");
  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
