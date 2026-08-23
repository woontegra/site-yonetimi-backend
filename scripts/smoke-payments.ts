/**
 * Smoke test for payment APIs. Run: npx tsx scripts/smoke-payments.ts
 * Requires API on localhost:4100.
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
    const err = new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return body as Record<string, unknown>;
}

async function main() {
  const session = await req("/api/auth/preview-session", { method: "POST", body: "{}" });
  const token = session.token as string;
  const user = session.user as { tenants?: Array<{ id: string }> };
  const tenantId = user.tenants?.[0]?.id;
  if (!token || !tenantId) throw new Error("preview-session missing token/tenant");

  const auth = { token, tenantId };

  let debts = (await req("/api/apartment-debts?status=OPEN&perPage=5", auth)) as {
    items: Array<{
      id: string;
      remainingAmount: string;
      apartment: { id: string };
      building: { id: string };
    }>;
  };

  let debt = debts.items[0];
  if (!debt) {
    const apts = (await req("/api/apartments?perPage=1", auth)) as {
      items: Array<{ id: string; building: { id: string } }>;
    };
    const apt = apts.items[0];
    if (!apt) throw new Error("no apartments");
    const created = (await req("/api/apartment-debts", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        buildingId: apt.building.id,
        apartmentId: apt.id,
        title: "Test Tahsilat Borcu",
        amount: 1500,
        dueDate: "2026-08-21",
      }),
    })) as { debt: typeof debt };
    debt = created.debt;
  }

  console.log("debt", debt.id, "rem", debt.remainingAmount);

  const key1 = crypto.randomUUID();
  const p1 = (await req("/api/payments", {
    ...auth,
    method: "POST",
    headers: { "Idempotency-Key": key1 },
    body: JSON.stringify({
      apartmentId: debt.apartment.id,
      amount: 500,
      paymentDate: "2026-08-21",
      paymentMethod: "CASH",
      allocations: [{ apartmentDebtId: debt.id, amount: 500 }],
    }),
  })) as { payment: { id: string; amount: string } };

  const p1b = (await req("/api/payments", {
    ...auth,
    method: "POST",
    headers: { "Idempotency-Key": key1 },
    body: JSON.stringify({
      apartmentId: debt.apartment.id,
      amount: 500,
      paymentDate: "2026-08-21",
      paymentMethod: "CASH",
      allocations: [{ apartmentDebtId: debt.id, amount: 500 }],
    }),
  })) as { payment: { id: string } };

  console.log("partial", p1.payment.amount, "idem", p1.payment.id === p1b.payment.id);

  const after = (await req(`/api/apartment-debts/${debt.id}`, auth)) as {
    debt: { remainingAmount: string; status: string };
  };
  console.log("after_partial", after.debt.remainingAmount, after.debt.status);

  try {
    await req("/api/payments", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        apartmentId: debt.apartment.id,
        amount: 99999,
        paymentDate: "2026-08-21",
        paymentMethod: "CASH",
        allocations: [{ apartmentDebtId: debt.id, amount: 99999 }],
      }),
    });
    console.log("OVERPAY_FAIL");
  } catch (e) {
    console.log("overpay_blocked", (e as Error).message);
  }

  const rem = Number(after.debt.remainingAmount);
  const p2 = (await req("/api/payments", {
    ...auth,
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      apartmentId: debt.apartment.id,
      amount: rem,
      paymentDate: "2026-08-21",
      paymentMethod: "BANK_TRANSFER",
      allocations: [{ apartmentDebtId: debt.id, amount: rem }],
    }),
  })) as { payment: { id: string } };

  const paid = (await req(`/api/apartment-debts/${debt.id}`, auth)) as {
    debt: { remainingAmount: string; status: string };
  };
  console.log("full", paid.debt.remainingAmount, paid.debt.status);

  const cancelled = (await req(`/api/payments/${p2.payment.id}`, {
    ...auth,
    method: "DELETE",
  })) as { payment: { status: string } };
  const restored = (await req(`/api/apartment-debts/${debt.id}`, auth)) as {
    debt: { remainingAmount: string; status: string };
  };
  console.log("cancel", cancelled.payment.status, restored.debt.remainingAmount, restored.debt.status);

  const summary = (await req("/api/payments/summary/monthly", auth)) as {
    currentMonthTotal: string;
    year: number;
  };
  console.log("monthly", summary.currentMonthTotal, summary.year);

  const list = (await req("/api/payments?status=COMPLETED&perPage=5", auth)) as { total: number };
  console.log("list_total", list.total);

  const apts = (await req("/api/apartments?perPage=2", auth)) as {
    items: Array<{ id: string }>;
  };
  const other = apts.items.find((a) => a.id !== debt.apartment.id);
  if (other) {
    try {
      await req("/api/payments", {
        ...auth,
        method: "POST",
        body: JSON.stringify({
          apartmentId: other.id,
          amount: 100,
          paymentDate: "2026-08-21",
          paymentMethod: "CASH",
          allocations: [{ apartmentDebtId: debt.id, amount: 100 }],
        }),
      });
      console.log("CROSS_APT_FAIL");
    } catch (e) {
      console.log("cross_apt_blocked", (e as Error).message);
    }
  }

  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
