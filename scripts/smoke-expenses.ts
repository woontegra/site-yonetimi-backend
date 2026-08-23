/**
 * Smoke test for expense APIs. Run: npx tsx scripts/smoke-expenses.ts
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

  const type = (
    await req("/api/expense-types", {
      ...auth,
      method: "POST",
      body: JSON.stringify({ name: `Elektrik ${Date.now()}` }),
    })
  ).expenseType as { id: string; name: string };
  console.log("type_create", type.name);

  await req(`/api/expense-types/${type.id}`, {
    ...auth,
    method: "PATCH",
    body: JSON.stringify({ name: `${type.name} Güncel` }),
  });
  console.log("type_edit ok");

  const buildings = (await req("/api/buildings?perPage=1", auth)) as {
    items: Array<{ id: string }>;
  };
  const buildingId = buildings.items[0]?.id;

  const general = (
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Yönetim Ofisi Kırtasiye",
        expenseTypeId: type.id,
        amount: 250,
        expenseDate: "2026-08-18",
        paymentMethod: "CASH",
      }),
    })
  ).expense as { id: string; building: unknown; amount: string };
  console.log("general", general.amount, "building", general.building);

  if (buildingId) {
    const buildingExpense = (
      await req("/api/expenses", {
        ...auth,
        method: "POST",
        body: JSON.stringify({
          title: "Ağustos Elektrik Faturası",
          expenseTypeId: type.id,
          amount: 4250,
          expenseDate: "2026-08-18",
          paymentMethod: "BANK_TRANSFER",
          buildingId,
        }),
      })
    ).expense as { id: string; amount: string };
    console.log("building_expense", buildingExpense.amount);
  }

  const edited = (
    await req(`/api/expenses/${general.id}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ amount: 300 }),
    })
  ).expense as { amount: string };
  console.log("expense_edit", edited.amount);

  const before = (await req("/api/expenses/summary/monthly", auth)) as {
    currentMonthTotal: string;
  };
  console.log("monthly_before", before.currentMonthTotal);

  await req(`/api/expenses/${general.id}`, { ...auth, method: "DELETE" });
  const cancelled = (await req(`/api/expenses/${general.id}`, auth)).expense as {
    status: string;
  };
  console.log("cancelled", cancelled.status);

  const after = (await req("/api/expenses/summary/monthly", auth)) as {
    currentMonthTotal: string;
  };
  console.log("monthly_after", after.currentMonthTotal);

  await req(`/api/expense-types/${type.id}`, {
    ...auth,
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  try {
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Pasif tür denemesi",
        expenseTypeId: type.id,
        amount: 10,
        expenseDate: "2026-08-18",
        paymentMethod: "OTHER",
      }),
    });
    console.log("PASSIVE_TYPE_UNEXPECTED_OK");
  } catch (e) {
    console.log("passive_type_blocked", (e as Error).message);
  }

  const list = (await req("/api/expenses?status=COMPLETED&search=Elektrik", auth)) as {
    total: number;
  };
  console.log("search_total", list.total);

  const activeType = (
    await req("/api/expense-types", {
      ...auth,
      method: "POST",
      body: JSON.stringify({ name: `Su ${Date.now()}` }),
    })
  ).expenseType as { id: string };

  try {
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Yanlış bina",
        expenseTypeId: activeType.id,
        amount: 10,
        expenseDate: "2026-08-18",
        paymentMethod: "CASH",
        buildingId: "00000000-0000-4000-8000-000000000099",
      }),
    });
    console.log("BAD_BUILDING_UNEXPECTED_OK");
  } catch (e) {
    console.log("bad_building_blocked", (e as Error).message);
  }

  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
