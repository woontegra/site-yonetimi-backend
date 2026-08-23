/**
 * Smoke test for supplier + expense supplierId APIs.
 * Run: npx tsx scripts/smoke-suppliers.ts
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

  const supplier = (
    await req("/api/suppliers", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        name: `Smoke Tedarikci ${Date.now()}`,
        contactPerson: "Ali Test",
        phone: "05551112233",
        city: "Istanbul",
      }),
    })
  ).supplier as { id: string; name: string };
  console.log("supplier_create", supplier.id, supplier.name);

  const edited = (
    await req(`/api/suppliers/${supplier.id}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ name: `${supplier.name} Guncel`, phone: "05559998877" }),
    })
  ).supplier as { id: string; name: string; phone: string | null };
  console.log("supplier_edit", edited.name, edited.phone);

  let expenseTypeId: string | undefined;
  const types = (await req("/api/expense-types?perPage=1", auth)) as {
    items?: Array<{ id: string; isActive?: boolean }>;
  };
  const activeExisting = types.items?.find((t) => t.isActive !== false);
  if (activeExisting) {
    expenseTypeId = activeExisting.id;
    console.log("expense_type_reuse", expenseTypeId);
  } else {
    const created = (
      await req("/api/expense-types", {
        ...auth,
        method: "POST",
        body: JSON.stringify({ name: `Smoke Tur ${Date.now()}` }),
      })
    ).expenseType as { id: string };
    expenseTypeId = created.id;
    console.log("expense_type_create", expenseTypeId);
  }

  const expense = (
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Smoke tedarikci gideri",
        expenseTypeId,
        amount: 1500,
        expenseDate: "2026-08-18",
        paymentMethod: "BANK_TRANSFER",
        supplierId: supplier.id,
      }),
    })
  ).expense as { id: string; amount: string; supplier?: { id: string } };
  console.log("expense_create", expense.id, expense.amount, expense.supplier?.id);

  const listed = (await req(`/api/expenses?supplierId=${supplier.id}`, auth)) as {
    total: number;
    items: Array<{ id: string }>;
  };
  console.log("expenses_by_supplier", listed.total, listed.items.map((i) => i.id).join(","));

  const detailBefore = (
    await req(`/api/suppliers/${supplier.id}`, auth)
  ).supplier as {
    summary: { completedExpenseTotal: string; completedExpenseCount: number };
  };
  console.log(
    "summary_before",
    detailBefore.summary.completedExpenseTotal,
    "count",
    detailBefore.summary.completedExpenseCount,
  );

  await req(`/api/expenses/${expense.id}`, { ...auth, method: "DELETE" });
  console.log("expense_cancelled");

  const detailAfter = (
    await req(`/api/suppliers/${supplier.id}`, auth)
  ).supplier as {
    summary: { completedExpenseTotal: string; completedExpenseCount: number };
  };
  console.log(
    "summary_after",
    detailAfter.summary.completedExpenseTotal,
    "count",
    detailAfter.summary.completedExpenseCount,
  );

  const beforeNum = Number(detailBefore.summary.completedExpenseTotal);
  const afterNum = Number(detailAfter.summary.completedExpenseTotal);
  if (!(afterNum < beforeNum)) {
    throw new Error(`expected summary total to drop: before=${beforeNum} after=${afterNum}`);
  }
  console.log("summary_drop ok");

  await req(`/api/suppliers/${supplier.id}`, { ...auth, method: "DELETE" });
  console.log("supplier_archived");

  try {
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Arsivli tedarikci denemesi",
        expenseTypeId,
        amount: 10,
        expenseDate: "2026-08-18",
        paymentMethod: "CASH",
        supplierId: supplier.id,
      }),
    });
    console.log("ARCHIVED_SUPPLIER_UNEXPECTED_OK");
  } catch (e) {
    console.log("archived_supplier_blocked", (e as Error).message);
  }

  try {
    await req("/api/expenses", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        title: "Sahte tedarikci denemesi",
        expenseTypeId,
        amount: 10,
        expenseDate: "2026-08-18",
        paymentMethod: "CASH",
        supplierId: "00000000-0000-4000-8000-000000000099",
      }),
    });
    console.log("FAKE_SUPPLIER_UNEXPECTED_OK");
  } catch (e) {
    console.log("fake_supplier_blocked", (e as Error).message);
  }

  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
