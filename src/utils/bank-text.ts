/** Türkçe karakterleri normalize ederek case-insensitive contains kontrolü. */
export function normalizeBankText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "c")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function bankTextContains(haystack: string, needle: string): boolean {
  const n = normalizeBankText(needle);
  if (!n) return false;
  return normalizeBankText(haystack).includes(n);
}

export function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)} **** **** **** ${clean.slice(-4)}`;
}
