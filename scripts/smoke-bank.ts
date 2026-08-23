/**
 * Smoke test bank domain. Run: npx tsx scripts/smoke-bank.ts
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
  if (!res.ok) throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  return body as Record<string, unknown>;
}

async function main() {
  const session = await req("/api/auth/preview-session", { method: "POST", body: "{}" });
  const token = session.token as string;
  const user = session.user as { tenants?: Array<{ id: string }> };
  const tenantId = user.tenants?.[0]?.id!;
  const auth = { token, tenantId };

  const account = (
    await req("/api/bank-accounts", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        bankName: "Ziraat Bankası",
        accountName: "Site Yönetim Hesabı",
        iban: "TR330006100519786457841326",
        openingBalance: 10000,
      }),
    })
  ).bankAccount as { id: string; connectionType: string; bookBalance: string; iban: string };
  console.log("account", account.connectionType, account.bookBalance, account.iban);

  const apts = (await req("/api/apartments?perPage=1", auth)) as {
    items: Array<{ id: string; number: string; building: { id: string } }>;
  };
  const apt = apts.items[0];
  if (!apt) throw new Error("no apartment");

  // Ensure open debt
  let debts = (await req(`/api/apartment-debts?apartmentId=${apt.id}&status=OPEN&perPage=5`, auth)) as {
    items: Array<{ id: string; remainingAmount: string }>;
  };
  if (!debts.items.length) {
    await req("/api/apartment-debts", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        buildingId: apt.building.id,
        apartmentId: apt.id,
        title: "Banka Test Aidatı",
        amount: 1500,
        dueDate: "2026-09-10",
      }),
    });
    debts = (await req(`/api/apartment-debts?apartmentId=${apt.id}&status=OPEN&perPage=5`, auth)) as {
      items: Array<{ id: string; remainingAmount: string }>;
    };
  }
  const debt = debts.items[0];

  const rule = (
    await req("/api/bank-matching-rules", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        bankAccountId: account.id,
        name: `Daire ${apt.number}`,
        containsText: `D${apt.number}`,
        buildingId: apt.building.id,
        apartmentId: apt.id,
        priority: 10,
      }),
    })
  ).rule as { id: string };
  console.log("rule", rule.id);

  const credit = (
    await req("/api/bank-transactions", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        bankAccountId: account.id,
        transactionDate: "2026-08-21",
        direction: "CREDIT",
        amount: Number(debt.remainingAmount) > 1500 ? 1500 : Number(debt.remainingAmount),
        description: `SERDAR TOPAL D${apt.number} EYLUL AIDAT`,
        senderName: "Serdar Topal",
        referenceNo: "REF-BANK-1",
      }),
    })
  ).bankTransaction as {
    id: string;
    matchStatus: string;
    matchedApartment: { id: string } | null;
    amount: string;
  };
  console.log("suggested", credit.matchStatus, credit.matchedApartment?.id === apt.id);

  const matched = (
    await req(`/api/bank-transactions/${credit.id}/match`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ apartmentId: apt.id }),
    })
  ).bankTransaction as { matchStatus: string };
  console.log("matched", matched.matchStatus);

  const amount = Number(credit.amount);
  const processed = (
    await req(`/api/bank-transactions/${credit.id}/process`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        allocations: [{ apartmentDebtId: debt.id, amount }],
      }),
    })
  ).bankTransaction as { matchStatus: string; payment: { id: string } | null };
  console.log("processed", processed.matchStatus, !!processed.payment?.id);

  try {
    await req(`/api/bank-transactions/${credit.id}/process`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        allocations: [{ apartmentDebtId: debt.id, amount }],
      }),
    });
    console.log("REPROCESS_UNEXPECTED_OK");
  } catch (e) {
    console.log("reprocess_blocked", (e as Error).message);
  }

  if (processed.payment?.id) {
    await req(`/api/payments/${processed.payment.id}`, { ...auth, method: "DELETE" });
    const afterCancel = (await req(`/api/bank-transactions/${credit.id}`, auth)).bankTransaction as {
      matchStatus: string;
      payment: unknown;
    };
    console.log("after_payment_cancel", afterCancel.matchStatus, afterCancel.payment);
  }

  const debit = (
    await req("/api/bank-transactions", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        bankAccountId: account.id,
        transactionDate: "2026-08-20",
        direction: "DEBIT",
        amount: 100,
        description: "Hesap işletim ücreti",
      }),
    })
  ).bankTransaction as { id: string; direction: string };

  await req(`/api/bank-transactions/${debit.id}/ignore`, { ...auth, method: "POST" });
  const ignored = (await req(`/api/bank-transactions/${debit.id}`, auth)).bankTransaction as {
    status: string;
  };
  console.log("ignored", ignored.status);

  const refreshed = (await req(`/api/bank-accounts/${account.id}`, auth)).bankAccount as {
    bookBalance: string;
  };
  console.log("book_balance", refreshed.bookBalance);

  try {
    await req("/api/bank-matching-rules", {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        name: "Bad",
        containsText: "X",
        buildingId: "00000000-0000-4000-8000-000000000099",
        apartmentId: apt.id,
      }),
    });
    console.log("BAD_BUILDING_UNEXPECTED");
  } catch (e) {
    console.log("bad_building_blocked", (e as Error).message);
  }

  console.log("DONE");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
