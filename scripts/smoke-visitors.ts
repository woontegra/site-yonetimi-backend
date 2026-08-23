/**
 * Smoke test for visitor + visit APIs.
 * Run: npx tsx scripts/smoke-visitors.ts
 */
const API = process.env.API_URL ?? "http://localhost:4100";

async function req(
  path: string,
  init: RequestInit & { token?: string; tenantId?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
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
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function ok(
  path: string,
  init: RequestInit & { token?: string; tenantId?: string } = {},
) {
  const { status, body } = await req(path, init);
  if (status < 200 || status >= 300) {
    throw new Error(
      (body as { message?: string }).message ?? `HTTP ${status} ${path}`,
    );
  }
  return body;
}

async function main() {
  const session = await ok("/api/auth/preview-session", {
    method: "POST",
    body: "{}",
  });
  const token = session.token as string;
  const user = session.user as { tenants?: Array<{ id: string }> };
  const tenantId = user.tenants?.[0]?.id;
  if (!token || !tenantId) throw new Error("auth missing");
  const auth = { token, tenantId };
  console.log("auth ok", tenantId);

  const stamp = Date.now();
  const plate = `34SMK${String(stamp).slice(-4)}`;

  const visitor = (
    await ok("/api/visitors", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `Misafir${stamp}`,
        phone: "05551234567",
        nationalId: "12345678901",
        note: "smoke visitor",
      }),
    })
  ).visitor as { id: string; firstName: string; lastName: string; nationalId?: string };
  console.log(
    "visitor_create",
    visitor.id,
    visitor.firstName,
    visitor.lastName,
    "nid=",
    visitor.nationalId,
  );

  const edited = (
    await ok(`/api/visitors/${visitor.id}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({
        phone: "05559876543",
        note: "smoke visitor edited",
        nationalId: "10987654321",
      }),
    })
  ).visitor as { id: string; phone: string | null; nationalId?: string | null };
  console.log("visitor_edit", edited.phone, "nid=", edited.nationalId);

  const got = (
    await ok(`/api/visitors/${visitor.id}`, auth)
  ).visitor as { id: string; nationalId?: string | null };
  console.log(
    "visitor_get",
    got.id,
    "hasNationalId=",
    Object.prototype.hasOwnProperty.call(got, "nationalId"),
    "nid=",
    got.nationalId,
  );
  if (!got.nationalId) throw new Error("expected nationalId on get");

  const listed = (await ok(`/api/visitors?search=Smoke&perPage=50`, auth)) as {
    total: number;
    items: Array<Record<string, unknown>>;
  };
  const listItem = listed.items.find((i) => i.id === visitor.id);
  console.log(
    "visitor_list",
    listed.total,
    "itemHasNationalId=",
    listItem ? Object.prototype.hasOwnProperty.call(listItem, "nationalId") : "missing",
  );
  if (!listItem) throw new Error("visitor not in list");

  const apartments = (await ok("/api/apartments?perPage=1", auth)) as {
    items?: Array<{ id: string; number: string }>;
  };
  const apartment = apartments.items?.[0];
  if (!apartment) throw new Error("no apartment available");
  console.log("apartment", apartment.id, apartment.number);

  const relations = (await ok(
    `/api/apartment-person-relations?apartmentId=${apartment.id}&perPage=50`,
    auth,
  )) as {
    items?: Array<{
      id: string;
      isActive?: boolean;
      person?: { id: string; firstName?: string; lastName?: string };
      personId?: string;
    }>;
  };
  const activeRel =
    relations.items?.find((r) => r.isActive !== false && (r.person?.id || r.personId)) ??
    null;
  const hostPersonId = activeRel?.person?.id ?? activeRel?.personId ?? undefined;
  console.log("host_relation", hostPersonId ?? "none");

  const visitPayload: Record<string, unknown> = {
    visitorId: visitor.id,
    apartmentId: apartment.id,
    purpose: "smoke visit",
    vehiclePlate: plate,
    note: "smoke visit note",
  };
  if (hostPersonId) visitPayload.hostPersonId = hostPersonId;

  const visit = (
    await ok("/api/visits", {
      ...auth,
      method: "POST",
      body: JSON.stringify(visitPayload),
    })
  ).visit as { id: string; status: string; vehiclePlate?: string | null };
  console.log("visit_create", visit.id, visit.status, visit.vehiclePlate);

  const dup = await req("/api/visits", {
    ...auth,
    method: "POST",
    body: JSON.stringify(visitPayload),
  });
  console.log(
    "duplicate_active",
    dup.status,
    (dup.body as { message?: string }).message,
  );
  if (dup.status !== 409) throw new Error(`expected 409 duplicate, got ${dup.status}`);

  // Wrong host: create a random person (not linked to apartment) and try as host
  const wrongPerson = (
    await ok("/api/persons", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `WrongHost${stamp}`,
        phone: "05550001122",
      }),
    })
  ).person as { id: string };
  console.log("wrong_host_person", wrongPerson.id);

  // Need a fresh visitor without active visit for wrong-host attempt after we still have active visit on first
  // Wrong host should fail even on create with a different visitor
  const visitorForHost = (
    await ok("/api/visitors", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `HostTest${stamp}`,
      }),
    })
  ).visitor as { id: string };

  const badHost = await req("/api/visits", {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      visitorId: visitorForHost.id,
      apartmentId: apartment.id,
      hostPersonId: wrongPerson.id,
      purpose: "bad host",
    }),
  });
  console.log(
    "wrong_host_block",
    badHost.status,
    (badHost.body as { message?: string }).message,
  );
  if (badHost.status < 400) {
    console.log("WRONG_HOST_UNEXPECTED_OK");
  } else {
    console.log("wrong_host_blocked_ok");
  }

  const checkedOut = (
    await ok(`/api/visits/${visit.id}/check-out`, {
      ...auth,
      method: "POST",
      body: "{}",
    })
  ).visit as { id: string; status: string };
  console.log("visit_checkout", checkedOut.id, checkedOut.status);

  const visitor2 = (
    await ok("/api/visitors", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        firstName: "Smoke",
        lastName: `Cancel${stamp}`,
        phone: "05550009988",
      }),
    })
  ).visitor as { id: string };
  const visit2 = (
    await ok("/api/visits", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        visitorId: visitor2.id,
        apartmentId: apartment.id,
        ...(hostPersonId ? { hostPersonId } : {}),
        purpose: "to cancel",
        vehiclePlate: `34CNL${String(stamp).slice(-4)}`,
      }),
    })
  ).visit as { id: string; status: string };
  const cancelled = (
    await ok(`/api/visits/${visit2.id}/cancel`, {
      ...auth,
      method: "POST",
      body: "{}",
    })
  ).visit as { id: string; status: string };
  console.log("visit_cancel", cancelled.id, cancelled.status);

  const history = (await ok("/api/visits?statusGroup=history&perPage=20", auth)) as {
    total: number;
    items: Array<{ id: string; status: string }>;
  };
  console.log(
    "history",
    history.total,
    history.items.slice(0, 5).map((i) => `${i.id.slice(0, 8)}:${i.status}`).join(","),
  );

  const inside = (await ok("/api/visits/summary/inside", auth)) as {
    insideCount: number;
  };
  console.log("inside_summary", inside.insideCount);

  const aptFilter = (await ok(
    `/api/visits?apartmentId=${apartment.id}&perPage=20`,
    auth,
  )) as { total: number };
  console.log("apartment_filter", aptFilter.total);

  const plateSearch = (await ok(
    `/api/visits?vehiclePlate=${encodeURIComponent(plate)}&perPage=20`,
    auth,
  )) as { total: number; items: Array<{ vehiclePlate?: string | null }> };
  console.log(
    "plate_search",
    plateSearch.total,
    plateSearch.items[0]?.vehiclePlate ?? "none",
  );

  const badApt = await req("/api/visits", {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      visitorId: visitor.id,
      apartmentId: "00000000-0000-4000-8000-000000000099",
      purpose: "bad apt",
    }),
  });
  console.log(
    "bad_apartment",
    badApt.status,
    (badApt.body as { message?: string }).message,
  );
  if (badApt.status < 400) throw new Error("expected bad apartment blocked");

  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
