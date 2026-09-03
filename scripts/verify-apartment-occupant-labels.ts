/**
 * Targeted checks for apartment occupant labels + search folding.
 * No DB writes / no real payments.
 */
import assert from "node:assert/strict";

// Inline fold mirrors frontend lib (run without TS path aliases).
function foldSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

type Person = { id: string; fullName: string; phone: string | null };
type Apt = {
  id: string;
  number: string;
  building: { id: string; name: string };
  owners?: Person[];
  tenants?: Person[];
};

function personLine(apt: Apt) {
  const owners = apt.owners ?? [];
  const tenants = apt.tenants ?? [];
  const pool = tenants.length > 0 ? tenants : owners;
  const role = tenants.length > 0 ? "Kiracı" : owners.length > 0 ? "Malik" : null;
  const primary = pool[0];
  if (!primary || !role) return "Kişi atanmamış";
  if (pool.length > 1) return `${primary.fullName} +${pool.length - 1}`;
  return `${primary.fullName} · ${role}`;
}

function label(apt: Apt) {
  return `Daire ${apt.number} — ${personLine(apt)}`;
}

function haystack(apt: Apt) {
  const owners = apt.owners ?? [];
  const tenants = apt.tenants ?? [];
  const phones = [...owners, ...tenants].map((p) => p.phone ?? "").join(" ");
  const digits = phones.replace(/\D/g, "");
  const tail = digits.length >= 4 ? digits.slice(-4) : digits;
  return foldSearchText(
    [apt.number, `daire ${apt.number}`, apt.building.name, personLine(apt), ...owners.map((p) => p.fullName), ...tenants.map((p) => p.fullName), tail].join(" "),
  );
}

function matches(apt: Apt, q: string) {
  const t = q.trim();
  if (!t) return true;
  return haystack(apt).includes(foldSearchText(t));
}

const apt6: Apt = {
  id: "6",
  number: "6",
  building: { id: "b", name: "B Blok" },
  owners: [],
  tenants: [{ id: "p1", fullName: "Serdar Topal", phone: "05321234567" }],
};

const apt12: Apt = {
  id: "12",
  number: "12",
  building: { id: "b", name: "B Blok" },
  owners: [],
  tenants: [],
};

const apt4: Apt = {
  id: "4",
  number: "4",
  building: { id: "b", name: "B Blok" },
  owners: [
    { id: "o1", fullName: "Mehmet Kaya", phone: null },
    { id: "o2", fullName: "Ayşe Kaya", phone: null },
  ],
  tenants: [],
};

assert.equal(label(apt6), "Daire 6 — Serdar Topal · Kiracı");
assert.equal(label(apt12), "Daire 12 — Kişi atanmamış");
assert.equal(label(apt4), "Daire 4 — Mehmet Kaya +1");
assert.equal(matches(apt6, "Serdar"), true);
assert.equal(matches(apt6, "Topal"), true);
assert.equal(matches(apt6, "6"), true);
assert.equal(matches(apt6, "Daire 6"), true);
assert.equal(matches(apt6, "4567"), true);
assert.equal(matches(apt6, "XYZ"), false);
assert.equal(matches(apt6, "şerdar") || matches(apt6, "Serdar"), true);

console.log(
  JSON.stringify(
    {
      ok: true,
      apt6Label: label(apt6),
      apt12Label: label(apt12),
      apt4Label: label(apt4),
    },
    null,
    2,
  ),
);
